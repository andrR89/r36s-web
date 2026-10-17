// node tests/mobile_demo.mjs [url do site] [saida]
// Celular emulado (toque, 412x915, como o Galaxy A54) no modo demonstração: fecha o painel com toque, abre um jogo
// tocando no A do joystick de toque e confere se o jogo desenha. Só toque — nada de teclado — como no aparelho.
import { chromium } from "/home/andre/Workspace/web-ports/tools/pw/node_modules/playwright-core/index.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
const site = (process.argv[2] || "https://r36s-web.netlify.app/site/").replace(/\/?$/, "/");
const out = process.argv[3] || "/home/andre/Workspace/web-ports/r36s/tests/out/mobile";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const logs = [], r = {};
for (const [w, h, name] of [[915, 412, "paisagem"], [412, 915, "retrato"]]) {
  const c = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: 2.6,
    userAgent: "Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36" });
  const p = await c.newPage();
  p.on("console", m => logs.push(`[${name}] ${m.type()}: ${m.text()}`));
  p.on("pageerror", e => logs.push(`[${name}] PAGEERROR ${e.message}`));
  c.on("page", g => { g.on("console", m => logs.push(`[${name} aba] ${m.type()}: ${m.text()}`)); });
  await p.goto(site + "#/demo");
  await p.waitForFunction(() => document.querySelector("#jogar iframe"), null, { timeout: 30000 });
  let es; for (let i = 0; i < 100 && !(es = p.frames().find(f => /\/index\.html\?backend=/.test(f.url()))); i++) await p.waitForTimeout(100);
  await es.waitForFunction(() => window.r36s && window.r36s.ready, null, { timeout: 120000 });
  await p.waitForTimeout(3000);
  await p.screenshot({ path: `${out}/${name}-1-painel.png` });
  const tapSel = async (frame, sel) => {
    const b = await frame.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const q = e.getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; }, sel);
    if (!b) return false;
    await p.touchscreen.tap(b[0], b[1]); return true;   // o iframe do ES ocupa a página inteira (0,0)
  };
  const panelBtn = await es.evaluate(() => [...document.querySelectorAll("#r36s-panel button")].map(b => b.textContent.trim()));
  const closed = await tapSel(es, "#r36s-panel .go");
  await p.waitForTimeout(1000);
  const panelOpen = await es.evaluate(() => { const e = document.getElementById("r36s-panel"); return !!e && getComputedStyle(e).display !== "none" && !e.hidden; });
  await p.screenshot({ path: `${out}/${name}-2-es.png` });
  // A (abre o sistema), A (abre o jogo)
  const tapA = async () => { await tapSel(es, '#r36s-touch [data-btn="a"]'); await p.waitForTimeout(1500); };
  await tapA(); await tapA();
  await es.waitForFunction(() => window.r36s.game && window.r36s.game.started, null, { timeout: 60000 }).catch(() => {});
  await p.waitForTimeout(5000);
  const gf = p.frames().find(f => /retroarch\/play\.html/.test(f.url()));
  const lit = gf ? await gf.evaluate(() => { const c = document.getElementById("canvas"); if (!c || !c.width) return 0;
    const g = document.createElement("canvas"); g.width = c.width; g.height = c.height; const x = g.getContext("2d"); x.drawImage(c, 0, 0);
    const d = x.getImageData(0, 0, g.width, g.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 30) n++;
    return +(n / (d.length / 4)).toFixed(3); }).catch(e => "erro " + e.message) : null;
  const game = await es.evaluate(() => window.r36s.game && { rom: window.r36s.game.rom, started: window.r36s.game.started });
  const last = await es.evaluate(() => window.r36s.lastGame || null);
  await p.screenshot({ path: `${out}/${name}-3-jogo.png` });
  r[name] = { panelBtn, closed, panelOpen, game, last, gameFrame: !!gf, lit };
  console.log(name, JSON.stringify(r[name]));
  await c.close();
}
writeFileSync(`${out}/console.log`, logs.join("\n") + "\n");
console.log(logs.filter(l => /error|PAGEERROR|falh|fail/i.test(l)).slice(0, 25).join("\n"));
await browser.close();
