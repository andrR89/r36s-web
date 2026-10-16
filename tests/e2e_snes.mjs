// node tests/e2e_snes.mjs [url] [saida] — ponta a ponta: ES -> DK2 no RetroArch (iframe) -> Select+Start -> ES;
// confere o save semeado do DK3 no servidor; abre o DK3 e fotografa a tela de arquivos (save carregado).
import { chromium } from "/home/andre/Workspace/web-ports/tools/pw/node_modules/playwright-core/index.mjs";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { carouselIndex, gameIndex } from "./eslist.mjs";
const url = process.argv[2] ?? "http://localhost:8770/r36s/";
const out = process.argv[3] ?? "/home/andre/Workspace/web-ports/r36s/tests/out";
mkdirSync(out, { recursive: true });
const DK2 = "Donkey Kong Country 2 - Diddy's Kong Quest (USA) (PT-BR)";
const DK3 = "Donkey Kong Country 3 - Dixie Kong's Double Trouble! (USA) (PT-BR)";
const DK3_SEED = `/run/media/andre/EASYROMS/snes/${DK3}.srm`;   // só leitura
const md5 = b => createHash("md5").update(b).digest("hex");

const browser = await chromium.launch({ executablePath: "/usr/bin/chromium",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
await page.addInitScript(() => {   // vale também para o iframe do jogo
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    if (/webgl/.test(type)) attrs = Object.assign({}, attrs, { preserveDrawingBuffer: true });
    return orig.call(this, type, attrs);
  };
});
const logs = [];
page.on("console", m => logs.push(`${m.type()}: ${m.text()}`));
page.on("response", r => { if (r.status() >= 400 && !/\/saves\//.test(r.url())) logs.push(`HTTP ${r.status()} ${r.url()}`); });
page.on("pageerror", e => logs.push("PAGEERROR " + e.message));
const result = { steps: {} };
const step = (k, v) => { result.steps[k] = v; console.log(k, JSON.stringify(v)); };
const fail = why => { result.fail = why; return finish(1); };
async function finish(code) {
  writeFileSync(`${out}/e2e-console.log`, logs.join("\n") + "\n");
  console.log(JSON.stringify({ ...result, tail: logs.filter(l => !/libretro DEBUG|\[GL|\[GLSL/.test(l)).slice(-30) }, null, 1));
  await browser.close();
  process.exit(code);
}

// fração de pixels acesos no canvas de um frame (página ou iframe)
const lit = frame => frame.evaluate(() => {
  const c = document.getElementById("canvas"); if (!c || !c.width) return 0;
  const g = document.createElement("canvas"); g.width = c.width; g.height = c.height;
  const x = g.getContext("2d"); x.drawImage(c, 0, 0);
  const d = x.getImageData(0, 0, g.width, g.height).data; let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 30) n++;
  return +(n / (d.length / 4)).toFixed(3);
});
const hold = async (k, ms = 200) => { await page.keyboard.down(k); await page.waitForTimeout(ms); await page.keyboard.up(k); };
const selectStart = async () => {   // Select (Backspace) segurado + Start (Enter) = sair, como no aparelho
  await page.keyboard.down("Backspace"); await page.waitForTimeout(300);
  await page.keyboard.down("Enter"); await page.waitForTimeout(400);
  await page.keyboard.up("Enter"); await page.keyboard.up("Backspace");
};
const waitLit = async (frame, min, ms) => { const t = Date.now(); let v = 0; while (Date.now() - t < ms) { v = await lit(frame); if (v > min) return v; await page.waitForTimeout(500); } return v; };
const gameFrame = () => page.frames().find(f => /retroarch\/play\.html/.test(f.url()));

async function launchSelected(expect) {
  await hold("l");                   // A
  await page.waitForFunction(() => window.r36s.game, null, { timeout: 15000 });
  const rom = await page.evaluate(() => window.r36s.game.rom);
  if (!rom.includes(expect)) return { rom, wrong: true };
  await page.waitForFunction(() => window.r36s.game?.started, null, { timeout: 60000 });
  return { rom };
}
async function exitGame() {
  await selectStart();
  try { await page.waitForFunction(() => !window.r36s.game, null, { timeout: 20000 }); }
  catch (e) { return null; }
  return page.evaluate(() => window.r36s.lastGame);
}

// --- 1. ES até a lista de jogos
const seed = readFileSync(DK3_SEED);
const savePath = `saves/snes/${encodeURIComponent(DK3 + ".srm")}`;
const before = Buffer.from(await (await fetch(new URL(savePath, url))).arrayBuffer());
step("dk3_save_seed", { server: md5(before), card: md5(seed), equal: before.equals(seed) });
await page.goto(url);
await page.waitForFunction(() => window.r36s?.ready, null, { timeout: 120000 });
if (await waitLit(page, 0.05, 30000) <= 0.05) await fail("ES não apareceu");
await page.waitForTimeout(4000);
// cartão real: o ES abre nos Favoritos; desce o carrossel (vertical no EPICMAX) até o SNES (sem clicar: testa o foco)
const sysIdx = carouselIndex("snes"), dk2Idx = gameIndex("snes", DK2 + ".7z");
step("positions", { snes: sysIdx, dk2: dk2Idx, dk3: gameIndex("snes", DK3 + ".7z") });
if (sysIdx < 0 || dk2Idx < 0) await fail("SNES/DK2 não encontrados no cartão");
for (let i = 0; i < sysIdx; i++) { await hold("s", 80); await page.waitForTimeout(120); }
await page.waitForTimeout(1500);
await hold("l");                           // A: entra no SNES
await page.waitForTimeout(3000);
for (let i = 0; i < dk2Idx; i++) { await hold("s", 30); await page.waitForTimeout(30); }   // DK2 na lista de 989
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/e2e-1-lista-dk2.png` });

// --- 2. DK2 no RetroArch
const l1 = await launchSelected(DK2);
step("launch_dk2", l1);
if (l1.wrong) await fail("jogo errado selecionado: " + l1.rom);
await page.waitForTimeout(15000);
const f1 = gameFrame();
const gameLit = f1 ? await lit(f1) : 0;
await page.screenshot({ path: `${out}/e2e-2-dk2-rodando.png` });
step("dk2_lit", gameLit);
if (gameLit <= 0.02) await fail("tela do jogo preta");
// abertura da tradução (~30 s) e então Start algumas vezes: logos -> título -> tela de arquivos
await page.waitForTimeout(20000);
for (const k of ["Enter", "Enter", "Enter", "d", "a", "Enter"]) { await hold(k, 250); await page.waitForTimeout(3000); }
await page.screenshot({ path: `${out}/e2e-3-dk2-teclas.png` });
step("dk2_lit_after_keys", f1 ? await lit(f1) : 0);

// --- 3. Select+Start -> ES
const g1 = await exitGame();
step("exit_dk2", g1 && { code: g1.code, why: g1.why, started: g1.started });
if (!g1) await fail("Select+Start não saiu do jogo");
const esLit = await waitLit(page, 0.05, 20000);
await page.waitForTimeout(2000);
await page.screenshot({ path: `${out}/e2e-4-volta-es.png` });
step("es_back_lit", esLit);
if (esLit <= 0.05) await fail("ES não voltou");
if (await page.locator("#game").count()) await fail("iframe ficou na página");

// --- 4. save do DK3 continua igual ao semeado
const after = Buffer.from(await (await fetch(new URL(savePath, url))).arrayBuffer());
step("dk3_save_unchanged", { equal: after.equals(before), md5: md5(after) });
if (!after.equals(before)) await fail("save do DK3 mudou sem ter sido jogado");

// --- 5. DK3: o save semeado aparece na tela de arquivos
await hold("s"); await page.waitForTimeout(1500);   // DK2 -> DK3 (o ES lembra a posição)
await page.screenshot({ path: `${out}/e2e-5-lista-dk3.png` });
const l2 = await launchSelected(DK3);
step("launch_dk3", l2);
if (l2.wrong) await fail("jogo errado selecionado: " + l2.rom);
const f2 = gameFrame();
step("dk3_srm_loaded", await f2.evaluate(() => { try { return window.r36sPlay.module.FS.stat("/home/web_user/retroarch/userdata/saves/" +
  decodeURIComponent(new URLSearchParams(location.search).get("rom").split("/").pop().replace(/\.7z$/, ".srm"))).size; } catch (e) { return String(e); } }));
// abertura da tradução (~28 s, não pula) -> Rare -> Nintendo -> título. O título é a única tela com muito azul (água):
// quando aparece, Start abre a tela de arquivos. Não aperta mais nada: escolher arquivo começaria jogo novo (grava SRAM).
const blue = frame => frame.evaluate(() => {
  const c = document.getElementById("canvas"); const g = document.createElement("canvas"); g.width = c.width; g.height = c.height;
  const x = g.getContext("2d"); x.drawImage(c, 0, 0); const d = x.getImageData(0, 0, g.width, g.height).data; let n = 0;
  for (let i = 0; i < d.length; i += 16) if (d[i + 2] > d[i] + 40 && d[i + 2] > 90) n++;
  return n / (d.length / 16);
});
let title = false;
for (let t = Date.now(); Date.now() - t < 120000 && !title;) { if (await blue(f2) > 0.15) title = true; else await page.waitForTimeout(1500); }
step("dk3_title_seen", title);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/e2e-6a-dk3-titulo.png` });
await hold("Enter", 250); await page.waitForTimeout(5000);
await page.screenshot({ path: `${out}/e2e-6-dk3-arquivos.png` });
step("dk3_lit", await lit(f2));
const g2 = await exitGame();
step("exit_dk3", g2 && { code: g2.code, why: g2.why });
if (!g2) await fail("Select+Start não saiu do DK3");
await waitLit(page, 0.05, 20000); await page.waitForTimeout(2000);
await page.screenshot({ path: `${out}/e2e-7-volta-es.png` });
const after3 = Buffer.from(await (await fetch(new URL(savePath, url))).arrayBuffer());
// o snes9x grava a SRAM inteira que o cabeçalho da ROM traduzida declara (1024 Kbit = 128 KB); o arquivo do cartão
// tem 2 KB. O que importa: os 2 KB originais continuam iguais (nada foi perdido) e o .bak guarda a versão anterior.
step("dk3_save_after_play", { size: after3.length, first2kEqualSeed: after3.subarray(0, seed.length).equals(seed), md5: md5(after3) });
if (!after3.subarray(0, seed.length).equals(seed)) await fail("DK3: conteúdo do save semeado mudou");

const fatal = logs.filter(l => /PAGEERROR|RuntimeError|Aborted|abort\(/.test(l));
step("fatal", fatal);
await finish(fatal.length ? 1 : 0);
