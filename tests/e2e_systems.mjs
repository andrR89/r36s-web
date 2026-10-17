// node tests/e2e_systems.mjs [url] [saida] [sistemas,separados,por,vírgula]
// Ponta a ponta por sistema, pelo ES de verdade e só com teclado: recarrega o ES, anda no carrossel (vertical no EPICMAX) com S até o sistema
// (posição = ordem do es_systems.cfg entre os visíveis, depois da coleção Favoritos; data/mkcores.py grava "order" e
// "hidden" em web/data/cores.json), entra com L (A), lança o 1º jogo da lista com L (se a 1ª entrada for pasta, L de novo),
// espera o jogo desenhar no iframe, mede FPS aproximado (rAF do iframe), sai com Backspace+Enter e confere a volta ao ES.
// Sistema sem núcleo web: confere o aviso (#notice) e que o ES continua na lista. O sistema lançado é conferido pelo
// caminho da ROM (/roms/<sistema>/...). Resultado: tests/out/e2e-systems.json + e2e-sys-<sistema>.png
import { chromium } from "/home/andre/Workspace/web-ports/tools/pw/node_modules/playwright-core/index.mjs";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
const url = process.argv[2] || "http://localhost:8770/r36s/";
const out = process.argv[3] || "/home/andre/Workspace/web-ports/r36s/tests/out";
const SAMPLE = "snes,nes,gb,gbc,gba,megadrive,mastersystem,pcengine,psx,n64,nds,neogeo,atarilynx,atari2600,atari7800,cps1,mame,gamegear,pico-8,sega32x,psp,easyrpg,dreamcast";
const want = (process.argv[4] ?? SAMPLE).split(",").filter(Boolean);
mkdirSync(out, { recursive: true });
const cores = JSON.parse(readFileSync(new URL("../web/data/cores.json", import.meta.url)));
const visible = Object.entries(cores.systems).filter(([, s]) => !s.hidden).sort((a, b) => a[1].order - b[1].order).map(([k]) => k);

