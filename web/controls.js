// Controles do R36S no navegador, por cima do seletor (web/index.html) e do jogo (iframe retroarch/play.html):
//  - painel "Comandos" (design do site): no menu ≡ do seletor e no botão "?"; aba conforme o aparelho;
//  - joystick de toque (só em tela de toque): gera as MESMAS teclas do layout (WASD, L/K/J/I, U/O, Y/P, Enter,
//    Backspace) para o seletor ou para o jogo; multitoque; retrato e paisagem;
//  - controle físico (Gamepad API): no seletor vira as teclas do layout (web/app/nav.js); no jogo o RetroArch
//    lê o controle direto (rwebpad), com P1/P2 decididos aqui e aplicados pelo navigator.getGamepads() do iframe;
//  - 2 jogadores: 2 controles -> P1/P2; 1 controle + teclado/toque -> controle P1 (padrão; a aba Configurar inverte);
//    Start+Select no controle (no seletor) troca; selos P1/P2 no topo;
//  - aba "Configurar" (web/config-ui.js, preferências em web/settings.js): remapear teclado e controle, jogadores,
//    joystick de toque (tamanho, transparência, analógicos), zona morta/sensibilidade; no jogo o toque vira um
//    controle virtual ("R36S Toque") com analógico proporcional.
// Mapa por posição física (mapeamento "standard"): baixo = B, direita = A, esquerda = Y, cima = X, LB/RB = L/R,
// LT/RT = L2/R2, View/Back = Select, Menu/Start = Start. No jogo, Select+Start sai (como no aparelho).

import * as S from "./settings.js";
import { configTab } from "./config-ui.js";

// teclas do layout (iguais às do es_input.cfg e do retroarch.cfg web)
export const KEYS = {
  up: ["w", "KeyW", 87], down: ["s", "KeyS", 83], left: ["a", "KeyA", 65], right: ["d", "KeyD", 68],
  a: ["l", "KeyL", 76], b: ["k", "KeyK", 75], x: ["i", "KeyI", 73], y: ["j", "KeyJ", 74],
  l: ["u", "KeyU", 85], r: ["o", "KeyO", 79], l2: ["y", "KeyY", 89], r2: ["p", "KeyP", 80],
  start: ["Enter", "Enter", 13], select: ["Backspace", "Backspace", 8],
  menu: ["Escape", "Escape", 27], save: ["F5", "F5", 116], load: ["F7", "F7", 118], quit: ["F12", "F12", 123],
  // analógicos (retroarch.cfg web): esquerdo = setas, direito = T/F/G/H (botões C do N64)
  lsu: ["ArrowUp", "ArrowUp", 38], lsd: ["ArrowDown", "ArrowDown", 40], lsl: ["ArrowLeft", "ArrowLeft", 37], lsr: ["ArrowRight", "ArrowRight", 39],
  rsu: ["t", "KeyT", 84], rsd: ["g", "KeyG", 71], rsl: ["f", "KeyF", 70], rsr: ["h", "KeyH", 72],
};
// sistemas em que o joystick de toque mostra os dois analógicos (no jogo)
const ANALOG_SYSTEMS = new Set(["n64", "psp", "dreamcast", "psx"]);
// teclado como Jogador 2 (troca com 1 controle): as teclas do P2 no retroarch.cfg web (teclado numérico)
const P2_CODES = { up: ["8", "Numpad8", 104], down: ["2", "Numpad2", 98], left: ["4", "Numpad4", 100], right: ["6", "Numpad6", 102],
  a: ["3", "Numpad3", 99], b: ["1", "Numpad1", 97], x: ["9", "Numpad9", 105], y: ["7", "Numpad7", 103],
  l: ["/", "NumpadDivide", 111], r: ["*", "NumpadMultiply", 106], l2: ["-", "NumpadSubtract", 109], r2: ["+", "NumpadAdd", 107],
  start: ["Enter", "NumpadEnter", 13], select: [".", "NumpadDecimal", 110] };
const CANON_ACTION = Object.fromEntries(Object.entries(S.CANON_KEYS).map(([a, code]) => [code, a]));
// botões do mapeamento standard da Gamepad API -> botão do R36S (por posição)
const PAD_MAP = { 0: "b", 1: "a", 2: "y", 3: "x", 4: "l", 5: "r", 6: "l2", 7: "r2", 8: "select", 9: "start", 12: "up", 13: "down", 14: "left", 15: "right" };
const AXIS = 0.5;

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v; else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
  }
  for (const c of kids) if (c != null) e.append(c);
  return e;
};

