// node tests/touch_sticks.mjs
// Analógicos de toque: aparecem só num jogo de sistema com analógico (aqui um jogo falso de N64 com um iframe que
// recebe as teclas) e mandam setas (esquerdo) e T/F/G/H (direito). Dois dedos: um em cada analógico.
import { chromium } from "/home/andre/Workspace/web-ports/tools/pw/node_modules/playwright-core/index.mjs";
const b = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const c = await b.newContext({ viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
const p = await c.newPage();
await p.goto("http://localhost:8770/r36s/");
await p.waitForFunction(() => window.r36s && window.r36s.ready, null, { timeout: 120000 });
await p.evaluate(() => window.r36s.controls && window.r36s.controls.close());
const visible = () => p.evaluate(() => [...document.querySelectorAll("#r36s-touch .stick")].map(e => getComputedStyle(e).display !== "none"));
const before = await visible();
// jogo falso: iframe com um canvas que anota as teclas
await p.evaluate(() => new Promise(res => {
  const f = document.createElement("iframe");
  f.srcdoc = '<canvas id="canvas"></canvas><script>window.keys=[];for (const t of ["keydown","keyup"]) document.getElementById("canvas").addEventListener(t, e => keys.push(t[3] + e.key));<\/script>';
  f.style.cssText = "position:fixed;left:200px;top:0;width:500px;height:375px;border:0";
  f.onload = () => { window.r36s.game = { rom: "/roms/n64/Teste.z64", iframe: f, started: true }; res(); };
  document.body.append(f);
}));
await p.waitForTimeout(500);
const during = await visible();
const box = s => p.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2, r.width]; }, s);
const [lx, ly, lw] = await box("#r36s-touch .stick.ls"), [rx, ry] = await box("#r36s-touch .stick.rs");
const cdp = await c.newCDPSession(p);
const t = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts });
// esquerdo: dedo no centro e arrasta para a direita; direito: dedo arrasta para cima
await t("touchStart", [{ x: lx, y: ly, id: 1 }]);
await t("touchMove", [{ x: lx + lw * 0.45, y: ly, id: 1 }]);
await t("touchStart", [{ x: lx + lw * 0.45, y: ly, id: 1 }, { x: rx, y: ry, id: 2 }]);
await t("touchMove", [{ x: lx + lw * 0.45, y: ly, id: 1 }, { x: rx, y: ry - lw * 0.45, id: 2 }]);
await p.waitForTimeout(150);
const knob = await p.evaluate(() => document.querySelector("#r36s-touch .stick.ls b").style.transform);
await p.screenshot({ path: "/home/andre/Workspace/web-ports/r36s/tests/out/sticks.png" });
await t("touchEnd", []);
await p.waitForTimeout(150);
const keys = await p.evaluate(() => document.querySelector("iframe").contentWindow.keys);
const knobAfter = await p.evaluate(() => document.querySelector("#r36s-touch .stick.ls b").style.transform);
const ok = !before.some(Boolean) && during.every(Boolean) && keys.includes("dArrowRight") && keys.includes("dt") &&
  keys.includes("uArrowRight") && keys.includes("ut") && /translate\(\d+px, 0px\)/.test(knob) && /translate\(0px, 0px\)/.test(knobAfter);
console.log(JSON.stringify({ ok, before, during, keys, knob, knobAfter }));
await b.close();
process.exit(ok ? 0 : 1);
