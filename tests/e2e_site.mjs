// node tests/e2e_site.mjs [url do r36s no hub] [saida] — site contra a biblioteca CIFRADA num Drive simulado local
// (tests/mock_drive.py, pasta plana de arquivos opacos) + o backend de chaves local (tests/mock_chaves.mjs).
// O cartão falso e a cifra vêm do tests/cifrado_fixture.mjs (demo gbc/nes + um snes de mentira + PSP do cartão).
//  1. home (1440 e 390 px), sem erro de console
//  2. acesso: tok-shared vê a biblioteca; tok-own (só snes) vê gbc/nes apagados "Sem acesso a este sistema";
//     tok-none pede acesso (o backend registra pendente); tok-both vê o pedido aguardando
//  3. tok-shared: seletor com capas e miniaturas decifradas, ⬇ ROM pequena (blob = ROM do cartão), jogo (ROM do Drive)
//     pela ficha, save PUT no Drive e GET na volta
//  4. modo demonstração + 2 jogadores com controles simulados (navigator.getGamepads falso)   5. joystick de toque no jogo
//  6. PSP (núcleo com threads): aba isolada (retroarch/isolated.html, crossOriginIsolated) pelo BroadcastChannel,
//     popup bloqueado -> botão; a ROM passa do EAGER_MAX e é lida sob demanda (lazyFile -> io.readSync, XHR síncrono +
//     ChaCha20 síncrono); jogo desenha, save em árvore vai e volta do Drive, saída volta ao seletor.
//     Precisa do cartão montado (ROM de PSP de lá); sem ele o passo é pulado.
//  7. varredura: nenhum nome de jogo/sistema do cartão falso nos nomes nem no conteúdo da pasta que "sobe"
// E2E_ONLY=home,acesso,drive,demo,toque,psp,varredura roda só esses passos.
// O login real do Google não dá para automatizar: o site roda com R36S_CONFIG {auth: "mock", api, funcoes}.
// Teste com controles físicos e no celular de verdade fica com o andre (docs/deploy.md).
import { chromium } from "/home/andre/Workspace/web-ports/tools/pw/node_modules/playwright-core/index.mjs";
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { cartao, montar, subir, PSP_GAME } from "./cifrado_fixture.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const url = (process.argv[2] ?? "http://localhost:8770/r36s/").replace(/\/?$/, "/");
const out = process.argv[3] ?? join(ROOT, "tests/out/site");
mkdirSync(out, { recursive: true });
const site = url + "site/";
const result = { steps: {}, errors: [] };
const step = (k, v) => { result.steps[k] = v; console.log(k, JSON.stringify(v)); };
const run = k => !process.env.E2E_ONLY || process.env.E2E_ONLY.split(",").includes(k);
const check = (cond, why) => { if (!cond) { result.errors.push(why); console.log("FALHOU:", why); } return cond; };
const md5 = b => createHash("md5").update(b).digest("hex");
// vigia: ações do playwright (teclado, evaluate) não têm timeout e esperam para sempre se uma aba prende a thread
// (PPSSPP sem GPU com a máquina carregada: travou 9 h). Falha com o último passo em vez de travar. E2E_TIMEOUT em s.
setTimeout(() => {
  console.log("FALHOU: vigia — o teste passou de", process.env.E2E_TIMEOUT || 900, "s; último passo:", Object.keys(result.steps).at(-1));
  for (const k of [() => mocks.parar(), () => browser.close()]) try { k(); } catch {}
  setTimeout(() => process.exit(2), 3000);
}, 1000 * (+process.env.E2E_TIMEOUT || 900)).unref();

// ---------- biblioteca cifrada: cartão falso -> arquivos opacos (Drive simulado) + ponteiro e chaves (backend local)
const work = join(out, "mock"), card = join(work, "card");
const { pspRom } = cartao(card, { psp: run("psp") });
const fix = montar(work, card);
const indice = JSON.parse(readFileSync(fix.indice, "utf8"));
const claroLib = JSON.parse(gunzipSync(readFileSync(join(work, "claro/library.json.gz"))));
var mocks = await subir(fix);
const { api, funcoes } = mocks;
const mockGet = p => fetch(api + p).then(r => r.json());

