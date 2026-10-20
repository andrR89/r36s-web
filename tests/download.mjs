// node tests/download.mjs
// ⬇ ROM no hub: o arquivo baixado é igual ao do cartão. No Drive (biblioteca cifrada simulada: tests/cifrado_fixture.mjs,
// mock_drive.py + mock_chaves.mjs): ROM pequena vira blob decifrado com o nome original; acima de 100 MB grava direto
// no disco (showSaveFilePicker, PC); sem ele (celular), erro claro. O trecho do hub roda contra o servidor local (:8770).
import { chromium } from "/home/andre/Workspace/web-ports/tools/pw/node_modules/playwright-core/index.mjs";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cartao, montar, subir } from "./cifrado_fixture.mjs";

const ROOT = "/home/andre/Workspace/web-ports/r36s";
const md5 = b => createHash("md5").update(b).digest("hex");
const work = join(ROOT, "tests/out/download"), card = join(work, "card");
cartao(card);
const mocks = await subir(montar(work, card));
const b = await chromium.launch({ executablePath: "/usr/bin/chromium" });
let ok = false;
try {
  // hub: link direto
  const c = await b.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 800 } });
  const p = await c.newPage();
  await p.goto("http://localhost:8770/r36s/#/s/gbc");
  await p.waitForFunction(() => window.r36s && window.r36s.ready, null, { timeout: 60000 });
  const rom = await p.evaluate(() => document.querySelector(".cover").dataset.rom);
  await p.click(".cover");
  const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#sheet .rom")]);
  const hub = { rom, name: dl.suggestedFilename(), same: md5(readFileSync(await dl.path())) === md5(readFileSync(ROOT + "/card" + rom)) };
  await c.close();

  // Drive cifrado: login falso (tok-shared), seletor do site, ⬇ ROM pela ficha
  const dc = await b.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 800 } });
  await dc.addInitScript(([api, funcoes]) => { window.R36S_CONFIG = { api, funcoes, auth: "mock", mockToken: "tok-shared" }; }, [mocks.api, mocks.funcoes]);
  const dp = await dc.newPage();
  await dp.goto("http://localhost:8770/r36s/site/#/entrar");
  await dp.click("#google-btn");
  await dp.waitForFunction(() => window.r36sApp.state === "shared", null, { timeout: 15000 });
  await dp.click(".play-btn");
  await dp.waitForFunction(() => document.querySelector("#jogar iframe"), null, { timeout: 20000 });
  let app = null;
  for (let i = 0; i < 100 && !app; i++) { app = dp.frames().find(f => /\/index\.html\?backend=drive/.test(f.url())); if (!app) await dp.waitForTimeout(100); }
  await app.waitForFunction(() => window.r36s && window.r36s.ready, null, { timeout: 120000 });
  await app.click('[data-sys="gbc"] .cover');
  const drom = await app.evaluate(() => document.querySelector('[data-sys="gbc"] .cover').dataset.rom);
  const want = md5(readFileSync(join(card, drom)));
  const [ddl] = await Promise.all([dp.waitForEvent("download", { timeout: 30000 }), app.click("#sheet .rom")]);
  const small = { rom: drom, name: ddl.suggestedFilename(), same: md5(readFileSync(await ddl.path())) === want,
                  msg: await app.evaluate(() => document.querySelector("#sheet .msg").textContent) };
  // ramos de arquivo grande com o io de verdade (a mesma ROM, com o tamanho declarado acima de 100 MB):
  // PC grava no arquivo escolhido; celular (sem showSaveFilePicker) dá erro claro sem baixar nada
  const big = await app.evaluate(async rom => {
    const { downloadRom } = await import("/r36s/app/download.js");
    const io = window.r36s.io, g = { rom, size: 300 << 20 }, gravado = [];
    let fechado = false, celular = null;
    window.showSaveFilePicker = async () => ({ createWritable: async () => ({ write: async d => { gravado.push(new Uint8Array(d)); }, close: async () => { fechado = true; }, abort: async () => {} }) });
    const arq = await downloadRom(io, g, () => {});
    delete window.showSaveFilePicker;
    try { await downloadRom(io, g, () => {}); } catch (e) { celular = String(e.message); }
    const tudo = new Uint8Array(await new Blob(gravado).arrayBuffer());
    let s = ""; for (let i = 0; i < tudo.length; i += 0x8000) s += String.fromCharCode(...tudo.subarray(i, i + 0x8000));
    return { arq, fechado, pedacos: gravado.length, b64: btoa(s), celular };
  }, drom);
  const bigSame = md5(Buffer.from(big.b64, "base64")) === want;
  delete big.b64;
  await dc.close();
  ok = hub.same && small.same && small.name === drom.slice(drom.lastIndexOf("/") + 1) && big.arq === "arquivo" && big.fechado
    && bigSame && /celular/.test(big.celular || "");
  console.log(JSON.stringify({ ok, hub, drive: { small, big: { ...big, same: bigSame } } }));
} finally {
  await b.close();
  mocks.parar();
}
process.exit(ok ? 0 : 1);
