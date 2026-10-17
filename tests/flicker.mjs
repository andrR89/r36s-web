// node tests/flicker.mjs [atraso_ms]
// Reproduz a "piscada" ao trocar de jogo com capa ainda não baixada: ES do hub com as capas (media/images) atrasadas
// de propósito (imita o Drive no celular), desce a lista e fotografa o canvas a cada 50 ms. Mede quantas fotos saem
// quase pretas e guarda as piores em tests/out/flicker/.
import { chromium } from "/home/andre/Workspace/web-ports/tools/pw/node_modules/playwright-core/index.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
const delay = +(process.argv[2] || 800);
const out = "/home/andre/Workspace/web-ports/r36s/tests/out/flicker";
mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const c = await b.newContext({ viewport: { width: 915, height: 412 } });
await c.addInitScript(() => {
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    if (/webgl/.test(type)) attrs = Object.assign({}, attrs, { preserveDrawingBuffer: true });
    return orig.call(this, type, attrs);
  };
});
const p = await c.newPage();
let delayed = 0;
await p.route(/\/r36s\/fs\/roms\/[^/]+\/media\/images\//, async r => { delayed++; await new Promise(x => setTimeout(x, delay)); r.continue(); });
await p.goto("http://localhost:8770/r36s/");
await p.waitForFunction(() => window.r36s && window.r36s.ready, null, { timeout: 120000 });
await p.waitForTimeout(3000);
await p.evaluate(() => window.r36s.controls && window.r36s.controls.close());
const press = async k => { await p.keyboard.down(k); await p.waitForTimeout(80); await p.keyboard.up(k); };
await press("l"); await p.waitForTimeout(3000);   // entra no primeiro sistema
// brilho médio do canvas visível (a foto da página é o que o usuário vê)
const shot = async i => {
  const buf = await p.screenshot({ type: "jpeg", quality: 50 });
  const lum = await p.evaluate(async b64 => {
    const img = new Image(); img.src = "data:image/jpeg;base64," + b64; await img.decode();
    const g = document.createElement("canvas"); g.width = 92; g.height = 41; const x = g.getContext("2d"); x.drawImage(img, 0, 0, 92, 41);
    const d = x.getImageData(0, 0, 92, 41).data; let s = 0; for (let k = 0; k < d.length; k += 4) s += d[k] + d[k + 1] + d[k + 2];
    return Math.round(s / (d.length / 4) / 3);
  }, buf.toString("base64"));
  return { i, lum, buf };
};
const frames = [];
for (let step = 0; step < 6; step++) {
  const t = Date.now();
  p.keyboard.down("s").then(() => p.waitForTimeout(80)).then(() => p.keyboard.up("s"));
  while (Date.now() - t < delay + 700) { frames.push({ step, ms: Date.now() - t, ...(await shot(frames.length)) }); await p.waitForTimeout(30); }
}
const base = frames.map(f => f.lum).sort((a, b) => a - b)[Math.floor(frames.length * 0.8)];
const dark = frames.filter(f => f.lum < base * 0.5);
for (const f of dark.slice(0, 4)) writeFileSync(`${out}/escuro-${f.step}-${f.ms}ms.jpg`, f.buf);
writeFileSync(`${out}/normal.jpg`, frames[frames.length - 1].buf);
console.log(JSON.stringify({ delay, delayed, fotos: frames.length, brilhoNormal: base, escuras: dark.length,
  porPasso: [...new Set(frames.map(f => f.step))].map(s => frames.filter(f => f.step === s).map(f => f.lum).join(",")) }, null, 1));
await b.close();
