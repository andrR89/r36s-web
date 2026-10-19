// node tests/analog_check.mjs [n64|dreamcast] [teclado|toque]
// O analógico chega ao jogo? N64: Super Mario 64, tela "Select File" (a mãozinha anda com o analógico).
// Dreamcast: Sonic Adventure 2 (menu inicial anda com o analógico). Compara o quadro antes/depois de segurar a seta
// para a direita (analógico esquerdo) e T (analógico direito). "toque": manda as teclas como o joystick de toque
// (KeyboardEvent sintético no canvas do jogo); "teclado": teclas reais do Playwright. O jogo abre pelo seletor do hub
// (window.r36s.launch, o mesmo que o Jogar da ficha) e roda no iframe #game: quadros e teclas sintéticas vão no iframe.
import { chromium } from "/home/andre/Workspace/web-ports/tools/pw/node_modules/playwright-core/index.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
const [sys = "n64", mode = "teclado"] = process.argv.slice(2);
const G = {
  n64: { core: "mupen64plus_next", rom: "/roms/n64/Super Mario 64 (USA).7z", boot: 14000, starts: 1, after: 5000 },
  dreamcast: { core: "flycast", rom: "/roms/dreamcast/Sonic Adventure 2.chd", boot: 30000, starts: 2, after: 6000 },
}[sys];
const out = "/home/andre/Workspace/web-ports/r36s/tests/out/analog";
mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const c = await b.newContext({ viewport: { width: 960, height: 720 } });
await c.addInitScript(() => {
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (t, a) { if (/webgl/.test(t)) a = Object.assign({}, a, { preserveDrawingBuffer: true }); return orig.call(this, t, a); };
});
if (mode === "controle") await c.addInitScript(() => {
  // o mesmo controle (hardware) visto pelo seletor e pelo iframe do jogo, como num navegador de verdade
  if (window !== window.top) { Object.defineProperty(Navigator.prototype, "getGamepads", { configurable: true, value: () => [window.top.__pad, null, null, null] }); return; }
  const pad = { id: "Xbox 360 Controller (XInput STANDARD GAMEPAD)", index: 0, connected: true, mapping: "standard", timestamp: 1,
    axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
  window.__pad = pad;
  Object.defineProperty(Navigator.prototype, "getGamepads", { configurable: true, value: () => { pad.timestamp++; return [pad, null, null, null]; } });
  addEventListener("load", () => { try { const e = new Event("gamepadconnected"); e.gamepad = pad; dispatchEvent(e); } catch (x) {} });
});
const p = await c.newPage(); const logs = [];
p.on("console", m => logs.push(m.text()));
await p.goto("http://localhost:8770/r36s/");
await p.waitForFunction(() => window.r36s && window.r36s.ready, null, { timeout: 120000 });
p.evaluate(g => window.r36s.launch(g), { system: sys, core: "", rom: G.rom }).catch(() => {});   // core "": o do cores.json
await p.waitForFunction(() => window.r36s.game && window.r36s.game.started, null, { timeout: 60000 });
const f = p.frames().find(x => /retroarch\/play\.html/.test(x.url()));   // o jogo (canvas, teclas sintéticas)
const core = await p.evaluate(() => window.r36s.game.core);
if (core !== G.core) console.log(`aviso: núcleo ${core}, esperado ${G.core}`);
const KEYS = { ArrowRight: ["ArrowRight", 39], ArrowDown: ["ArrowDown", 40], t: ["KeyT", 84], h: ["KeyH", 72], Enter: ["Enter", 13], d: ["KeyD", 68], s: ["KeyS", 83] };
const key = async (k, type) => {
  if (mode === "teclado") return type === "down" ? p.keyboard.down(k) : p.keyboard.up(k);
  const [code, keyCode] = KEYS[k];
  await f.evaluate(([type, key, code, keyCode]) => document.getElementById("canvas").dispatchEvent(new KeyboardEvent(type, { key, code, keyCode, which: keyCode, bubbles: true, cancelable: true })),
    [type === "down" ? "keydown" : "keyup", k, code, keyCode]);
};
const AXIS = { ArrowRight: [0, 1], ArrowDown: [1, 1], t: [3, -1], h: [2, 1] }, BTN = { Enter: 9, d: 15, s: 13 };
const padSet = (k, on) => p.evaluate(([a, bt, on]) => { const P = window.__pad; if (a) P.axes[a[0]] = on ? a[1] : 0; else P.buttons[bt] = { pressed: on, touched: on, value: on ? 1 : 0 }; },
  [AXIS[k] || null, BTN[k], on]);
const hold = async (k, ms) => {
  if (mode === "controle") { await padSet(k, true); await p.waitForTimeout(ms); await padSet(k, false); return; }
  await key(k, "down"); await p.waitForTimeout(ms); await key(k, "up");
};
const grab = () => f.evaluate(() => { const c = document.getElementById("canvas"); const g = document.createElement("canvas"); g.width = 160; g.height = 120;
  const x = g.getContext("2d"); x.drawImage(c, 0, 0, 160, 120); return Array.from(x.getImageData(0, 0, 160, 120).data.filter((_, i) => i % 4 === 1)); });
const diff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 24) n++; return +(n / a.length).toFixed(3); };
await p.waitForTimeout(G.boot);
if (mode === "controle") await f.evaluate(() => { const e = new Event("gamepadconnected"); e.gamepad = navigator.getGamepads()[0]; dispatchEvent(e); });
await p.waitForTimeout(500);
for (let i = 0; i < G.starts; i++) { await hold("Enter", 150); await p.waitForTimeout(G.after); }
const r = {};
const quiet = async () => { const a = await grab(); await p.waitForTimeout(1500); return diff(a, await grab()); };   // a tela anda sozinha?
r.parado = await quiet();
for (const k of ["ArrowRight", "ArrowDown", "t", "d", "s"]) {
  const a = await grab();
  await p.screenshot({ path: `${out}/${sys}-${mode}-${k}-antes.png` });
  await hold(k, 700); await p.waitForTimeout(600);
  r[k] = diff(a, await grab());
  await p.screenshot({ path: `${out}/${sys}-${mode}-${k}-depois.png` });
}
console.log(JSON.stringify({ sys, mode, core, ...r, inputLog: logs.filter(l => /autoconf|joypad|gamepad|pad |port #|connected|device/i.test(l)).slice(0, 12) }));
// sai com Select+Start (Backspace+Enter) e confere a volta ao seletor
await p.keyboard.down("Backspace"); await p.waitForTimeout(300); await p.keyboard.down("Enter"); await p.waitForTimeout(400);
await p.keyboard.up("Enter"); await p.keyboard.up("Backspace");
const back = await p.waitForFunction(() => !window.r36s.game, null, { timeout: 20000 }).then(() => true, () => false);
console.log(JSON.stringify({ exit: back ? await p.evaluate(() => ({ code: window.r36s.lastGame.code, why: window.r36s.lastGame.why })) : null }));
await b.close();