const browser = await chromium.launch({ executablePath: "/usr/bin/chromium",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
await page.addInitScript(() => {   // vale também para o iframe do jogo: o teste lê o último quadro
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    if (/webgl/.test(type)) attrs = Object.assign({}, attrs, { preserveDrawingBuffer: true });
    return orig.call(this, type, attrs);
  };
});
const logs = [];
page.on("console", m => logs.push(`${m.type()}: ${m.text()}`));
page.on("response", r => { if (r.status() >= 400 && !/\/saves\//.test(r.url()) && !/\.srm$|\/config\//.test(decodeURIComponent(r.url()))) logs.push(`HTTP ${r.status()} ${r.url()}`); });
page.on("pageerror", e => logs.push("PAGEERROR " + e.message));

const lit = frame => frame.evaluate(() => {
  const c = document.getElementById("canvas"); if (!c || !c.width) return 0;
  const g = document.createElement("canvas"); g.width = c.width; g.height = c.height;
  const x = g.getContext("2d"); x.drawImage(c, 0, 0);
  const d = x.getImageData(0, 0, g.width, g.height).data; let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 30) n++;
  return +(n / (d.length / 4)).toFixed(3);
}).catch(() => 0);
const tap = async (k, ms = 120) => { await page.keyboard.down(k); await page.waitForTimeout(ms); await page.keyboard.up(k); };
const waitLit = async (frame, min, ms) => { const t = Date.now(); let v = 0; while (Date.now() - t < ms) { v = await lit(frame); if (v > min) return v; await page.waitForTimeout(250); } return v; };
const gameFrame = () => page.frames().find(f => /retroarch\/play\.html/.test(f.url()));
const fpsOf = frame => frame.evaluate(() => new Promise(res => {   // callbacks de rAF em 5 s no iframe (o RetroArch roda 1 quadro por rAF)
  let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 5000) requestAnimationFrame(f); else res(+(n / ((performance.now() - t0) / 1000)).toFixed(1)); };
  requestAnimationFrame(f);
})).catch(() => null);

const results = [];
for (const system of want) {
  const r = { system, core: cores.systems[system]?.core ?? null };
  results.push(r);
  const idx = visible.indexOf(system);
  if (idx < 0) { r.error = "sistema não está no carrossel"; continue; }
  try {
    await page.goto(url);
    await page.waitForFunction(() => window.r36s?.ready, null, { timeout: 120000 });
    if (await waitLit(page, 0.05, 30000) <= 0.05) throw new Error("ES não apareceu");
    await page.waitForTimeout(2500);
    for (let i = 0; i <= idx; i++) { await tap("s"); await page.waitForTimeout(150); }   // carrossel vertical do EPICMAX; Favoritos é o 0
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${out}/e2e-sys-${system}-0-carrossel.png` });
    await tap("l"); await page.waitForTimeout(2500);   // entra no sistema
    let launched = false, t0 = 0;
    for (let tries = 0; tries < 3 && !launched; tries++) {
      t0 = Date.now();
      await tap("l");
      launched = await page.waitForFunction(() => window.r36s.game || window.r36s.lastGame, null, { timeout: 6000 }).then(() => true, () => false);
    }
    if (!launched) throw new Error("nada foi lançado");
    const g = await page.evaluate(() => { const x = window.r36s.game || window.r36s.lastGame; return { rom: x.rom, core: x.core, why: x.why }; });
    Object.assign(r, { rom: g.rom });
    if (!g.rom.startsWith(`/roms/${system}/`)) r.wrongSystem = true;
    if (!r.core) {   // sem núcleo web: aviso por cima do ES, ES continua na lista
      r.notice = await page.locator("#notice").textContent().catch(() => null);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${out}/e2e-sys-${system}.png` });
      await page.waitForTimeout(3500);
      r.noticeGone = !(await page.locator("#notice").count());
      r.esLit = await waitLit(page, 0.05, 10000);
      r.ok = !!r.notice && r.esLit > 0.05 && g.why === "sem núcleo web" && !r.wrongSystem;
      continue;
    }
    await page.waitForFunction(() => window.r36s.game?.started || !window.r36s.game, null, { timeout: 120000 });
    if (!(await page.evaluate(() => !!window.r36s.game))) throw new Error("jogo fechou antes de iniciar: " + JSON.stringify(await page.evaluate(() => window.r36s.lastGame)));
    r.coreUsed = await page.evaluate(() => window.r36s.game.core);
    const f = gameFrame();
    const firstLit = await waitLit(f, 0.01, 90000);
    r.loadMs = Date.now() - t0;
    r.firstLit = firstLit;
    await page.waitForTimeout(6000);
    r.contentLit = await waitLit(f, 0.08, 40000);   // telas pretas/carregando no começo (CPS, PS1): espera conteúdo
    for (const k of ["Enter", "Enter"]) { await tap(k, 200); await page.waitForTimeout(2000); }   // passa a abertura
    r.fps = await fpsOf(f);
    r.lit = await lit(f);
    r.lazy = await f.evaluate(() => window.r36sPlay.lazy).catch(() => null);
    await page.screenshot({ path: `${out}/e2e-sys-${system}.png` });
    // Backspace (Select) segurado + Enter (Start) = sair
    await page.keyboard.down("Backspace"); await page.waitForTimeout(300);
    await page.keyboard.down("Enter"); await page.waitForTimeout(400);
    await page.keyboard.up("Enter"); await page.keyboard.up("Backspace");
    const back = await page.waitForFunction(() => !window.r36s.game, null, { timeout: 20000 }).then(() => true, () => false);
    r.exit = back ? await page.evaluate(() => ({ code: window.r36s.lastGame.code, why: window.r36s.lastGame.why })) : null;
    r.esLit = back ? await waitLit(page, 0.05, 20000) : 0;
    r.iframeGone = !(await page.locator("#game").count());
    r.ok = firstLit > 0.01 && back && r.esLit > 0.05 && r.iframeGone && !r.wrongSystem && r.exit.code === 0;
  } catch (e) { r.error = String(e.message || e).slice(0, 300); }
  finally { console.log(JSON.stringify(r)); }
}
writeFileSync(`${out}/e2e-systems-console.log`, logs.join("\n") + "\n");
writeFileSync(`${out}/e2e-systems.json`, JSON.stringify(results, null, 1));
const bad = results.filter(r => !r.ok);
console.log(JSON.stringify({ ok: results.length - bad.length, total: results.length, bad: bad.map(r => r.system),
  errors: logs.filter(l => /PAGEERROR|abort|RuntimeError/.test(l)).slice(-10) }, null, 1));
await browser.close();
process.exit(bad.length ? 1 : 0);
