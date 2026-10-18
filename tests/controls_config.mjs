// node tests/controls_config.mjs
// Aba "Configurar": remapear uma tecla (Espaço vira A no ES), remapear um botão do controle (A no botão X/esquerda),
// jogadores (1 controle = P1 no automático; "teclado é o P1" inverte), tamanho do toque, restaurar o padrão.
import { chromium } from "/home/andre/Workspace/web-ports/tools/pw/node_modules/playwright-core/index.mjs";
const b = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const c = await b.newContext({ viewport: { width: 1280, height: 800 } });
await c.addInitScript(() => {
  if (window !== window.top) return;
  const pad = { id: "Xbox 360 Controller (XInput STANDARD GAMEPAD)", index: 0, connected: true, mapping: "standard", timestamp: 1,
    axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
  window.__pad = pad;
  Object.defineProperty(Navigator.prototype, "getGamepads", { configurable: true, writable: true, value: () => [pad, null, null, null] });
});
const p = await c.newPage();
const errs = []; p.on("pageerror", e => errs.push(e.message));
await p.goto("http://localhost:8770/r36s/");
await p.waitForFunction(() => window.r36s && window.r36s.ready, null, { timeout: 120000 });
await p.evaluate(() => localStorage.removeItem("r36s-controles-v1"));
await p.evaluate(() => { window.__keys = []; document.getElementById("canvas").addEventListener("keydown", e => window.__keys.push(e.key)); });
const r = {};
const badges = () => p.evaluate(() => document.getElementById("r36s-badges").innerText.replace(/\s+/g, " "));
await p.waitForTimeout(800);
r.p1auto = await badges();
// abre o painel na aba Configurar
await p.evaluate(() => window.r36s.controls.open());
await p.click("#r36s-panel .tabs button:has-text('Configurar')");
await p.waitForSelector("#r36s-panel .tab-config");
await p.screenshot({ path: "/home/andre/Workspace/web-ports/r36s/tests/out/config-tab.png" });
// teclado: A -> Espaço
await p.click('#r36s-panel [data-key-action="a"]');
r.waiting = await p.textContent('#r36s-panel [data-key-action="a"] b');
await p.keyboard.press("Space");
r.keyLabel = await p.textContent('#r36s-panel [data-key-action="a"] b');
// controle: A -> botão 2 (X, esquerda)
await p.click('#r36s-panel [data-pad-action="a"]');
await p.waitForTimeout(200);
await p.evaluate(() => { window.__pad.buttons[2] = { pressed: true, touched: true, value: 1 }; });
await p.waitForTimeout(200);
await p.evaluate(() => { window.__pad.buttons[2] = { pressed: false, touched: false, value: 0 }; });
await p.waitForTimeout(200);
r.padLabel = await p.textContent('#r36s-panel [data-pad-action="a"] b');
// jogadores: teclado é o P1
await p.click("#r36s-panel .seg button:has-text('Teclado/toque é o P1')");
await p.waitForTimeout(200);
r.p1kb = await badges();
r.saved = await p.evaluate(() => JSON.parse(localStorage.getItem("r36s-controles-v1")));
await p.evaluate(() => window.r36s.controls.close());
// no ES: Espaço vira "l" (A); L físico não vale mais
await p.evaluate(() => { window.__keys = []; document.getElementById("canvas").focus(); });
await p.keyboard.press("Space"); await p.keyboard.press("l");
await p.waitForTimeout(200);
r.esKeys = await p.evaluate(() => window.__keys.slice());
// controle no ES: botão 2 agora é A -> tecla "l"
await p.evaluate(() => { window.__keys = []; window.__pad.buttons[2] = { pressed: true, touched: true, value: 1 }; });
await p.waitForTimeout(150);
await p.evaluate(() => { window.__pad.buttons[2] = { pressed: false, touched: false, value: 0 }; });
await p.waitForTimeout(200);
r.esPad = await p.evaluate(() => window.__keys.slice());
// restaurar
await p.evaluate(() => window.r36s.controls.open());
await p.click("#r36s-panel .tabs button:has-text('Configurar')");
await p.click("#r36s-panel .reset");
r.afterReset = await p.evaluate(() => JSON.parse(localStorage.getItem("r36s-controles-v1")).keys);
r.p1afterReset = await badges();
const ok = /P1 · Controle Xbox/.test(r.p1auto) && /aperte/.test(r.waiting) && r.keyLabel === "Espaço" && r.padLabel === "X (esquerda)" &&
  /P1 · Teclado/.test(r.p1kb) && r.saved.keys.a === "Space" && r.saved.pad.a === "b:2" && r.saved.players === "teclado-p1" &&
  r.esKeys.join() === "l" && r.esPad.includes("l") && Object.keys(r.afterReset).length === 0 && /P1 · Controle Xbox/.test(r.p1afterReset) && !errs.length;
console.log(JSON.stringify({ ok, ...r, errs }));
await b.close();
process.exit(ok ? 0 : 1);