export function prettyPad(id) {
  const s = String(id || "");
  if (/xbox|xinput|045e/i.test(s)) return "Controle Xbox";
  if (/dualsense|dualshock|playstation|054c/i.test(s)) return "Controle PlayStation";
  if (/pro controller|joy-?con|nintendo|057e/i.test(s)) return "Controle Nintendo";
  if (/8bitdo|2dc8/i.test(s)) return "Controle 8BitDo";
  const name = s.replace(/\s*\(.*$/, "").trim();
  return name ? (name.length > 26 ? name.slice(0, 25) + "…" : name) : "Controle";
}

// ---------------------------------------------------------------- controles físicos
const nativeGetPads = navigator.getGamepads ? navigator.getGamepads.bind(navigator) : () => [];
const pads = {
  order: [],        // índices da Gamepad API em ordem de conexão
  names: new Map(), // índice -> nome
  swapped: false,
  listeners: new Set(),
  // [P1, P2]: índice de controle ou "kb"
  slots() { return S.slotsFor(this.order, S.load().players, this.swapped); },
  // controle virtual do joystick de toque (no jogo, com o analógico proporcional ligado): ocupa o lugar do "teclado"
  touchPad: { id: "R36S Toque (STANDARD GAMEPAD Vendor: 0000 Product: 0000)", connected: true, mapping: "standard", timestamp: 0, on: false,
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })), axes: [0, 0, 0, 0] },
  gameWin: null,
  // avisa o RetroArch (rwebpad) dos controles do iframe: ele só registra um controle no gamepadconnected
  announce() {
    const w = this.gameWin;
    if (!w || w.closed) return;
    try { for (const gp of w.navigator.getGamepads()) if (gp) { const e = new w.Event("gamepadconnected"); e.gamepad = gp; w.dispatchEvent(e); } } catch (e) {}
  },
  label(slot) { return slot === "kb" ? "Teclado" : slot == null ? "" : this.names.get(slot) || "Controle"; },
  changed() { for (const f of this.listeners) f(); },
  connect(gp) {
    if (!gp || this.order.includes(gp.index)) return;
    this.order.push(gp.index); this.names.set(gp.index, prettyPad(gp.id)); this.last = prettyPad(gp.id); this.changed();
  },
  disconnect(index) {
    const i = this.order.indexOf(index);
    if (i < 0) return;
    this.order.splice(i, 1); this.names.delete(index); if (!this.order.length) this.swapped = false; this.changed();
  },
  scan() { for (const gp of nativeGetPads()) if (gp && gp.connected) this.connect(gp); },
  swap() { this.swapped = !this.swapped; this.changed(); },

  // iframe do jogo: navigator.getGamepads() devolve [P1, P2] já na ordem dos slots; teclado como P2 vira teclas do P2
  // controles com o remapeamento aplicados (web/settings.js), no layout "standard" do R36S, e o virtual de toque
  install(win) {
    const own = win.navigator.getGamepads ? win.navigator.getGamepads.bind(win.navigator) : () => [];
    this.gameWin = win;
    win.navigator.getGamepads = () => {
      const real = own();
      return this.slots().map((s, i) => {
        if (typeof s === "number") { const m = S.mapPad(real[s]); if (m) m.index = i; return m; }
        if (s === "kb" && this.touchPad.on) return { ...this.touchPad, index: i };
        return null;
      });
    };
    // teclado no jogo: remapeamento (tecla física -> tecla do layout) e teclado como Jogador 2 (teclas do teclado numérico)
    const held = new Set();
    const onKey = (type, e) => {
      if (!e.isTrusted) return;
      const t = S.keyTable(), a = t.changed ? t.byCode.get(e.code) : CANON_ACTION[e.code], dead = t.changed && t.dead.has(e.code);
      const kbP2 = this.slots()[1] === "kb";
      if (!a && !dead) return;                                           // fora do layout (Esc, F5, ...): segue
      if (!dead && !kbP2 && S.CANON_KEYS[a] === e.code) return;          // nada a traduzir (o play.js cuida de Select+Start)
      e.stopImmediatePropagation(); e.preventDefault();
      if (dead || e.repeat) return;
      if (type === "keydown") held.add(a); else held.delete(a);
      if (held.has("select") && held.has("start")) { held.clear(); return sendTo(win, "quit", "keydown", () => sendTo(win, "quit", "keyup")); }
      if (!kbP2) return sendTo(win, a, type);
      if (!P2_CODES[a]) return;
      const [key, code, keyCode] = P2_CODES[a];
      const c = win.document.getElementById("canvas") || win.document;
      c.dispatchEvent(new win.KeyboardEvent(type, { key, code, keyCode, which: keyCode, location: 3, bubbles: true, cancelable: true }));
    };
    win.addEventListener("keydown", e => onKey("keydown", e), true);
    win.addEventListener("keyup", e => onKey("keyup", e), true);
    win.addEventListener("load", () => this.announced = false);
    this.announced = false;
  },
};

