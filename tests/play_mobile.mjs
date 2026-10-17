// node tests/play_mobile.mjs <sistema> <rom /roms/...> <núcleo> [segundos]
// Abre o player num celular emulado (toque): confere as opções de celular no log e se o jogo desenha e anda.
import { chromium } from "/home/andre/Workspace/web-ports/tools/pw/node_modules/playwright-core/index.mjs";
const [system, rom, core, secs = "25"] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const c = await b.newContext({ viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true });
await c.addInitScript(() => {
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (t, a) { if (/webgl/.test(t)) a = Object.assign({}, a, { preserveDrawingBuffer: true }); return orig.call(this, t, a); };
});
const p = await c.newPage(); const logs = [];
p.on("console", m => logs.push(m.text())); p.on("pageerror", e => logs.push("PAGEERROR " + e.message));
await p.goto("http://localhost:8770/r36s/retroarch/play.html?" + new URLSearchParams({ system, core, rom }));
const lit = () => p.evaluate(() => { const c = document.getElementById("canvas"); if (!c || !c.width) return 0; const g = document.createElement("canvas"); g.width = 64; g.height = 48;
  const x = g.getContext("2d"); x.drawImage(c, 0, 0, 64, 48); const d = x.getImageData(0, 0, 64, 48).data; let n = 0, h = 0;
  for (let i = 0; i < d.length; i += 4) { if (d[i] + d[i + 1] + d[i + 2] > 30) n++; h = (h * 31 + d[i]) >>> 0; } return [+(n / (d.length / 4)).toFixed(2), h]; }).catch(() => [0, 0]);
const seen = new Set(), t0 = Date.now();
while (Date.now() - t0 < +secs * 1000) { const [l, h] = await lit(); if (l > 0.01) seen.add(h); await p.waitForTimeout(1000); }
const [l] = await lit();
console.log(JSON.stringify({ lit: l, quadrosDiferentes: seen.size, opcoes: logs.filter(x => /celular/.test(x)), erros: logs.filter(x => /PAGEERROR|RuntimeError|Aborted/.test(x)).slice(0, 3) }));
await b.close();
