// node tests/e2e_site.mjs [url do r36s no hub] [saida] — site da Etapa 4 contra um mock local do Google Drive.
//  1. home (1440 e 390 px), sem erro de console     2. login     3. os 4 estados da biblioteca (+ sem índice)
//  4. ES boota lendo do mock do Drive, painel de comandos, jogo (ROM do Drive), save PUT no Drive e GET na volta
//  5. modo demonstração + 2 jogadores com controles simulados (navigator.getGamepads falso)   6. joystick de toque
// O login real do Google não dá para automatizar: o site roda com R36S_CONFIG {auth: "mock", api: <mock>}.
// Teste com controles físicos e no celular de verdade fica com o andre (docs/deploy.md).
import { chromium } from "/home/andre/Workspace/web-ports/tools/pw/node_modules/playwright-core/index.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const url = (process.argv[2] ?? "http://localhost:8770/r36s/").replace(/\/?$/, "/");
const out = process.argv[3] ?? join(ROOT, "tests/out/site");
mkdirSync(out, { recursive: true });
const site = url + "site/";
const result = { steps: {}, errors: [] };
const step = (k, v) => { result.steps[k] = v; console.log(k, JSON.stringify(v)); };
const check = (cond, why) => { if (!cond) { result.errors.push(why); console.log("FALHOU:", why); } return cond; };

// ---------- mock do Drive: biblioteca = ROMs do demo, índice gerado com os IDs do mock
const freePort = () => new Promise(r => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const work = join(out, "mock");
mkdirSync(work, { recursive: true });
const lib = join(ROOT, "web/site/demo/fs/roms");
writeFileSync(join(work, "ls.json"), execFileSync("python3", ["-I", join(ROOT, "tests/mock_drive.py"), "--lsjson", lib]));
execFileSync("python3", [join(ROOT, "data/mkmanifest.py"), join(ROOT, "web/site/demo/fs"), join(work, "index"), "--drive-ids", join(work, "ls.json")]);
const mockPort = await freePort();
const mock = spawn("python3", ["-I", join(ROOT, "tests/mock_drive.py"), String(mockPort), "--library", lib, "--index", join(work, "index")], { stdio: ["ignore", "pipe", "inherit"] });
await new Promise(r => mock.stdout.once("data", r));
const api = `http://127.0.0.1:${mockPort}`;
const mockGet = p => fetch(api + p).then(r => r.json());

const browser = await chromium.launch({ executablePath: "/usr/bin/chromium",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const logs = [];
async function ctx(opts = {}, token = "tok-shared") {
  const c = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...opts });
  await c.addInitScript(([api, token]) => {
    window.R36S_CONFIG = { api, auth: "mock", mockToken: token };
    const orig = HTMLCanvasElement.prototype.getContext;   // o teste lê pixels do canvas
    HTMLCanvasElement.prototype.getContext = function (type, attrs) {
      if (/webgl/.test(type)) attrs = Object.assign({}, attrs, { preserveDrawingBuffer: true });
      return orig.call(this, type, attrs);
    };
  }, [api, token]);
  const p = await c.newPage();
  p.on("console", m => logs.push(`${m.type()}: ${m.text()}`));
  p.on("pageerror", e => logs.push("PAGEERROR " + e.message));
  return { c, p };
}
const lit = frame => frame.evaluate(() => {
  const c = document.getElementById("canvas"); if (!c || !c.width) return 0;
  const g = document.createElement("canvas"); g.width = c.width; g.height = c.height;
  const x = g.getContext("2d"); x.drawImage(c, 0, 0);
  const d = x.getImageData(0, 0, g.width, g.height).data; let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 30) n++;
  return +(n / (d.length / 4)).toFixed(3);
});
const esFrame = p => p.frames().find(f => /\/index\.html\?backend=/.test(f.url()));
const gameFrame = p => p.frames().find(f => /retroarch\/play\.html/.test(f.url()));
async function waitES(p) {
  await p.waitForFunction(() => document.querySelector("#jogar iframe"), null, { timeout: 20000 });
  for (let i = 0; i < 100 && !esFrame(p); i++) await p.waitForTimeout(100);
  const f = esFrame(p);
  await f.waitForFunction(() => window.r36s && window.r36s.ready, null, { timeout: 120000 });
  for (let i = 0; i < 60 && (await lit(f)) < 0.05; i++) await p.waitForTimeout(500);
  return f;
}
const hold = async (p, k, ms = 150) => { await p.keyboard.down(k); await p.waitForTimeout(ms); await p.keyboard.up(k); };
const selectStart = async p => { await p.keyboard.down("Backspace"); await p.waitForTimeout(300); await p.keyboard.down("Enter"); await p.waitForTimeout(400); await p.keyboard.up("Enter"); await p.keyboard.up("Backspace"); };

