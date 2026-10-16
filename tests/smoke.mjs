// node tests/smoke.mjs [url] [saida] — abre o ES headless, espera, navega e tira screenshots
import { chromium } from "/home/andre/Workspace/web-ports/tools/pw/node_modules/playwright-core/index.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
const url = process.argv[2] ?? "http://localhost:8770/r36s/";
const out = process.argv[3] ?? "/home/andre/Workspace/web-ports/r36s/tests/out";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
// o canvas precisa de preserveDrawingBuffer para o drawImage abaixo ler o último quadro (só no teste)
await page.addInitScript(() => {
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    if (/webgl/.test(type)) attrs = Object.assign({}, attrs, { preserveDrawingBuffer: true });
    return orig.call(this, type, attrs);
  };
});
const logs = [];
page.on("console", m => logs.push(m.text()));
page.on("response", r => { if (r.status() >= 400) logs.push(`HTTP ${r.status()} ${r.url()}`); });
page.on("pageerror", e => logs.push("PAGEERROR " + e.message + "\n" + e.stack));
// fração de pixels não-pretos no canvas: prova de que algo foi desenhado
const litNow = () => page.evaluate(() => {
  const c = document.getElementById("canvas"); if (!c.width) return 0;
  const g = document.createElement("canvas");
  g.width = c.width; g.height = c.height; const x = g.getContext("2d"); x.drawImage(c, 0, 0);
  const d = x.getImageData(0, 0, g.width, g.height).data; let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] + d[i+1] + d[i+2] > 30) n++;
  return n / (d.length / 4);
});
const t0 = Date.now();
await page.goto(url);
await page.waitForFunction(() => window.r36s?.ready, null, { timeout: 120000 });
const readyMs = Date.now() - t0;
// tempo até o ES aparecer: primeiro quadro com >5% de pixels acesos
let visibleMs = null;
for (let i = 0; i < 120 && visibleMs === null; i++) {
  if (await litNow() > 0.05) visibleMs = Date.now() - t0; else await page.waitForTimeout(250);
}
await page.waitForTimeout(5000);
await page.screenshot({ path: `${out}/1-sistemas.png` });
const lit1 = await litNow();
await page.keyboard.press("l");              // entra no sistema (A = L no layout WASD+JKUI)
await page.waitForTimeout(3000);
await page.screenshot({ path: `${out}/2-jogos.png` });
const lit2 = await litNow();
await page.keyboard.press("s"); await page.waitForTimeout(300);
await page.keyboard.press("s");
await page.waitForTimeout(2000);
await page.screenshot({ path: `${out}/3-jogo-selecionado.png` });
const lit = await litNow();
await page.keyboard.press("s");      // 4ª posição tem capa: prova a busca sob demanda ao mover
await page.waitForTimeout(2000);
await page.screenshot({ path: `${out}/4-jogo-com-capa.png` });
const fs = await page.evaluate(() => window.r36s?.fs?.stats);
const fatal = logs.filter(l => /abort|PAGEERROR|RuntimeError|Aborted/.test(l));
console.log(JSON.stringify({ lit: +lit.toFixed(3), lit1: +lit1.toFixed(3), lit2: +lit2.toFixed(3), readyMs, visibleMs, lazy: fs, fatal, tail: logs.slice(-25) }, null, 1));
writeFileSync(`${out}/console.log`, logs.join("\n") + "\n");
await browser.close();
process.exit(fatal.length || lit < 0.05 ? 1 : 0);
