// node tests/touch_game.mjs
// Caminho completo do celular: ES do hub em tela de toque, abre o Super Mario 64 pela ponte do ES (o mesmo que escolher
// na lista), chega na tela "Select File" e arrasta o dedo no analógico esquerdo da tela: a mãozinha tem que andar.
import { chromium } from "/home/andre/Workspace/web-ports/tools/pw/node_modules/playwright-core/index.mjs";
const b = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const c = await b.newContext({ viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
await c.addInitScript(() => {
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (t, a) { if (/webgl/.test(t)) a = Object.assign({}, a, { preserveDrawingBuffer: true }); return orig.call(this, t, a); };
});
const PAD = process.argv[2] === "controle";
// SYS=dreamcast: Sonic Adventure 2 (2 Starts até a escolha de arquivo; o analógico para baixo muda a seleção)
const DC = process.env.SYS === "dreamcast";
const GAME = DC ? { system: "dreamcast", core: "flycast", rom: "/roms/dreamcast/Sonic Adventure 2.chd", boot: 30000, starts: 2, after: 6000 }
  : { system: "n64", core: "mupen64plus_next", rom: "/roms/n64/Super Mario 64 (USA).7z", boot: 14000, starts: 1, after: 5000 };
if (PAD) await c.addInitScript(() => {
  // o mesmo controle (hardware) visto por todos os documentos, como num navegador de verdade
  if (window !== window.top) { Object.defineProperty(Navigator.prototype, "getGamepads", { configurable: true, writable: true, value: function () { return [window.top.__pad, null, null, null]; } }); return; }
  const pad = { id: "Xbox 360 Controller (XInput STANDARD GAMEPAD)", index: 0, connected: true, mapping: "standard", timestamp: 1,
    axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
  window.__pad = pad;
  Object.defineProperty(Navigator.prototype, "getGamepads", { configurable: true, writable: true, value: function () { pad.timestamp++; return [window.top.__pad, null, null, null]; } });
});
const p = await c.newPage();
await p.goto("http://localhost:8770/r36s/");
await p.waitForFunction(() => window.r36s && window.r36s.ready, null, { timeout: 120000 });
await p.evaluate(() => window.r36s.controls && window.r36s.controls.close());
p.evaluate(g => window.r36s.Module.webLaunch({ system: g.system, core: g.core, rom: g.rom }), GAME).catch(() => {});
await p.waitForFunction(() => window.r36s.game && window.r36s.game.started, null, { timeout: 60000 });
const gf = () => p.frames().find(f => /retroarch\/play\.html/.test(f.url()));
const cdp = await c.newCDPSession(p);
const tap = async sel => { const [x, y] = await p.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, sel);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 9 }] }); await p.waitForTimeout(150);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); };
await p.waitForTimeout(GAME.boot);
const padBtn = async (i, on) => p.evaluate(([i, on]) => { window.__pad.buttons[i] = { pressed: on, touched: on, value: on ? 1 : 0 }; }, [i, on]);
if (PAD) {
  // o controle "aparece" no iframe do jogo como num aparelho de verdade: gamepadconnected no documento do jogo
  await gf().evaluate(() => { const e = new Event("gamepadconnected"); e.gamepad = navigator.getGamepads()[0]; dispatchEvent(e); });
  await p.waitForTimeout(500);
  await padBtn(9, true); await p.waitForTimeout(150); await padBtn(9, false);
  if (DC) { await p.waitForTimeout(GAME.after); await padBtn(9, true); await p.waitForTimeout(150); await padBtn(9, false); }
} else { await tap('#r36s-touch [data-btn="start"]'); if (DC) { await p.waitForTimeout(GAME.after); await tap('#r36s-touch [data-btn="start"]'); } }
await p.waitForTimeout(GAME.after);
const analog = await p.evaluate(() => document.body.classList.contains("r36s-analog"));
const grab = () => gf().evaluate(() => { const c = document.getElementById("canvas"); const g = document.createElement("canvas"); g.width = 160; g.height = 120;
  const x = g.getContext("2d"); x.drawImage(c, 0, 0, 160, 120); return Array.from(x.getImageData(0, 0, 160, 120).data.filter((_, i) => i % 4 === 1)); });
const diff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 24) n++; return +(n / a.length).toFixed(3); };
const a0 = await grab(); await p.waitForTimeout(1200); const parado = diff(a0, await grab());
const [lx, ly, lw] = await p.evaluate(() => { const r = document.querySelector("#r36s-touch .stick.ls").getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2, r.width]; });
const a = await grab();
if (PAD) {
  await p.evaluate(i => { window.__pad.axes[i] = 1; }, DC ? 1 : 0); await p.waitForTimeout(700); await p.evaluate(i => { window.__pad.axes[i] = 0; }, DC ? 1 : 0);
} else {
  // dedo a "frac" do raio para a direita por 700 ms; devolve o eixo X visto pelo jogo no meio do gesto
  var drag = async frac => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: lx, y: ly, id: 1 }] });
    for (let k = 1; k <= 5; k++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [DC ? { x: lx, y: ly + lw / 2 * frac * k / 5, id: 1 } : { x: lx + lw / 2 * frac * k / 5, y: ly, id: 1 }] }); await p.waitForTimeout(40); }
    await p.waitForTimeout(300);
    const seen = await gf().evaluate(() => { const g = navigator.getGamepads()[0]; return g ? { id: g.id.slice(0, 10), x: g.axes[0] || g.axes[1] } : null; });
    await p.waitForTimeout(400);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    return seen;
  };
  var full = await drag(1);
}
await p.waitForTimeout(500);
const moved = diff(a, await grab());
await p.screenshot({ path: "/home/andre/Workspace/web-ports/r36s/tests/out/touch-game.png" });
const raLog = await gf().evaluate(() => (window.r36sPlay && window.r36sPlay.log || []).filter(l => /Autoconf|Device/.test(l)).slice(0, 3)).catch(() => []);
let half = null;
if (!PAD) { await p.waitForTimeout(800); half = await drag(0.4); }
// a tela parada pode piscar um pouco (borda animada no menu do SA2): o analógico tem que mudar bem mais que isso
const ok = analog && moved > 0.005 && moved > 2 * parado + 0.003 && (PAD || (full && full.id === "R36S Toque" && full.x > 0.95 && half && half.x > 0.15 && half.x < 0.45));
console.log(JSON.stringify({ ok, modo: PAD ? "controle" : "toque", analog, parado, moved, full: typeof full === "undefined" ? null : full, half }));
await b.close();
process.exit(ok ? 0 : 1);
