// node tests/download.mjs
// ⬇ ROM no hub: o arquivo baixado é igual ao do cartão. No Drive (mock): ROM pequena vira blob com o nome original;
// acima de 100 MB grava direto no disco (showSaveFilePicker, PC); sem ele (celular), erro claro.
// O trecho do hub roda contra o servidor local (:8770); o do Drive usa io falso (Tarefa 8 troca por Drive simulado cifrado).
import { chromium } from "/home/andre/Workspace/web-ports/tools/pw/node_modules/playwright-core/index.mjs";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
const b = await chromium.launch({ executablePath: "/usr/bin/chromium" });
const c = await b.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 800 } });
const p = await c.newPage();
await p.goto("http://localhost:8770/r36s/#/s/gbc");
await p.waitForFunction(() => window.r36s && window.r36s.ready, null, { timeout: 60000 });
const rom = await p.evaluate(() => document.querySelector(".cover").dataset.rom);
await p.click(".cover");
const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#sheet .rom")]);
const got = createHash("md5").update(readFileSync(await dl.path())).digest("hex");
const want = createHash("md5").update(readFileSync("/home/andre/Workspace/web-ports/r36s/card" + rom)).digest("hex");
// Drive (cifrado): io falso por cima do download.js (todas as ramificações). A decifragem em si é do io.js
// (tests/test_app.mjs); aqui vale o que o download.js faz com os pedaços já decifrados.
const drive = await p.evaluate(async () => {
  const { downloadRom } = await import("/r36s/app/download.js");
  const big = 300 << 20, pedacos = [];
  const io = { backend: "drive",
    async *lerPedacos(vp) { pedacos.push(vp); for (let i = 0; i < 2; i++) yield new Uint8Array(617).fill(i + 1); } };
  const bigIo = { backend: "drive", async *lerPedacos() { yield new Uint8Array(10); yield new Uint8Array(20); } };
  const small = await downloadRom(io, { rom: "/roms/gbc/x.gbc", size: 1234 }, () => {});
  // PC: acima de 100 MB grava direto no arquivo escolhido
  const gravado = []; let fechado = false;
  window.showSaveFilePicker = async o => ({ createWritable: async () => ({ write: async d => { gravado.push(d.length); }, close: async () => { fechado = true; }, abort: async () => {} }) });
  const arq = await downloadRom(bigIo, { rom: "/roms/psx/y.chd", size: big }, () => {});
  // celular (sem showSaveFilePicker): erro claro
  delete window.showSaveFilePicker;
  let celular = null;
  try { await downloadRom(bigIo, { rom: "/roms/psx/y.chd", size: big }, () => {}); } catch (e) { celular = String(e.message); }
  return { small, arq, gravado, fechado, celular, pedacos };
});
const ok = got === want && drive.small === "blob" && drive.arq === "arquivo" && drive.fechado
  && drive.gravado.join() === "10,20" && /celular/.test(drive.celular || "") && drive.pedacos[0] === "/roms/gbc/x.gbc";
console.log(JSON.stringify({ ok, rom, name: dl.suggestedFilename(), same: got === want, drive }));
await b.close();
process.exit(ok ? 0 : 1);