try {
  // ---------- 1. home
  for (const [w, hgt, name] of [[1440, 900, "home-1440"], [390, 844, "home-390"]]) {
    const { c, p } = await ctx({ viewport: { width: w, height: hgt } });
    const errs = [];
    p.on("console", m => { if (m.type() === "error") errs.push(m.text()); });
    p.on("pageerror", e => errs.push(e.message));
    await p.goto(site);
    await p.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 400) { scrollTo(0, y); await new Promise(r => setTimeout(r, 60)); } scrollTo(0, 0); });
    await p.waitForTimeout(1200);
    await p.screenshot({ path: `${out}/${name}.png`, fullPage: true });
    const scrollW = await p.evaluate(() => document.documentElement.scrollWidth);
    step(name, { errs, scrollW });
    check(!errs.length, `${name}: erros de console ${errs}`);
    check(scrollW <= w, `${name}: rolagem horizontal (${scrollW})`);
    if (w === 390) { await p.goto(site + "#/entrar"); await p.waitForTimeout(500); await p.screenshot({ path: `${out}/login-390.png`, fullPage: true }); }
    await c.close();
  }

  // ---------- 2/3. login + estados da biblioteca
  const states = { "tok-shared": "shared", "tok-own": "own", "tok-both": "both", "tok-none": "none", "tok-noindex": "own" };
  for (const [tok, want] of Object.entries(states)) {
    const { c, p } = await ctx({}, tok);
    await p.goto(site + "#/entrar");
    if (tok === "tok-shared") await p.screenshot({ path: `${out}/login.png` });
    await p.click("#google-btn");
    await p.waitForFunction(w => window.r36sApp.state === w, want, { timeout: 15000 }).catch(() => {});
    const st = await p.evaluate(() => ({ state: window.r36sApp.state, text: document.querySelector("#lib").innerText, user: document.querySelector("#user-name").textContent,
      play: [...document.querySelectorAll(".play-btn")].map(b => !b.disabled) }));
    await p.waitForTimeout(300);
    await p.screenshot({ path: `${out}/biblioteca-${tok.slice(4)}.png` });
    step(`biblioteca-${tok}`, st);
    check(st.state === want, `${tok}: estado ${st.state}, esperado ${want}`);
    if (tok === "tok-shared") check(/Biblioteca de André/.test(st.text) && /2 sistemas · 3 jogos/.test(st.text), "compartilhada: título/contagem");
    if (tok === "tok-noindex") check(st.play[0] === false && /sem índice/.test(st.text), "sem índice: Jogar desligado");
    if (tok === "tok-both") check(/Qual biblioteca/.test(st.text), "as duas: escolha");
    if (tok === "tok-none") {
      check(/Modo demonstração/.test(st.text) && /Pedir acesso/.test(st.text), "nenhuma: opções");
      await p.click("text=Criar pasta no meu Drive");   // cria R36S no Drive (mock) -> vira "própria" sem índice
      await p.waitForFunction(() => window.r36sApp.state === "own", null, { timeout: 10000 }).catch(() => {});
      check(await p.evaluate(() => window.r36sApp.state) === "own", "nenhuma: criar pasta -> própria");
    }
    if (tok === "tok-both") {   // lembrar a escolha: recarrega e já vem a escolhida
      await p.evaluate(() => { localStorage.setItem("r36s-library", window.r36sApp.libraries.own[0].id); });
      await p.evaluate(() => { window.r36sApp.libraries = null; location.hash = "#/"; });
      await p.evaluate(() => { location.hash = "#/biblioteca"; });
      await p.waitForFunction(() => window.r36sApp.state === "both-remembered", null, { timeout: 10000 }).catch(() => {});
      check(await p.evaluate(() => window.r36sApp.state) === "both-remembered", "as duas: lembrar a escolha");
    }
    await c.close();
  }

  // ---------- 4. ES do Drive (mock), painel, jogo, saves
  {
    await fetch(api + "/_mock/reset", { method: "POST" });
    const { c, p } = await ctx({}, "tok-shared");
    await p.goto(site + "#/entrar");
    await p.click("#google-btn");
    await p.waitForFunction(() => window.r36sApp.state === "shared");
    await p.click(".play-btn");
    const es = await waitES(p);
    const panel = await es.evaluate(() => !!(window.r36s.controls && window.r36s.controls.panel));
    await p.waitForTimeout(1500);
    await p.screenshot({ path: `${out}/comandos-teclado.png` });
    await es.evaluate(() => document.querySelector("#r36s-panel .tabs button:nth-child(2)").click());
    await p.waitForTimeout(200);
    await p.screenshot({ path: `${out}/comandos-controle.png` });
    await p.keyboard.press("Enter");   // "Jogar (Enter)" fecha
    await p.waitForTimeout(400);
    const closed = await es.evaluate(() => !window.r36s.controls.panel);
    const esLit = await lit(es);
    await p.screenshot({ path: `${out}/es-drive.png` });
    const log1 = await mockGet("/_mock/log");
    const media = log1.filter(l => l.path.startsWith("/drive/v3/files/") && l.user === "tok-shared");
    step("es-drive", { panel, closed, esLit, mediaRequests: media.length, io: await es.evaluate(() => window.r36s.io.stats) });
    check(panel && closed, "painel abre na primeira entrada e fecha com Enter");
    check(esLit > 0.05, "ES desenhou a partir do Drive");
    // gbc (2º sistema do carrossel) -> µCity
    await hold(p, "d"); await p.waitForTimeout(1200);
    await hold(p, "l"); await p.waitForTimeout(1500);
    await hold(p, "l");
    await es.waitForFunction(() => window.r36s.game && window.r36s.game.started, null, { timeout: 60000 }).catch(() => {});
    const game = await es.evaluate(() => window.r36s.game && { rom: window.r36s.game.rom, started: window.r36s.game.started });
    await p.waitForTimeout(8000);
    const gf = gameFrame(p);
    const gameLit = gf ? await lit(gf) : 0;
    await p.screenshot({ path: `${out}/jogo-drive.png` });
    const romReq = (await mockGet("/_mock/log")).filter(l => l.path.includes("/drive/v3/files/") && l.user === "tok-shared").length;
    step("jogo-drive", { game, gameLit, romReq });
    check(game && /uCity/.test(game.rom) && game.started, "jogo do Drive iniciou");
    check(gameLit > 0.02, "jogo desenhou");
    await selectStart(p);
    await es.waitForFunction(() => !window.r36s.game, null, { timeout: 20000 }).catch(() => {});
    const last = await es.evaluate(() => window.r36s.lastGame);
    const saves = await mockGet("/_mock/saves");
    const srm = saves.find(s => s.user === "tok-shared" && s.name === "uCity.srm");
    step("save-put", { code: last && last.code, why: last && last.why, srm });
    check(srm && srm.size > 0 && srm.parent === "gbc", "save subiu para o Drive (R36S Web — saves/gbc/uCity.srm)");
    // de novo: o save tem que vir do Drive (GET)
    const n0 = logs.length;
    await p.waitForTimeout(1500);
    await hold(p, "l");
    await es.waitForFunction(() => window.r36s.game && window.r36s.game.started, null, { timeout: 60000 }).catch(() => {});
    await p.waitForTimeout(2000);
    const got = logs.slice(n0).find(l => /\[play\] save: \d+ bytes/.test(l));
    step("save-get", { got });
    check(!!got, "save voltou do Drive na segunda abertura");
    await selectStart(p);
    await es.waitForFunction(() => !window.r36s.game, null, { timeout: 20000 }).catch(() => {});
    const saves2 = await mockGet("/_mock/saves");
    step("save-revisao", saves2.find(s => s.name === "uCity.srm"));
    await c.close();
  }

  // ---------- 5. demo + 2 jogadores com controles simulados
  {
    const { c, p } = await ctx({ viewport: { width: 1280, height: 800 } });
    await c.addInitScript(() => {
      const mk = (index, id) => ({ id, index, connected: true, mapping: "standard", timestamp: 0, axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0, touched: false })) });
      if (window === window.top) window.__pads = [];
      window.__mkPad = mk;
      Object.defineProperty(Navigator.prototype, "getGamepads", { configurable: true, writable: true,
        value: function () { const t = window.top.__pads || []; return [0, 1, 2, 3].map(i => t[i] || null); } });
    });
    await p.goto(site + "#/demo");
    const es = await waitES(p);
    await es.evaluate(() => window.r36s.controls.close());
    await es.evaluate(() => { window.__keys = []; document.getElementById("canvas").addEventListener("keydown", e => { if (!e.isTrusted) window.__keys.push(e.key); }); });
    await p.evaluate(() => { window.__pads[0] = window.__mkPad(0, "Xbox 360 Controller (XInput STANDARD GAMEPAD)"); });
    await p.waitForTimeout(600);
    const b1 = await es.evaluate(() => document.getElementById("r36s-badges").innerText);
    await p.screenshot({ path: `${out}/2p-um-controle.png` });
    // botão da direita (A do R36S) no controle -> tecla L no ES
    await p.evaluate(() => { window.__pads[0].buttons[1] = { pressed: true, value: 1 }; });
    await p.waitForTimeout(200);
    await p.evaluate(() => { window.__pads[0].buttons[1] = { pressed: false, value: 0 }; });
    await p.waitForTimeout(800);
    // Select + Start no controle: troca P1/P2
    await p.evaluate(() => { window.__pads[0].buttons[8] = { pressed: true, value: 1 }; });
    await p.waitForTimeout(150);
    await p.evaluate(() => { window.__pads[0].buttons[9] = { pressed: true, value: 1 }; });
    await p.waitForTimeout(200);
    await p.evaluate(() => { window.__pads[0].buttons[8] = window.__pads[0].buttons[9] = { pressed: false, value: 0 }; });
    await p.waitForTimeout(300);
    const b2 = await es.evaluate(() => document.getElementById("r36s-badges").innerText);
    await p.evaluate(() => { window.__pads[1] = window.__mkPad(1, "DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)"); });
    await p.waitForTimeout(600);
    const keys = await es.evaluate(() => window.__keys.slice());
    const b3 = await es.evaluate(() => document.getElementById("r36s-badges").innerText);
    await p.screenshot({ path: `${out}/2p-dois-controles.png` });
    await es.evaluate(() => window.r36s.controls.open());
    await p.waitForTimeout(300);
    await p.screenshot({ path: `${out}/comandos-dois-controles.png` });
    await es.evaluate(() => window.r36s.controls.close());
    step("2p", { b1, keysFromPad: keys, b2, b3 });
    check(/P1 · Teclado/.test(b1) && /P2 · Controle Xbox/.test(b1), "1 controle: teclado P1, controle P2");
    check(keys.includes("l"), "controle -> tecla L (A) no ES");
    check(!keys.includes("Enter") && !keys.includes("Backspace"), "Start+Select no ES não vira tecla (troca)");
    check(/P1 · Controle Xbox/.test(b2) && /P2 · Teclado/.test(b2), "Start+Select troca P1/P2");
    check(/P1 · Controle (PlayStation|Xbox)/.test(b3) && /P2 · Controle (PlayStation|Xbox)/.test(b3), "2 controles: P1/P2");
    // jogo do demo: dentro do iframe o getGamepads já vem na ordem P1, P2
    await hold(p, "l"); await p.waitForTimeout(1200); await hold(p, "s"); await p.waitForTimeout(300); await hold(p, "l");
    await es.waitForFunction(() => window.r36s.game && window.r36s.game.started, null, { timeout: 60000 }).catch(() => {});
    await p.waitForTimeout(5000);
    const gf = gameFrame(p);
    const order = gf ? await gf.evaluate(() => navigator.getGamepads().map(g => g && g.id.slice(0, 12))) : null;
    const demoGame = await es.evaluate(() => window.r36s.game && window.r36s.game.rom);
    const demoLit = gf ? await lit(gf) : 0;
    await p.screenshot({ path: `${out}/demo-jogo.png` });
    step("2p-jogo", { demoGame, demoLit, order });
    check(order && /^DualSense/.test(order[0]) && /^Xbox/.test(order[1]), "no jogo: P1 = 2º controle (trocado), P2 = 1º");
    check(demoLit > 0.02, "jogo do demo desenhou");
    await selectStart(p);
    await c.close();
  }

  // ---------- 6. joystick de toque (paisagem e retrato), multitoque
  for (const [w, hgt, name] of [[844, 390, "toque-paisagem"], [390, 844, "toque-retrato"]]) {
    const { c, p } = await ctx({ viewport: { width: w, height: hgt }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    await p.goto(site + "#/demo");
    const es = await waitES(p);
    const tab = await es.evaluate(() => document.querySelector("#r36s-panel .tabs .on")?.textContent);
    await p.screenshot({ path: `${out}/comandos-${name}.png` });
    await es.evaluate(() => window.r36s.controls.close());
    await es.evaluate(() => { window.__held = new Set(); window.__both = false; const c = document.getElementById("canvas");
      c.addEventListener("keydown", e => { if (!e.isTrusted) { window.__held.add(e.key); if (window.__held.has("d") && window.__held.has("l")) window.__both = true; } });
      c.addEventListener("keyup", e => { if (!e.isTrusted) window.__held.delete(e.key); }); });
    // dois dedos: direcional para a direita + A
    const box = async sel => { const r = await es.evaluate(s => { const b = document.querySelector(s).getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; }, sel); return r; };
    const [dx, dy, dw, dh] = await box("#r36s-touch .dpad");
    const [ax, ay, aw, ah] = await box('#r36s-touch [data-btn="a"]');
    const cdp = await c.newCDPSession(p);
    const pts = [{ x: dx + dw * 0.85, y: dy + dh / 2, id: 1 }, { x: ax + aw / 2, y: ay + ah / 2, id: 2 }];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [pts[0]] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts });
    await p.waitForTimeout(200);
    await p.screenshot({ path: `${out}/${name}.png` });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await p.waitForTimeout(200);
    const r = await es.evaluate(() => ({ both: window.__both, held: [...window.__held], portrait: document.body.classList.contains("r36s-portrait"), touch: document.body.classList.contains("r36s-touch") }));
    step(name, { tab, ...r });
    check(r.touch && tab === "Toque", `${name}: overlay e aba Toque`);
    check(r.both && !r.held.length, `${name}: multitoque (direcional + A juntos) e soltar`);
    check(r.portrait === (hgt > w), `${name}: orientação`);
    await c.close();
  }
} catch (e) {
  result.errors.push("exceção: " + (e.stack || e));
  console.log(e);
} finally {
  writeFileSync(`${out}/console.log`, logs.join("\n") + "\n");
  const fatal = logs.filter(l => /PAGEERROR|RuntimeError|Aborted/.test(l));
  result.fatal = fatal;
  console.log(JSON.stringify({ errors: result.errors, fatal }, null, 1));
  await browser.close();
  mock.kill();
  process.exit(result.errors.length || fatal.length ? 1 : 0);
}
