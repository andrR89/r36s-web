// node tests/quit_loading.mjs
// Jogo grande ainda baixando (kof2000.7z, pedaços atrasados de propósito): a tela mostra o progresso, o menu ≡
// responde e "Sair do jogo" volta para a lista na hora; Select+Start no toque também.
import { chromium } from "/home/andre/Workspace/web-ports/tools/pw/node_modules/playwright-core/index.mjs";
const b = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const c = await b.newContext({ viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true });
await c.route(/\/r36s\/fs\/roms\/neogeo\/kof2000\.7z/, async r => { await new Promise(x => setTimeout(x, 1500)); r.continue(); });
const p = await c.newPage();
await p.goto("http://localhost:8770/r36s/");
await p.waitForFunction(() => window.r36s && window.r36s.ready, null, { timeout: 120000 });
const launch = () => p.evaluate(() => { window.__code = null; window.r36s.launch({ system: "neogeo", core: "fbneo", rom: "/roms/neogeo/kof2000.7z" }).then(c => { window.__code = c; }); });
const gf = () => p.frames().find(f => /retroarch\/play\.html/.test(f.url()));
const r = {};
// 1) menu ≡ -> Sair do jogo
await launch();
await p.waitForTimeout(3500);
r.progress = await gf().evaluate(() => document.getElementById("msg") ? document.getElementById("msg").innerText.replace(/\s+/g, " ") : null).catch(e => "?");
const t1 = Date.now();
await p.tap("#r36s-touch .menu");
await p.tap("#r36s-sheet button:has-text('Sair do jogo')");
await p.waitForFunction(() => !window.r36s.game, null, { timeout: 5000 }).catch(() => {});
r.menuQuitMs = Date.now() - t1; r.menuGone = await p.evaluate(() => !window.r36s.game && !document.getElementById("game"));
// 2) Select+Start no toque
await launch();
await p.waitForTimeout(3000);
const cdp = await c.newCDPSession(p);
const pos = s => p.evaluate(s => { const q = document.querySelector(s).getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; }, s);
const [sx, sy] = await pos('#r36s-touch [data-btn="select"]'), [tx, ty] = await pos('#r36s-touch [data-btn="start"]');
await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: sx, y: sy, id: 1 }] });
await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: sx, y: sy, id: 1 }, { x: tx, y: ty, id: 2 }] });
await p.waitForTimeout(200);
await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await p.waitForFunction(() => !window.r36s.game, null, { timeout: 5000 }).catch(() => {});
r.comboGone = await p.evaluate(() => !window.r36s.game);
const ok = /Baixando o jogo/.test(r.progress || "") && r.menuGone && r.menuQuitMs < 3000 && r.comboGone;
console.log(JSON.stringify({ ok, ...r }));
await b.close();
process.exit(ok ? 0 : 1);
