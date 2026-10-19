// node tests/nav_pad.mjs
// Seletor só no controle (simulado): o direcional anda entre as capas, A abre a ficha, B fecha e volta para a capa,
// Start na ficha joga, Select+Start sai do jogo e o foco volta para "Jogar".
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
await p.waitForFunction(() => window.r36s && window.r36s.ready, null, { timeout: 60000 });
const press = async (...btns) => {
  await p.evaluate(bs => { for (const i of bs) window.__pad.buttons[i] = { pressed: true, touched: true, value: 1 }; }, btns);
  await p.waitForTimeout(120);
  await p.evaluate(bs => { for (const i of bs) window.__pad.buttons[i] = { pressed: false, touched: false, value: 0 }; }, btns);
  await p.waitForTimeout(180);
};
const focused = () => p.evaluate(() => { const e = document.activeElement; return e && (e.dataset.rom || e.className || e.id); });
const r = {};
// do topo para a primeira capa da 1ª fileira de sistema: baixo algumas vezes até cair numa capa
for (let i = 0; i < 6 && !/^\/roms\//.test(await focused()); i++) await press(13);
r.first = await focused();
await press(15); r.right = await focused();          // direita
await press(1); await p.waitForTimeout(300);          // A (direita do controle = A do R36S) abre a ficha
r.sheet = await p.evaluate(() => !!document.getElementById("sheet") && document.activeElement.className);
await press(0); await p.waitForTimeout(300);          // B fecha
r.back = await focused();
await press(1); await p.waitForTimeout(300);
await press(9);                                       // Start na ficha = Jogar
await p.waitForFunction(() => window.r36s.game && window.r36s.game.started, null, { timeout: 90000 }).catch(() => {});
r.started = await p.evaluate(() => !!(window.r36s.game && window.r36s.game.started));
await p.keyboard.down("Backspace"); await p.waitForTimeout(300); await p.keyboard.down("Enter"); await p.waitForTimeout(400);
await p.keyboard.up("Enter"); await p.keyboard.up("Backspace");
await p.waitForFunction(() => !window.r36s.game, null, { timeout: 20000 }).catch(() => {});
await p.waitForTimeout(300);
r.after = await p.evaluate(() => document.activeElement && document.activeElement.className);
// fileiras do Início no PC e no celular: baixo da 1ª capa de uma fileira cai numa capa da fileira seguinte (não na barra
// lateral nem no "ver todos"); cima volta; baixo da 3ª capa continua numa capa
async function rows(viewport) {
  const ctx = await b.newContext({ viewport, ...(viewport.width < 900 ? { isMobile: true, hasTouch: true } : {}) });
  const q = await ctx.newPage(); q.on("pageerror", e => errs.push(e.message));
  await q.goto("http://localhost:8770/r36s/");
  await q.waitForFunction(() => window.r36s && window.r36s.ready, null, { timeout: 60000 });
  const at = () => q.evaluate(() => { const e = document.activeElement; return { rom: e.dataset.rom || null, row: e.closest(".row")?.dataset.row || null }; });
  const out = {};
  const start = n => q.evaluate(n => { const c = document.querySelectorAll('[data-sys="nes"] .cover')[n]; c.scrollIntoView({ block: "center" }); c.focus(); }, n);
  const next = await q.evaluate(() => document.querySelector('[data-sys="nes"]').nextElementSibling.dataset.row);
  await start(0); await q.waitForTimeout(300);
  await q.keyboard.press("ArrowDown"); await q.waitForTimeout(400); out.down = await at();
  await q.keyboard.press("ArrowUp"); await q.waitForTimeout(400); out.up = await at();
  await start(2); await q.waitForTimeout(300);
  await q.keyboard.press("ArrowDown"); await q.waitForTimeout(400); out.down3 = await at();
  out.ok = !!out.down.rom && out.down.row === next && out.up.row === "nes" && !!out.up.rom && !!out.down3.rom && out.down3.row === next;
  await ctx.close();
  return out;
}
r.rowsPC = await rows({ width: 1280, height: 800 });
r.rowsPhone = await rows({ width: 412, height: 915 });
const ok = r.rowsPC.ok && r.rowsPhone.ok && /^\/roms\//.test(r.first) && r.right !== r.first && /^\/roms\//.test(r.right) && /play/.test(r.sheet) && r.back === r.right && r.started && /play/.test(r.after) && !errs.length;
console.log(JSON.stringify({ ok, ...r, errs }));
await b.close();
process.exit(ok ? 0 : 1);