// evento de tecla sintético no seletor (#app) ou no jogo (canvas do iframe)
function sendTo(win, btn, type, then) {
  const [key, code, keyCode] = KEYS[btn];
  const c = win.document.getElementById("canvas") || win.document;
  c.dispatchEvent(new win.KeyboardEvent(type, { key, code, keyCode, which: keyCode, bubbles: true, cancelable: true }));
  if (then) setTimeout(then, 120);
}
function target() {
  const g = window.r36s && window.r36s.game;
  try { if (g && g.iframe && g.iframe.contentWindow && g.iframe.contentWindow.document.getElementById("canvas")) return g.iframe.contentWindow; } catch (e) {}
  return g ? null : window;
}
function press(btn, down) {
  const w = target();
  if (w) sendTo(w, btn, down ? "keydown" : "keyup");
}
function tap(btn) { const w = target(); if (w) sendTo(w, btn, "keydown", () => sendTo(w, btn, "keyup")); }
// sair do jogo: ainda carregando, cancela pela ponte (o RetroArch não começou e não ouve a tecla de sair)
function quitGame() {
  const g = window.r36s && window.r36s.game;
  if (g && !g.started && g.abort) return g.abort();
  tap("quit");
}

// ---------------------------------------------------------------- instalação
export function installControls({ canvas, siteMode = false, site = null }) {
  window.r36sPads = pads;
  const touch = matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
  const state = { panel: false, touch, pads, pageHeld: new Set(), touchHeld: new Set() };
  window.r36s.controls = state;

  // a página não lê o controle direto: ele chega ao seletor como teclas do layout (e ao jogo pelo iframe)
  navigator.getGamepads = () => [];
  addEventListener("gamepadconnected", e => { e.stopImmediatePropagation(); pads.connect(e.gamepad); }, true);
  addEventListener("gamepaddisconnected", e => { e.stopImmediatePropagation(); pads.disconnect(e.gamepad.index); }, true);
  // teclado no seletor: remapeamento (tecla física -> tecla do layout). Antes do nav.js (registrado depois, no window).
  for (const type of ["keydown", "keyup"]) addEventListener(type, e => {
    if (!e.isTrusted || state.panel || window.r36s.game) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;   // texto da busca
    const t = S.keyTable();
    if (!t.changed) return;
    const a = t.byCode.get(e.code);
    if (t.dead.has(e.code)) { e.stopImmediatePropagation(); e.preventDefault(); return; }
    if (!a || S.CANON_KEYS[a] === e.code) return;
    e.stopImmediatePropagation(); e.preventDefault();
    if (!e.repeat) sendTo(window, a, type);
  }, true);

  // ---- selos P1/P2 + aviso de controle conectado
  const toast = el("div", { id: "r36s-toast", role: "status" });
  const badges = el("div", { id: "r36s-badges", role: "status" });
  let toastTimer = 0, badgeTimer = 0, lastCount = 0;
  const render = () => {
    const [p1, p2] = pads.slots();
    badges.replaceChildren();
    if (pads.order.length) {
      badges.append(el("span", { class: "p1", text: `P1 · ${pads.label(p1)}` }));
      if (p2 != null) badges.append(el("span", { class: "p2", text: `P2 · ${pads.label(p2)}` }));
    }
    badges.classList.add("show");
    clearTimeout(badgeTimer);
    if (window.r36s.game) badgeTimer = setTimeout(() => badges.classList.remove("show"), 5000);
    if (pads.order.length > lastCount) {
      toast.replaceChildren(padIcon(), `${pads.last} conectado`);
      toast.classList.add("show");
      clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove("show"), 4000);
    }
    lastCount = pads.order.length;
    if (state.panel) refreshPanel();
  };
  pads.listeners.add(render);

  // ---- seletor: controle -> teclas do layout (Select só no soltar, para Start+Select poder trocar P1/P2 sem efeito no seletor)
  let selectUsed = false, prevGame = false;
  function poll() {
    requestAnimationFrame(poll);
    pads.scan();
    const inGame = !!window.r36s.game;
    if (inGame !== prevGame) {
      sticks();
      document.body.classList.toggle("r36s-ingame", inGame);
      prevGame = inGame; releasePage(); if (!inGame) render(); else { clearTimeout(badgeTimer); badgeTimer = setTimeout(() => badges.classList.remove("show"), 5000); } }
    // jogo começou (o RetroArch já escuta): avisa dos controles do iframe, inclusive o virtual de toque
    const g = window.r36s.game;
    const tpOn = touch && !!(g && g.iframe) && S.load().analog.touchAnalog;
    if (tpOn !== pads.touchPad.on) { pads.touchPad.on = tpOn; pads.announced = false; }
    if (g && g.started && g.iframe && !pads.announced) { pads.announced = true; pads.announce(); }
    // controle com o jogo ainda carregando: Select+Start cancela (o RetroArch ainda não lê o controle)
    if (g && !g.started && g.abort && !state.panel) {
      for (const raw of nativeGetPads()) { const m = raw && raw.connected && S.mapPad(raw); if (m && m.buttons[8].pressed && m.buttons[9].pressed) { g.abort(); break; } }
    }
    if (inGame || state.panel) return padsForPanel();
    const now = new Set();
    for (const raw of nativeGetPads()) {
      if (!raw || !raw.connected) continue;
      const gp = S.mapPad(raw);
      gp.buttons.forEach((b, i) => { if (PAD_MAP[i] && b.pressed) now.add(PAD_MAP[i]); });
      const [x = 0, y = 0] = gp.axes;
      if (x < -AXIS) now.add("left"); if (x > AXIS) now.add("right");
      if (y < -AXIS) now.add("up"); if (y > AXIS) now.add("down");
    }
    const held = state.pageHeld;
    if (now.has("select") && now.has("start") && !selectUsed) { selectUsed = true; pads.swap(); }
    for (const b of held) if (!now.has(b)) {
      held.delete(b);
      if (b === "select") { if (!selectUsed) tap("select"); selectUsed = false; }
      else if (!(b === "start" && selectUsed)) press(b, false);
    }
    for (const b of now) if (!held.has(b)) {
      held.add(b);
      if (b === "select" || (b === "start" && now.has("select"))) continue;
      press(b, true);
    }
  }
  function releasePage() { for (const b of state.pageHeld) if (b !== "select") sendTo(window, b, "keyup"); state.pageHeld.clear(); selectUsed = false; }
  // com o painel aberto, A/Start do controle fecham o painel
  let panelPrev = new Set();
  let bindReady = false;
  function padsForPanel() {
    if (!state.panel) return;
    if (state.padBinding) {   // "aperte no controle": espera tudo solto, depois pega o primeiro botão/eixo
      let src = null;
      for (const gp of nativeGetPads()) if (gp && gp.connected && (src = S.padActive(gp))) break;
      if (!src) bindReady = true;
      else if (bindReady) { bindReady = false; state.padBinding(src); }
      panelPrev = new Set([1, 9]);   // não fecha o painel com o botão que acabou de ser gravado
      return;
    }
    bindReady = false;
    const now = new Set();
    for (const gp of nativeGetPads()) if (gp && gp.connected) gp.buttons.forEach((b, i) => { if (b.pressed) now.add(i); });
    if ((now.has(1) && !panelPrev.has(1)) || (now.has(9) && !panelPrev.has(9))) closePanel();
    panelPrev = now;
  }
  requestAnimationFrame(poll);
  // analógicos de toque: modo da aba Configurar (auto = só nos sistemas com analógico)
  function sticks() {
    const g = window.r36s.game, sys = g && (g.system || ((g.rom || "").match(/^\/roms\/([^/]+)\//) || [])[1]);
    const mode = S.load().touch.sticks;
    document.body.classList.toggle("r36s-analog", !!g && (mode === "sempre" || (mode === "auto" && ANALOG_SYSTEMS.has(sys))));
  }
  S.onChange(() => { sticks(); pads.changed(); if (state.applyTouch) state.applyTouch(); });

  // ---- painel "Comandos"
  const panel = el("div", { id: "r36s-panel", role: "dialog", "aria-modal": "true", "aria-labelledby": "r36s-panel-title" });
  let tab = touch ? "touch" : "keys";
  function refreshPanel() {
    const tabs = [["keys", "Teclado"], ["pad", "Controle"]].concat(touch ? [["touch", "Toque"]] : []).concat([["config", "Configurar"]]);
    const body = tab === "keys" ? keysTab() : tab === "pad" ? padTab() : tab === "touch" ? touchTab()
      : configTab({ state, pads, refresh: () => { const box = panel.querySelector(".box"), y = box ? box.scrollTop : 0; refreshPanel(); const nb = panel.querySelector(".box"); if (nb) nb.scrollTop = y; } });
    panel.replaceChildren(el("div", { class: "box" },
      el("div", { class: "head" },
        el("h1", { id: "r36s-panel-title", text: "Comandos" }),
        el("div", { class: "tabs", role: "group", "aria-label": "Tipo de controle" },
          ...tabs.map(([id, label]) => el("button", { type: "button", class: id === tab ? "on" : "", "aria-pressed": String(id === tab), text: label,
            onclick: () => { tab = id; refreshPanel(); } })))),
      body,
      el("div", { class: "foot" },
        el("button", { type: "button", class: "go", text: "Jogar (Enter)", onclick: closePanel }))));
  }
  function openPanel() {
    if (pads.order.length && tab === "keys") tab = "pad";
    state.panel = true; refreshPanel(); panel.classList.add("show"); releasePage();
    panel.querySelector(".go").focus();
  }
  function closePanel() {
    if (!state.panel) return;
    state.binding = null; state.padBinding = null; state.bindingAction = null;
    state.panel = false; panel.classList.remove("show");
    const w = target(); try { (w === window ? canvas : w.document.getElementById("canvas")).focus(); } catch (e) {}
  }
  state.open = openPanel; state.close = closePanel;
  // com o painel aberto as teclas são dele (não chegam ao seletor nem ao jogo); Enter/Esc fecham
  for (const type of ["keydown", "keyup"]) addEventListener(type, e => {
    if (!state.panel) return;
    e.stopImmediatePropagation();   // nem o seletor nem o jogo veem
    if (state.binding) { e.preventDefault(); if (type === "keydown" && !e.repeat) state.binding(e); return; }   // remapeando
    if (type === "keydown" && (e.key === "Enter" || e.key === "Escape")) { e.preventDefault(); closePanel(); }
    else if (e.key !== "Tab" && !(e.key === " " && /^(INPUT|BUTTON)$/.test(e.target.tagName))) e.preventDefault();
  }, true);

  const help = el("button", { id: "r36s-help", type: "button", "aria-label": "Mostrar comandos", text: "?", onclick: () => (state.panel ? closePanel() : openPanel()) });

  document.body.append(toast, badges, panel, help);
  if (touch) installTouch(state, { openPanel, siteMode, site });
  render();
  return state;
}

// ---------------------------------------------------------------- abas do painel
function padIcon() {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("aria-hidden", "true"); s.setAttribute("width", "20"); s.setAttribute("height", "20"); s.setAttribute("viewBox", "0 0 24 24");
  s.innerHTML = '<rect x="2" y="7" width="20" height="10" rx="5" fill="none" stroke="currentColor" stroke-width="2.5"></rect>';
  return s;
}
const kbd = t => el("kbd", { text: t });
const pair = (dt, dd, cls) => [el("dt", { class: cls || "", text: dt }), el("dd", { text: dd })];
function keysTab() {
  return el("div", { class: "tab-keys" },
    el("div", { class: "hands" },
      el("div", { class: "hand" }, el("span", { class: "cap c", text: "MÃO ESQUERDA" }),
        el("div", { class: "wasd" }, el("span"), kbd("W"), el("span"), kbd("A"), kbd("S"), kbd("D")),
        el("span", { class: "lbl", text: "Direcional" })),
      el("div", { class: "hand" }, el("span", { class: "cap y", text: "MÃO DIREITA" }),
        el("dl", { class: "right" }, ...pair("L", "A", "k"), ...pair("K", "B", "k"), ...pair("J", "Y", "k"), ...pair("I", "X", "k"),
          ...pair("U", "L", "s"), ...pair("O", "R", "s"), ...pair("Y", "L2", "s"), ...pair("P", "R2", "s")))),
    el("dl", { class: "extra" }, ...pair("Enter", "Start", "y"), ...pair("Backspace", "Select", "y"),
      ...pair("Backspace + Enter", "Sair do jogo", "c"), ...pair("Esc", "Menu do RetroArch", "c"), ...pair("F5 · F7", "Salvar · carregar estado", "c")));
}
function padTab() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("role", "img"); svg.setAttribute("aria-label", "Controle com os botões do R36S"); svg.setAttribute("viewBox", "0 0 300 180");
  svg.setAttribute("class", "padart");
  svg.innerHTML = '<g fill="none" stroke="#ece6ff" stroke-width="3"><path d="M60 30h180a50 50 0 0 1 50 50v20a50 50 0 0 1-90 30l-10-10H110l-10 10a50 50 0 0 1-90-30V80a50 50 0 0 1 50-50z"></path>' +
    '<path d="M70 72v36M52 90h36"></path><circle cx="230" cy="70" r="11"></circle><circle cx="252" cy="92" r="11"></circle><circle cx="208" cy="92" r="11"></circle><circle cx="230" cy="114" r="11"></circle>' +
    '<path d="M60 22h40M200 22h40"></path></g>';
  const names = [...pads.names.values()];
  return el("div", { class: "tab-pad" },
    names.length ? el("p", { class: "found", text: `Detectado: ${names.join(" · ")}` }) : el("p", { class: "found none", text: "Nenhum controle detectado ainda: conecte e aperte um botão." }),
    el("div", { class: "padrow" }, svg,
      el("dl", {}, ...pair("B (direita)", "A do R36S", "y"), ...pair("A (baixo)", "B do R36S", "y"), ...pair("X · Y", "Y · X do R36S", "y"),
        ...pair("LB · RB", "L · R", "y"), ...pair("LT · RT", "L2 · R2", "y"), ...pair("View + Menu", "Sair do jogo", "c"))),
    el("p", { class: "note", text: "Os botões seguem a posição física do R36S, não a letra impressa no controle." }),
    el("div", { class: "two" }, el("span", { text: "2 JOGADORES" }),
      el("p", { text: "Conecte um segundo controle e ele vira o Jogador 2 sozinho. Com um controle só, ele é o Jogador 1 e o teclado (ou o toque) o Jogador 2. Aperte Start + Select no controle para trocar de lugar, ou mude na aba Configurar." })));
}
function touchTab() {
  return el("div", { class: "tab-touch" },
    el("dl", { class: "extra" }, ...pair("Direcional", "à esquerda (dá para deslizar o dedo)", "y"), ...pair("A · B · X · Y", "à direita", "y"),
      ...pair("L · R", "em cima, nos cantos (L2 · R2 logo abaixo)", "y"), ...pair("SELECT · START", "embaixo, no meio", "y"),
      ...pair("SELECT + START", "Sair do jogo", "c"), ...pair("≡", "Menu: comandos, menu do RetroArch, salvar/carregar estado", "c")),
    el("p", { class: "note", text: "Dá para apertar o direcional e um botão ao mesmo tempo. Funciona em pé e deitado; deitado a tela fica maior." }));
}

// ---------------------------------------------------------------- joystick de toque
function installTouch(state, { openPanel, siteMode, site }) {
  document.body.classList.add("r36s-touch");
  const btn = (name, label, cls) => el("button", { type: "button", class: `tb ${cls || ""}`, "data-btn": name, "aria-label": label, text: label });
  const dpad = el("div", { class: "dpad", role: "group", "aria-label": "Direcional", "data-dpad": "1" },
    el("span"), el("i", { class: "u", text: "▲" }), el("span"), el("i", { class: "l", text: "◀" }), el("span", { class: "mid" }),
    el("i", { class: "r", text: "▶" }), el("span"), el("i", { class: "d", text: "▼" }), el("span"));
  const abxy = el("div", { class: "abxy", role: "group", "aria-label": "Botões de ação" },
    btn("x", "X", "x"), btn("y", "Y", "y"), btn("a", "A", "a"), btn("b", "B", "b"));
  const menuBtn = el("button", { type: "button", class: "menu", "aria-label": "Menu", text: "≡" });
  function stick(side, label) { return el("div", { class: `stick ${side}s`, role: "group", "aria-label": label, "data-stick": side }, el("b")); }
  const pad = el("div", { id: "r36s-touch" },
    btn("l", "L", "sh l"), btn("r", "R", "sh r"), btn("l2", "L2", "sh2 l2"), btn("r2", "R2", "sh2 r2"),
    dpad, abxy, el("div", { class: "ss" }, btn("select", "SELECT", "pill"), btn("start", "START", "pill")), menuBtn,
    stick("l", "Analógico esquerdo"), stick("r", "Analógico direito"));
  document.body.append(pad);

  const sheet = el("div", { id: "r36s-sheet", role: "menu" });
  const item = (label, fn) => el("button", { type: "button", role: "menuitem", text: label, onclick: () => { sheet.classList.remove("show"); fn(); } });
  menuBtn.addEventListener("click", () => {
    const game = !!window.r36s.game;
    sheet.replaceChildren(item("Comandos", openPanel),
      ...(game ? [item("Menu do RetroArch", () => tap("menu")), item("Salvar estado", () => tap("save")), item("Carregar estado", () => tap("load")), item("Sair do jogo", quitGame)] : []),
      item("Tela cheia", () => (document.fullscreenElement ? document.exitFullscreen() : (parent !== window ? parent.document.documentElement : document.documentElement).requestFullscreen()).catch(() => {})),
      ...(siteMode && site && site.exit ? [item("Voltar ao site", () => site.exit())] : []),
      item("Fechar", () => {}));
    sheet.classList.toggle("show");
  });
  document.body.append(sheet);

  // orientação: retrato = tela em cima e controles embaixo
  const orient = () => document.body.classList.toggle("r36s-portrait", innerHeight > innerWidth);
  addEventListener("resize", orient); orient();

  // ponteiros: cada dedo aperta o que está embaixo dele (deslizar troca de botão); direcional por ângulo, 8 direções.
  // Tudo isto roda na thread do jogo e o toque do celular manda 120-240 eventos/s: as posições dos botões ficam em cache
  // (nada de elementFromPoint/getBoundingClientRect por movimento), no máximo um processamento por quadro, e só os
  // botões que mudaram são tocados no DOM.
  const fingers = new Map();
  let rects = null;
  const fingerPos = new Map();   // dedo -> [x, y]
  // pino de cada analógico: segue o dedo que está sobre ele (até a borda); sem dedo, volta ao centro. Uma vez por quadro.
  const drawKnobs = () => {
    for (const q of rects || []) if (q.stick) {
      let dx = 0, dy = 0;
      for (const [x, y] of fingerPos.values()) if (x >= q.l && x <= q.r && y >= q.t && y <= q.b) {
        dx = x - q.cx; dy = y - q.cy;
        const k = Math.min(1, q.w / 2 / (Math.hypot(dx, dy) || 1)); dx *= k; dy *= k;
        break;
      }
      q.el.firstChild.style.transform = `translate(${Math.round(dx)}px, ${Math.round(dy)}px)`;
    }
  };
  const measure = () => {
    rects = [];
    const d = dpad.getBoundingClientRect();
    rects.push({ dpad: true, l: d.left, t: d.top, r: d.right, b: d.bottom, cx: d.left + d.width / 2, cy: d.top + d.height / 2, w: d.width });
    for (const e of pad.querySelectorAll("[data-stick]")) {
      const q = e.getBoundingClientRect();
      // a área de toque passa um pouco da borda: o dedo escorrega para fora sem soltar o analógico
      if (q.width) rects.push({ stick: e.dataset.stick, el: e, l: q.left - 30, t: q.top - 30, r: q.right + 30, b: q.bottom + 30,
        cx: q.left + q.width / 2, cy: q.top + q.height / 2, w: q.width });
    }
    for (const e of pad.querySelectorAll("[data-btn]")) {
      const q = e.getBoundingClientRect();
      if (q.width) rects.push({ btn: e.dataset.btn, l: q.left, t: q.top, r: q.right, b: q.bottom });
    }
  };
  addEventListener("resize", () => { rects = null; });
  const at = (x, y) => {
    if (!rects) measure();
    for (const q of rects) {
      if (x < q.l || x > q.r || y < q.t || y > q.b) continue;
      if (q.btn) return [q.btn];
      const dx = x - q.cx, dy = y - q.cy;
      if (q.stick) {   // 8 direções, zona morta de 25% do raio
        const rad = q.w / 2, dist = Math.hypot(dx, dy);
        if (dist < rad * 0.25) return [];
        const a = Math.atan2(dy, dx) * 180 / Math.PI, s = q.stick + "s", out = [];
        if (a > -67.5 && a < 67.5) out.push(s + "r"); if (a > 112.5 || a < -112.5) out.push(s + "l");
        if (a > 22.5 && a < 157.5) out.push(s + "d"); if (a < -22.5 && a > -157.5) out.push(s + "u");
        return out;
      }
      if (Math.hypot(dx, dy) < q.w * 0.12) return [];
      const a = Math.atan2(dy, dx) * 180 / Math.PI, out = [];   // 0 = direita, 90 = baixo
      if (a > -67.5 && a < 67.5) out.push("right"); if (a > 112.5 || a < -112.5) out.push("left");
      if (a > 22.5 && a < 157.5) out.push("down"); if (a < -22.5 && a > -157.5) out.push("up");
      return out;
    }
    return [];
  };
  const shown = new Map();   // botão -> elemento(s) acesos
  for (const e of pad.querySelectorAll("[data-btn]")) shown.set(e.dataset.btn, [e]);
  for (const [c, b] of [["u", "up"], ["d", "down"], ["l", "left"], ["r", "right"]]) shown.set(b, [dpad.querySelector("." + c)]);
  // no jogo, com o analógico proporcional ligado, o toque é o controle virtual (pads.touchPad) e não manda teclas
  const padMode = () => pads.touchPad.on;
  const STD = { b: 0, a: 1, y: 2, x: 3, l: 4, r: 5, l2: 6, r2: 7, select: 8, start: 9, up: 12, down: 13, left: 14, right: 15 };
  const DIRS = ["up", "down", "left", "right"];
  const keysDown = new Set();   // teclas realmente apertadas (modo teclas)
  // eixos dos analógicos: deslocamento do dedo / raio, no círculo, com zona morta radial
  const stickAxes = () => {
    const out = [0, 0, 0, 0], dz = S.load().analog.deadzone;
    for (const q of rects || []) if (q.stick) for (const [x, y] of fingerPos.values()) {
      if (x < q.l || x > q.r || y < q.t || y > q.b) continue;
      let dx = (x - q.cx) / (q.w / 2), dy = (y - q.cy) / (q.w / 2);
      const m = Math.hypot(dx, dy);
      if (m > 1) { dx /= m; dy /= m; }
      const k = m <= dz ? 0 : Math.min(1, (Math.min(m, 1) - dz) / (1 - dz)) / (Math.min(m, 1) || 1);
      const i = q.stick === "l" ? 0 : 2;
      out[i] = +(dx * k).toFixed(3); out[i + 1] = +(dy * k).toFixed(3);
      break;
    }
    return out;
  };
  const updatePad = now => {
    const tp = pads.touchPad;
    if (!tp.on) return;
    const dpadStick = S.load().touch.dpadAsStick;
    tp.buttons.forEach((b, i) => { b.pressed = false; b.touched = false; b.value = 0; });
    for (const b of now) if (STD[b] != null && !(dpadStick && DIRS.includes(b))) { const k = tp.buttons[STD[b]]; k.pressed = k.touched = true; k.value = 1; }
    const ax = stickAxes();
    if (dpadStick && !ax[0] && !ax[1]) { ax[0] = (now.has("right") ? 1 : 0) - (now.has("left") ? 1 : 0); ax[1] = (now.has("down") ? 1 : 0) - (now.has("up") ? 1 : 0); }
    tp.axes = ax; tp.timestamp++;
  };
  const sync = () => {
    const now = new Set();
    for (const s of fingers.values()) for (const b of s) now.add(b);
    const held = state.touchHeld, game = !!window.r36s.game, pm = padMode();
    if (!(now.size === held.size && [...now].every(b => held.has(b)))) {
      // Select+Start no toque, durante o jogo: sai (com o controle virtual, o RetroArch sai sozinho pela combinação 4)
      if (game && (!pm || !window.r36s.game.started) && now.has("select") && now.has("start") && !(held.has("select") && held.has("start"))) quitGame();
      for (const b of held) if (!now.has(b)) for (const e of shown.get(b) || []) e.classList.remove("on");
      for (const b of now) if (!held.has(b)) for (const e of shown.get(b) || []) e.classList.add("on");
      state.touchHeld = now;
    }
    // teclas: no seletor sempre; no jogo só sem o controle virtual
    const want = pm ? new Set() : now;
    for (const b of [...keysDown]) if (!want.has(b)) { keysDown.delete(b); press(b, false); }
    for (const b of want) if (!keysDown.has(b)) { keysDown.add(b); press(b, true); }
    updatePad(now);
  };
  // tamanho e transparência (aba Configurar)
  state.applyTouch = () => {
    const t = S.load().touch;
    pad.style.setProperty("--ts", { p: 0.8, m: 1, g: 1.2 }[t.size] || 1);
    pad.dataset.size = t.size;
    pad.style.opacity = t.opacity;
    rects = null;
  };
  state.applyTouch();
  let moved = false;
  const flush = () => { moved = false; sync(); drawKnobs(); };
  pad.addEventListener("pointerdown", e => {
    if (e.target.closest(".menu")) return;
    e.preventDefault();
    try { pad.setPointerCapture(e.pointerId); } catch (x) {}
    if (!fingers.size) rects = null;   // a cada novo toque, mede de novo (a orientação pode ter mudado)
    fingerPos.set(e.pointerId, [e.clientX, e.clientY]);
    fingers.set(e.pointerId, at(e.clientX, e.clientY)); sync(); drawKnobs();   // apertar responde na hora
  });
  pad.addEventListener("pointermove", e => {
    if (!fingers.has(e.pointerId)) return;
    fingerPos.set(e.pointerId, [e.clientX, e.clientY]);
    fingers.set(e.pointerId, at(e.clientX, e.clientY));
    if (!moved) { moved = true; requestAnimationFrame(flush); }
  });
  for (const t of ["pointerup", "pointercancel", "lostpointercapture"]) pad.addEventListener(t, e => {
    fingerPos.delete(e.pointerId);
    if (fingers.delete(e.pointerId)) { sync(); drawKnobs(); }
  });
  pad.addEventListener("contextmenu", e => e.preventDefault());
}
