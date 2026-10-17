// node tests/play_one.mjs <sistema> <rom /roms/...> [núcleo] [segundos] [saida]
// Abre só o player (retroarch/play.html, sem o ES), espera o primeiro quadro, deixa rodar N segundos apertando Enter (Start)
// algumas vezes, mede FPS aproximado (rAF) e quadros do núcleo (contagem de swaps do GL), grava screenshot e o log do RetroArch.
// Ferramenta de desenvolvimento para núcleos novos (build/build-core.sh); o teste de verdade é o e2e_systems.mjs.
// Ambiente: R36S_URL = base do site (padrão http://localhost:8770/r36s/); PLAY_QS = parâmetros extras do play.html
// (ex.: hud=1 liga o HUD do flycast, "FPS:<emulados>/<alvo>", lido para "hud" no resultado).
import { chromium } from "/home/andre/Workspace/web-ports/tools/pw/node_modules/playwright-core/index.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
const [system, rom, core = "", secs = "20", outArg] = process.argv.slice(2);
const out = outArg || "/home/andre/Workspace/web-ports/r36s/tests/out";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
await page.addInitScript(() => {
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    if (/webgl/.test(type)) attrs = Object.assign({}, attrs, { preserveDrawingBuffer: true });
    return orig.call(this, type, attrs);
  };
});
const logs = [];
page.on("console", m => logs.push(`${m.type()}: ${m.text()}`));
page.on("pageerror", e => logs.push("PAGEERROR " + e.message + "\n" + e.stack));
const lit = () => page.evaluate(() => {
  const c = document.getElementById("canvas"); if (!c || !c.width) return 0;
  const g = document.createElement("canvas"); g.width = c.width; g.height = c.height;
  const x = g.getContext("2d"); x.drawImage(c, 0, 0);
  const d = x.getImageData(0, 0, g.width, g.height).data; let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 30) n++;
  return +(n / (d.length / 4)).toFixed(3);
}).catch(() => 0);
const t0 = Date.now();
const base = process.env.R36S_URL || "http://localhost:8770/r36s/";
await page.goto(base + "retroarch/play.html?" + new URLSearchParams({ system, core, rom }) + (process.env.PLAY_QS ? "&" + process.env.PLAY_QS : ""));
const r = { system, rom, core };
let v = 0;
while (Date.now() - t0 < 120000) { v = await lit(); if (v > 0.01) break; if (logs.some(l => /PAGEERROR|RuntimeError/.test(l))) break; await page.waitForTimeout(250); }
r.firstLitMs = Date.now() - t0; r.firstLit = v;
const end = Date.now() + Number(secs) * 1000;
let k = 0;
while (Date.now() < end) {
  if (k++ % 4 === 1) { await page.keyboard.down("Enter"); await page.waitForTimeout(150); await page.keyboard.up("Enter"); }
  await page.waitForTimeout(1000);
}
r.fps = await page.evaluate(() => new Promise(res => { let n = 0; const t = performance.now();
  const f = () => { n++; if (performance.now() - t < 5000) requestAnimationFrame(f); else res(+(n / ((performance.now() - t) / 1000)).toFixed(1)); };
  requestAnimationFrame(f); }));
r.lit = await lit();
r.hud = await page.evaluate(() => document.getElementById("fc-hud")?.textContent || null);
r.started = await page.evaluate(() => window.r36sPlay && window.r36sPlay.started);
await page.screenshot({ path: `${out}/play-${system}.png` });
writeFileSync(`${out}/play-${system}.log`, logs.join("\n") + "\n");
r.errors = logs.filter(l => /PAGEERROR|RuntimeError|abort|\[ERROR\]/.test(l)).slice(0, 8);
console.log(JSON.stringify(r, null, 1));
await browser.close();