const browser = await chromium.launch({ executablePath: "/usr/bin/chromium",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const logs = [];
async function ctx(opts = {}, token = "tok-shared") {
  const c = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true, ...opts });
  await c.addInitScript(([api, funcoes, token]) => {
    window.R36S_CONFIG = { api, funcoes, auth: "mock", mockToken: token };
    const orig = HTMLCanvasElement.prototype.getContext;   // o teste lê pixels do canvas
    HTMLCanvasElement.prototype.getContext = function (type, attrs) {
      if (/webgl/.test(type)) attrs = Object.assign({}, attrs, { preserveDrawingBuffer: true });
      return orig.call(this, type, attrs);
    };
  }, [api, funcoes, token]);
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
const appFrame = p => p.frames().find(f => /\/index\.html\?backend=/.test(f.url()));
const gameFrame = p => p.frames().find(f => /retroarch\/play\.html/.test(f.url()));
// frame do seletor (index.html?backend=…) dentro do site, já pronto
async function waitApp(p) {
  await p.waitForFunction(() => document.querySelector("#jogar iframe"), null, { timeout: 20000 });
  for (let i = 0; i < 100 && !appFrame(p); i++) await p.waitForTimeout(100);
  const f = appFrame(p);
  await f.waitForFunction(() => window.r36s && window.r36s.ready, null, { timeout: 120000 });
  return f;
}
// login (token falso) até a tela da biblioteca chegar ao estado esperado
async function entrar(p, want) {
  await p.goto(site + "#/entrar");
  await p.click("#google-btn");
  await p.waitForFunction(w => window.r36sApp.state === w, want, { timeout: 15000 }).catch(() => {});
  return p.evaluate(() => ({ state: window.r36sApp.state, text: document.querySelector("#lib").innerText }));
}
const focusedPlay = app => app.evaluate(() => !!document.activeElement && document.activeElement.matches("#sheet .play"));
const hold = async (p, k, ms = 150) => { await p.keyboard.down(k); await p.waitForTimeout(ms); await p.keyboard.up(k); };
const selectStart = async p => { await p.keyboard.down("Backspace"); await p.waitForTimeout(300); await p.keyboard.down("Enter"); await p.waitForTimeout(400); await p.keyboard.up("Enter"); await p.keyboard.up("Backspace"); };

try {
  // ---------- 1. home
  if (run("home")) for (const [w, hgt, name] of [[1440, 900, "home-1440"], [390, 844, "home-390"]]) {
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

  // ---------- 2. acesso (backend de chaves): com acesso, acesso parcial, sem acesso + pedido, pedido pendente
  if (run("acesso")) {
    {
      const { c, p } = await ctx({}, "tok-shared");
      const st = await entrar(p, "shared");
      await p.screenshot({ path: `${out}/biblioteca-shared.png` });
      step("acesso-shared", st);
      const conta = `${indice.info.systems} sistemas · ${indice.info.games} jogos`;
      check(st.state === "shared" && /Biblioteca de André/.test(st.text) && st.text.includes(conta), `tok-shared: biblioteca com "${conta}"`);
      await c.close();
    }
    {
      // tok-own: só a chave do snes -> gbc/nes apagados, com o motivo na ficha
      const { c, p } = await ctx({}, "tok-own");
      const st = await entrar(p, "shared");
      await p.click(".play-btn");
      const app = await waitApp(p);
      const off = await app.evaluate(() => Object.fromEntries([...document.querySelectorAll("[data-sys]")].map(r =>
        [r.dataset.sys, [...r.querySelectorAll(".cover")].map(x => x.classList.contains("off"))])));
      await app.click('[data-sys="gbc"] .cover');
      await app.waitForFunction(() => document.querySelector("#sheet .note"), null, { timeout: 10000 }).catch(() => {});
      const ficha = await app.evaluate(() => ({ note: document.querySelector("#sheet .note")?.textContent, play: !!document.querySelector("#sheet .play") }));
      await p.screenshot({ path: `${out}/acesso-parcial.png` });
      step("acesso-own", { state: st.state, off, ficha });
      check(st.state === "shared", "tok-own: entra na biblioteca");
      check(off.snes && off.snes.length && off.snes.every(x => !x), "tok-own: snes jogável");
      check(["gbc", "nes"].every(s => off[s] && off[s].length && off[s].every(x => x)), "tok-own: gbc/nes apagados");
      check(/Sem acesso a este sistema/.test(ficha.note || "") && !ficha.play, "tok-own: ficha diz 'Sem acesso a este sistema', sem Jogar");
      await c.close();
    }
    {
      // tok-none: sem acesso -> formulário -> pedido registrado no backend
      const { c, p } = await ctx({}, "tok-none");
      const st = await entrar(p, "sem-acesso");
      await p.fill("#pedido-nome", "Edu Teste");
      await p.fill("#pedido-msg", "teste e2e");
      await p.screenshot({ path: `${out}/sem-acesso.png` });
      await p.click("form.pedido button[type=submit]");
      await p.waitForFunction(() => window.r36sApp.state === "sem-acesso-enviado", null, { timeout: 10000 }).catch(() => {});
      const depois = await p.evaluate(() => ({ state: window.r36sApp.state, text: document.querySelector("#lib").innerText }));
      const pedidos = await fetch(funcoes + "/_mock/pedidos").then(r => r.json());
      step("acesso-none", { antes: st, depois, pedidos });
      check(st.state === "sem-acesso" && /Sem acesso à biblioteca/.test(st.text), "tok-none: tela sem acesso");
      check(depois.state === "sem-acesso-enviado" && /Pedido enviado/.test(depois.text), "tok-none: pedido enviado");
      check(pedidos["tok-none"] === "pendente", "tok-none: backend registrou o pedido pendente");
      await c.close();
    }
    {
      const { c, p } = await ctx({}, "tok-both");
      const st = await entrar(p, "sem-acesso-pendente");
      step("acesso-pendente", st);
      check(st.state === "sem-acesso-pendente" && /aguardando aprovação/.test(st.text), "tok-both: pedido aguardando");
      await c.close();
    }
  }

  // ---------- 3. seletor do Drive cifrado, ⬇ ROM, jogo, saves
  if (run("drive")) {
    await fetch(api + "/_mock/reset", { method: "POST" });
    const { c, p } = await ctx({}, "tok-shared");
    await entrar(p, "shared");
    await p.click(".play-btn");
    const app = await waitApp(p);
    const panel = await app.evaluate(() => !!(window.r36s.controls && window.r36s.controls.panel));
    const covers = await app.evaluate(() => document.querySelectorAll(".cover").length);
    // capas: miniaturas (recortes do pacote cifrado) decifradas no navegador; só conta imagem que decodificou
    const art = claroLib.games.filter(g => g.box || g.shot).length;
    if (art) await app.waitForFunction(() => [...document.querySelectorAll(".cover img[src]")].some(i => i.complete && i.naturalWidth), null, { timeout: 30000 }).catch(() => {});
    const imgs = await app.evaluate(() => [...document.querySelectorAll(".cover img[src]")].filter(i => i.complete && i.naturalWidth).length);
    await p.screenshot({ path: `${out}/seletor-drive.png` });
    const log1 = await mockGet("/_mock/log");
    const media = log1.filter(l => l.path.startsWith("/drive/v3/files/") && l.user === "tok-shared");
    step("seletor-drive", { panel, covers, art, imgs, mediaRequests: media.length, io: await app.evaluate(() => window.r36s.io.stats) });
    check(!panel, "painel de comandos não abre sozinho");
    check(covers > 0 && art > 0 && imgs > 0, "seletor mostrou capas decifradas do Drive");
    // gbc -> µCity: capa -> ficha -> ⬇ ROM (blob decifrado = ROM do cartão) -> Jogar
    await app.click('[data-sys="gbc"] .cover');
    const rom = await app.evaluate(() => document.querySelector('[data-sys="gbc"] .cover').dataset.rom);
    const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 30000 }), app.click("#sheet .rom")]);
    const got = md5(readFileSync(await dl.path())), want = md5(readFileSync(join(card, rom)));
    const romMsg = await app.evaluate(() => document.querySelector("#sheet .msg, #sheet [role=status]")?.textContent || "");
    step("rom-drive", { rom, name: dl.suggestedFilename(), got, want, romMsg });
    check(got === want && dl.suggestedFilename() === rom.slice(rom.lastIndexOf("/") + 1), "⬇ ROM: arquivo salvo = ROM do cartão, nome original");
    await app.click("#sheet .play");
    await app.waitForFunction(() => window.r36s.game && window.r36s.game.started, null, { timeout: 60000 }).catch(() => {});
    const game = await app.evaluate(() => window.r36s.game && { rom: window.r36s.game.rom, started: window.r36s.game.started });
    await p.waitForTimeout(8000);
    const gf = gameFrame(p);
    const gameLit = gf ? await lit(gf) : 0;
    await p.screenshot({ path: `${out}/jogo-drive.png` });
    const romReq = (await mockGet("/_mock/log")).filter(l => l.path.includes("/drive/v3/files/") && l.user === "tok-shared").length;
    step("jogo-drive", { game, gameLit, romReq });
    check(game && /uCity/.test(game.rom) && game.started, "jogo do Drive iniciou");
    check(gameLit > 0.02, "jogo desenhou");
    await selectStart(p);
    await app.waitForFunction(() => !window.r36s.game, null, { timeout: 20000 }).catch(() => {});
    const last = await app.evaluate(() => window.r36s.lastGame);
    const back = await focusedPlay(app);
    const saves = await mockGet("/_mock/saves");
    const srm = saves.find(s => s.user === "tok-shared" && s.name === "uCity.srm");
    step("save-put", { code: last && last.code, why: last && last.why, back, srm });
    check(back, "volta do jogo: foco no Jogar da ficha");
    check(srm && srm.size > 0 && srm.parent === "gbc", "save subiu para o Drive (R36S Web — saves/gbc/uCity.srm)");
    // de novo: o save tem que vir do Drive (GET)
    const n0 = logs.length;
    await p.waitForTimeout(1500);
    await app.click("#sheet .play");   // a ficha continua aberta
    await app.waitForFunction(() => window.r36s.game && window.r36s.game.started, null, { timeout: 60000 }).catch(() => {});
    await p.waitForTimeout(2000);
    const got2 = logs.slice(n0).find(l => /\[play\] save: \d+ bytes/.test(l));
    step("save-get", { got: got2 });
    check(!!got2, "save voltou do Drive na segunda abertura");
    await selectStart(p);
    await app.waitForFunction(() => !window.r36s.game, null, { timeout: 20000 }).catch(() => {});
    const saves2 = await mockGet("/_mock/saves");
    step("save-revisao", saves2.find(s => s.name === "uCity.srm"));
    await c.close();
  }

  // ---------- 5. demo + 2 jogadores com controles simulados
  if (run("demo")) {
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
    const es = await waitApp(p);
    // fora do jogo o controle vira teclas sintéticas no document (web/controls.js); foco no #app: o A não abre nada
    await es.evaluate(() => { window.__keys = []; document.addEventListener("keydown", e => { if (!e.isTrusted) window.__keys.push(e.key); }); document.getElementById("app").focus(); });
    await p.evaluate(() => { window.__pads[0] = window.__mkPad(0, "Xbox 360 Controller (XInput STANDARD GAMEPAD)"); });
    await p.waitForTimeout(600);
    const b1 = await es.evaluate(() => document.getElementById("r36s-badges").innerText);
    await p.screenshot({ path: `${out}/2p-um-controle.png` });
    // botão da direita (A do R36S) no controle -> tecla L no seletor
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
    check(/P1 · Controle Xbox/.test(b1) && /P2 · Teclado/.test(b1), "1 controle: controle P1, teclado P2 (padrão automático)");
    check(keys.includes("l"), "controle -> tecla L (A) no seletor");
    check(!keys.includes("Enter") && !keys.includes("Backspace"), "Start+Select no seletor não vira tecla (troca)");
    check(/P1 · Teclado/.test(b2) && /P2 · Controle Xbox/.test(b2), "Start+Select troca P1/P2");
    check(/P1 · Controle (PlayStation|Xbox)/.test(b3) && /P2 · Controle (PlayStation|Xbox)/.test(b3), "2 controles: P1/P2");
    // jogo do demo: dentro do iframe o getGamepads já vem na ordem P1, P2
    await es.click(".cover");
    await es.click("#sheet .play");
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
  if (run("toque")) for (const [w, hgt, name] of [[844, 390, "toque-paisagem"], [390, 844, "toque-retrato"]]) {
    const { c, p } = await ctx({ viewport: { width: w, height: hgt }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    // modo teclas (sem o controle virtual): o joystick manda teclas para o canvas do jogo
    await c.addInitScript(() => { if (window === window.top) localStorage.setItem("r36s-controles-v1", JSON.stringify({ analog: { touchAnalog: false } })); });
    await p.goto(site + "#/demo");
    const es = await waitApp(p);
    const hidden = await es.evaluate(() => getComputedStyle(document.getElementById("r36s-touch")).display === "none");
    await es.evaluate(() => window.r36s.controls.open());   // painel pelo menu ≡: no toque abre na aba Toque
    await p.waitForTimeout(300);
    const tab = await es.evaluate(() => document.querySelector("#r36s-panel .tabs .on")?.textContent);
    await p.screenshot({ path: `${out}/comandos-${name}.png` });
    await es.evaluate(() => window.r36s.controls.close());
    // jogo falso no lugar do #game (mesmo id e CSS): um canvas que anota as teclas que o joystick de toque manda
    await es.evaluate(() => new Promise(res => {
      window.__held = new Set(); window.__both = false;
      const f = document.createElement("iframe");
      f.id = "game";
      f.srcdoc = '<canvas id="canvas"></canvas><script>const c = document.getElementById("canvas"), t = parent;' +
        'c.addEventListener("keydown", e => { t.__held.add(e.key); if (t.__held.has("d") && t.__held.has("l")) t.__both = true; });' +
        'c.addEventListener("keyup", e => t.__held.delete(e.key));<\/script>';
      f.onload = () => { window.r36s.game = { system: "gbc", rom: "/roms/gbc/Teste.gbc", iframe: f, started: true }; res(); };
      document.body.append(f);
    }));
    await p.waitForTimeout(500);
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
    step(name, { hidden, tab, ...r });
    check(hidden, `${name}: joystick de toque escondido fora do jogo`);
    check(r.touch && tab === "Toque", `${name}: overlay e aba Toque`);
    check(r.both && !r.held.length, `${name}: multitoque (direcional + A juntos) e soltar`);
    check(r.portrait === (hgt > w), `${name}: orientação`);
    await c.close();
  }

  // ---------- 6. PSP: aba isolada, ROM sob demanda
  if (run("psp")) await pspIsolated();

  // ---------- 7. varredura: nada do cartão em claro no que sobe (só textos de 5+ letras: 3 letras aparecem por acaso)
  if (run("varredura")) {
    const nomes = new Set();
    for (const s of claroLib.systems) for (const t of [s.id, s.name]) if (t && t.length >= 5) nomes.add(t);
    for (const g of claroLib.games) {
      const base = g.rom.slice(g.rom.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
      for (const t of [g.name, base]) if (t && t.length >= 5) nomes.add(t);
      for (const w of String(g.name || "").split(/[^\p{L}\p{N}]+/u)) if (w.length >= 5) nomes.add(w);
    }
    const achados = [];
    const arquivos = readdirSync(fix.dados);
    for (const f of arquivos) {
      const b = readFileSync(join(fix.dados, f)).toString("latin1");
      for (const n of nomes) if (f.includes(n) || b.includes(n)) achados.push(`${n} em ${f}`);
    }
    step("varredura", { arquivos: arquivos.length, nomes: nomes.size, achados });
    check(arquivos.length > 0 && arquivos.every(f => /^[0-9a-f]{24}$/.test(f)), "varredura: só nomes opacos");
    check(!achados.length, "varredura: nome do cartão em claro na pasta que sobe");
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
  mocks.parar();
  process.exit(result.errors.length || fatal.length ? 1 : 0);
}

// PSP do cartão (cópia com zeros no fim, acima do EAGER_MAX: ver tests/cifrado_fixture.mjs) na mesma biblioteca cifrada
async function pspIsolated() {
  if (!pspRom) { step("psp", { skipped: "cartão não montado" }); return; }
  const GAME = PSP_GAME, papi = api;
  const saveName = GAME.replace(/\.cso$/, ".savedata");
  const savesOf = async () => (await fetch(papi + "/_mock/saves").then(r => r.json())).find(s => s.user === "tok-shared" && s.name === saveName);
  // save semente no Drive (blob em árvore do play.js: "R36T1\n" + {p,n} + bytes por arquivo)
  const enc = new TextEncoder(), seedFile = enc.encode("SEED!");
  const blob = Buffer.concat([enc.encode("R36T1\n"), enc.encode(JSON.stringify({ p: "R36STEST0/SEED.BIN", n: seedFile.length }) + "\n"), seedFile]);
  await fetch(`${papi}/_mock/seed?` + new URLSearchParams({ user: "tok-shared", system: "psp", name: saveName }), { method: "POST", body: blob });

  const { c, p } = await ctx({}, "tok-shared");
  await entrar(p, "shared");
  await p.click(".play-btn");
  const es = await waitApp(p);
  check(await es.evaluate(() => !self.crossOriginIsolated), "psp: página do seletor no site não é crossOriginIsolated (premissa)");
  // capa do PSP -> ficha -> Jogar. O 1º window.open "falha" (popup bloqueado): aparece o botão
  await es.evaluate(() => { const o = window.open; window.open = function () { window.open = o; return null; }; });
  await es.click('[data-sys="psp"] .cover');
  await es.click("#sheet .play");
  await es.waitForFunction(() => document.querySelector("#isolated button"), null, { timeout: 30000 }).catch(() => {});
  const blocked = await es.evaluate(() => ({ text: document.getElementById("isolated")?.innerText || "", game: window.r36s.game && { isolated: window.r36s.game.isolated, opened: window.r36s.game.opened } }));
  await p.screenshot({ path: `${out}/psp-bloqueado.png` });
  step("psp-bloqueado", blocked);
  check(/PSP abre numa aba própria/.test(blocked.text) && /bloqueou/.test(blocked.text) && blocked.game && blocked.game.isolated && !blocked.game.opened, "psp: popup bloqueado -> aviso com botão");
  const popup = c.waitForEvent("page", { timeout: 20000 });
  await es.click("#isolated button");   // "Abrir o jogo"
  const g = await popup;
  const glogs = [];
  g.on("console", m => { glogs.push(`${m.type()}: ${m.text()}`); logs.push(`[aba psp] ${m.type()}: ${m.text()}`); });
  g.on("pageerror", e => logs.push("[aba psp] PAGEERROR " + e.message));
  // a aba nasce em about:blank e troca de processo (COOP): espera a página isolada carregar
  await g.waitForURL(/isolated\.html/, { timeout: 20000, waitUntil: "load" });
  await g.waitForFunction(() => window.r36sIsolated, null, { timeout: 20000 });
  const iso = await g.evaluate(() => ({ coi: self.crossOriginIsolated, sab: typeof SharedArrayBuffer, url: location.href, opener: window.opener === null }));
  await g.waitForFunction(() => window.r36sPlay && window.r36sPlay.started, null, { timeout: 90000 }).catch(() => {});
  const notice = await es.evaluate(() => document.getElementById("isolated")?.innerText || "");
  let glit = 0;
  for (let i = 0; i < 120 && glit < 0.02; i++) { await g.waitForTimeout(1000); glit = await lit(g).catch(() => 0); }
  await g.screenshot({ path: `${out}/psp-aba.png` });
  await p.screenshot({ path: `${out}/psp-seletor-aviso.png` });
  const st = await g.evaluate(() => ({ started: !!(window.r36sPlay && window.r36sPlay.started), core: window.r36sPlay && window.r36sPlay.core, lazy: window.r36sPlay && window.r36sPlay.lazy,
    romSize: window.r36sPlay && window.r36sPlay.romSize,
    io: window.r36sIsolated.io && window.r36sIsolated.io.stats, inStorage: JSON.stringify({ ...localStorage, ...sessionStorage }).includes("tok-") }));
  const seedLog = glogs.find(l => /save em árvore: \d+ arquivos/.test(l));
  // renovação do token pelo canal (o drive.js faz isso no 401): a aba do site responde
  const renew = await g.evaluate(async () => { const t = await window.r36sIsolated.getToken(true); return { ok: t === "tok-shared", n: window.r36sIsolated.tokenRenewals }; });
  check(renew.ok && renew.n >= 1, "psp: token renovado pelo BroadcastChannel");
  step("psp-aba", { ...iso, ...st, glit, notice, seedLog, renew });
  check(iso.coi === true && iso.sab === "function", "psp: aba isolada com crossOriginIsolated");
  check(iso.opener && !/tok-/.test(iso.url) && !st.inStorage, "psp: sem opener; token fora da URL e do storage");
  check(st.started && st.core === "ppsspp", "psp: ppsspp iniciou na aba isolada");
  // ROM acima do EAGER_MAX (48 MB): lida em pedaços pelo lazyFile -> io.readSync (XHR síncrono + ChaCha20 síncrono)
  check(st.romSize > 48 << 20 && st.lazy && st.lazy.requests > 0 && st.io && st.io.media > 0, "psp: ROM grande lida sob demanda (readSync)");
  check(/PSP abre numa aba própria/.test(notice), "psp: aviso na aba do seletor enquanto joga");
  check(glit > 0.02, "psp: jogo desenhou");
  check(/save em árvore: 1 arquivos/.test(seedLog || ""), "psp: save semente veio do Drive");
  // "o jogo grava" no memory stick: um arquivo novo na árvore -> o play.js sobe o blob (PATCH no Drive) em até 2 s
  await g.evaluate(() => { const FS = window.r36sPlay.module.FS, d = "/home/web_user/retroarch/userdata/saves/PSP/SAVEDATA/R36STEST0";
    FS.writeFile(d + "/NOVO.BIN", new Uint8Array([1, 2, 3, 4, 5, 6, 7])); }).catch(e => logs.push("psp: FS " + e.message));
  for (let i = 0; i < 20; i++) { const s = await savesOf(); if (s && s.revisions >= 1) break; await p.waitForTimeout(500); }
  const up = await savesOf();
  step("psp-save-put", up);
  check(up && up.revisions >= 1 && up.size > blob.length && up.parent === "psp", "psp: save do memory stick subiu para o Drive");
  // saída: Select+Start na aba isolada -> exit pelo canal, a aba fecha, o seletor volta (foco no Jogar)
  const closed = new Promise(r => g.once("close", r));
  await g.bringToFront();
  await selectStart(g);
  const gone = await Promise.race([closed.then(() => true), new Promise(r => setTimeout(() => r(false), 30000))]);
  await es.waitForFunction(() => !window.r36s.game, null, { timeout: 20000 }).catch(() => {});
  const last = await es.evaluate(() => window.r36s.lastGame && { code: window.r36s.lastGame.code, why: window.r36s.lastGame.why, isolated: window.r36s.lastGame.isolated, notice: !!document.getElementById("isolated") });
  await p.bringToFront();
  await p.waitForTimeout(1500);
  const back = await focusedPlay(es);
  await p.screenshot({ path: `${out}/psp-volta-seletor.png` });
  step("psp-saida", { gone, last, back });
  check(gone, "psp: aba isolada fechou sozinha");
  check(last && last.code === 0 && last.isolated && !last.notice, "psp: seletor voltou (código 0, aviso removido)");
  check(back, "psp: foco de volta no Jogar da ficha");
  // de novo: o save com os 2 arquivos vem do Drive
  const popup2 = c.waitForEvent("page", { timeout: 20000 });
  await es.click("#sheet .play");   // a ficha continua aberta
  const g2 = await popup2;
  await g2.waitForURL(/isolated\.html/, { timeout: 20000, waitUntil: "load" }).catch(() => {});
  const g2logs = [];
  g2.on("console", m => { g2logs.push(m.text()); logs.push(`[aba psp 2] ${m.type()}: ${m.text()}`); });
  await g2.waitForFunction(() => window.r36sPlay && window.r36sPlay.started, null, { timeout: 90000 }).catch(() => {});
  const got = g2logs.find(l => /save em árvore: \d+ arquivos/.test(l));
  step("psp-save-get", { got });
  check(/save em árvore: 2 arquivos/.test(got || ""), "psp: save voltou do Drive com o arquivo novo");
  // Voltar pela aba do seletor: pede para a aba isolada sair e fechar
  const closed2 = new Promise(r => g2.once("close", r));
  await p.bringToFront();
  await es.click("#isolated button:last-child");
  const gone2 = await Promise.race([closed2.then(() => true), new Promise(r => setTimeout(() => r(false), 20000))]);
  const last2 = await es.evaluate(() => window.r36s.lastGame && { code: window.r36s.lastGame.code, why: window.r36s.lastGame.why });
  step("psp-voltar", { gone2, last2, game: await es.evaluate(() => !!window.r36s.game) });
  check(gone2 && last2 && last2.why === "voltou pela aba do seletor", "psp: Voltar na aba do seletor fecha a aba isolada");
  await c.close();
}
