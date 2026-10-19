// node tests/e2e_snes.mjs [url] [saida] — ponta a ponta pelo seletor: grade do SNES (#/s/snes) -> capa do DK2 -> ficha ->
// Jogar -> RetroArch (iframe) -> Select+Start (Backspace+Enter) -> volta à ficha com o foco no Jogar; confere que o save
// semeado do DK3 no servidor não mudou; abre o DK3 pela capa e fotografa a tela de arquivos (save carregado).
import { chromium } from "/home/andre/Workspace/web-ports/tools/pw/node_modules/playwright-core/index.mjs";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const url = process.argv[2] ?? "http://localhost:8770/r36s/";
const ROM = name => `/roms/snes/${name}.7z`;   // data-rom das capas
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
const gameFrame = () => page.frames().find(f => /retroarch\/play\.html/.test(f.url()));

// capa (data-rom) -> ficha -> Jogar; espera o jogo iniciar no iframe
async function launchCover(name) {
  const cover = page.locator(`.grid .cover[data-rom="${ROM(name)}"]`);
  if (!(await cover.count())) return { missing: true };
  await cover.click();
  await page.waitForSelector("#sheet .play");
  await page.click("#sheet .play");
  await page.waitForFunction(() => window.r36s.game, null, { timeout: 15000 });
  const rom = await page.evaluate(() => window.r36s.game.rom);
  if (rom !== ROM(name)) return { rom, wrong: true };
  await page.waitForFunction(() => window.r36s.game?.started, null, { timeout: 60000 });
  return { rom };
}
async function exitGame() {
  await selectStart();
  try { await page.waitForFunction(() => !window.r36s.game, null, { timeout: 20000 }); }
  catch (e) { return null; }
  return page.evaluate(() => window.r36s.lastGame);
}
const focusOnPlay = async () => { await page.waitForTimeout(300); return page.evaluate(() => document.activeElement === document.querySelector("#sheet .play")); };

// --- 1. grade do SNES no seletor
const seed = readFileSync(DK3_SEED);
const savePath = `saves/snes/${encodeURIComponent(DK3 + ".srm")}`;
const before = Buffer.from(await (await fetch(new URL(savePath, url))).arrayBuffer());
step("dk3_save_seed", { server: md5(before), card: md5(seed), equal: before.equals(seed) });
await page.goto(url + "#/s/snes");
await page.waitForFunction(() => window.r36s?.ready, null, { timeout: 120000 });
await page.waitForSelector(".grid .cover", { timeout: 30000 });
const covers = await page.evaluate(([a, b]) => { const all = [...document.querySelectorAll(".grid .cover")].map(c => c.dataset.rom);
  return { total: all.length, dk2: all.indexOf(a), dk3: all.indexOf(b) }; }, [ROM(DK2), ROM(DK3)]);
step("covers", covers);
if (covers.dk2 < 0 || covers.dk3 < 0) await fail("DK2/DK3 não estão na grade do SNES");
await page.locator(`.grid .cover[data-rom="${ROM(DK2)}"]`).scrollIntoViewIfNeeded();
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/e2e-1-lista-dk2.png` });

// --- 2. DK2 no RetroArch
const l1 = await launchCover(DK2);
step("launch_dk2", l1);
if (l1.missing || l1.wrong) await fail("jogo errado/ausente: " + JSON.stringify(l1));
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

// --- 3. Select+Start -> ficha do DK2, foco no Jogar
const g1 = await exitGame();
step("exit_dk2", g1 && { code: g1.code, why: g1.why, started: g1.started });
if (!g1) await fail("Select+Start não saiu do jogo");
const focus1 = await focusOnPlay();
await page.screenshot({ path: `${out}/e2e-4-volta-ficha.png` });
step("back_focus_play", focus1);
if (!focus1) await fail("foco não voltou para o Jogar da ficha");
if (await page.locator("#game").count()) await fail("iframe ficou na página");

// --- 4. save do DK3 continua igual ao semeado
const after = Buffer.from(await (await fetch(new URL(savePath, url))).arrayBuffer());
step("dk3_save_unchanged", { equal: after.equals(before), md5: md5(after) });
if (!after.equals(before)) await fail("save do DK3 mudou sem ter sido jogado");

// --- 5. DK3: o save semeado aparece na tela de arquivos
await page.click("#sheet .x");   // fecha a ficha do DK2 (volta à grade)
await page.waitForSelector("#sheet", { state: "detached" });
await page.locator(`.grid .cover[data-rom="${ROM(DK3)}"]`).scrollIntoViewIfNeeded();
await page.waitForTimeout(1000);
await page.screenshot({ path: `${out}/e2e-5-lista-dk3.png` });
const l2 = await launchCover(DK3);
step("launch_dk3", l2);
if (l2.missing || l2.wrong) await fail("jogo errado/ausente: " + JSON.stringify(l2));
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
const focus2 = await focusOnPlay();
await page.screenshot({ path: `${out}/e2e-7-volta-ficha.png` });
step("back_focus_play_dk3", focus2);
if (!focus2) await fail("foco não voltou para o Jogar da ficha do DK3");
const after3 = Buffer.from(await (await fetch(new URL(savePath, url))).arrayBuffer());
// o snes9x grava a SRAM inteira que o cabeçalho da ROM traduzida declara (1024 Kbit = 128 KB); o arquivo do cartão
// tem 2 KB. O que importa: os 2 KB originais continuam iguais (nada foi perdido) e o .bak guarda a versão anterior.
step("dk3_save_after_play", { size: after3.length, first2kEqualSeed: after3.subarray(0, seed.length).equals(seed), md5: md5(after3) });
if (!after3.subarray(0, seed.length).equals(seed)) await fail("DK3: conteúdo do save semeado mudou");

const fatal = logs.filter(l => /PAGEERROR|RuntimeError|Aborted|abort\(/.test(l));
step("fatal", fatal);
await finish(fatal.length ? 1 : 0);
