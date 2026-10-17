// Controles do R36S no navegador, por cima do ES (web/index.html) e do jogo (iframe retroarch/play.html):
//  - painel "Comandos" (design do site): na primeira entrada pelo site e no botão "?"; aba conforme o aparelho;
//  - joystick de toque (só em tela de toque): gera as MESMAS teclas do layout (WASD, L/K/J/I, U/O, Y/P, Enter,
//    Backspace) para o ES ou para o jogo; multitoque; retrato e paisagem;
//  - controle físico (Gamepad API): no ES vira teclas do layout (o SDL do ES não vê o controle); no jogo o RetroArch
//    lê o controle direto (rwebpad), com P1/P2 decididos aqui e aplicados pelo navigator.getGamepads() do iframe;
//  - 2 jogadores: 2 controles -> P1/P2; 1 controle + teclado -> teclado P1, controle P2; Start+Select no controle
//    (no ES) troca; selos P1/P2 no topo.
// Mapa por posição física (mapeamento "standard"): baixo = B, direita = A, esquerda = Y, cima = X, LB/RB = L/R,
// LT/RT = L2/R2, View/Back = Select, Menu/Start = Start. No jogo, Select+Start sai (como no aparelho).

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
const ANALOG_SYSTEMS = /^\/roms\/(n64|psp|dreamcast|psx)\//;
// teclado como Jogador 2 (troca com 1 controle): as teclas do P2 no retroarch.cfg web (teclado numérico)
const P2_CODES = { up: ["8", "Numpad8", 104], down: ["2", "Numpad2", 98], left: ["4", "Numpad4", 100], right: ["6", "Numpad6", 102],
  a: ["3", "Numpad3", 99], b: ["1", "Numpad1", 97], x: ["9", "Numpad9", 105], y: ["7", "Numpad7", 103],
  l: ["/", "NumpadDivide", 111], r: ["*", "NumpadMultiply", 106], l2: ["-", "NumpadSubtract", 109], r2: ["+", "NumpadAdd", 107],
  start: ["Enter", "NumpadEnter", 13], select: [".", "NumpadDecimal", 110] };
const CODE_TO_BTN = Object.fromEntries(Object.entries(KEYS).filter(([b]) => P2_CODES[b]).map(([b, k]) => [k[1], b]));
// botões do mapeamento standard da Gamepad API -> botão do R36S (por posição)
const PAD_MAP = { 0: "b", 1: "a", 2: "y", 3: "x", 4: "l", 5: "r", 6: "l2", 7: "r2", 8: "select", 9: "start", 12: "up", 13: "down", 14: "left", 15: "right" };
const AXIS = 0.5;

const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
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
  slots() {
    const o = this.order;
    if (o.length >= 2) return this.swapped ? [o[1], o[0]] : [o[0], o[1]];
    if (o.length === 1) return this.swapped ? [o[0], "kb"] : ["kb", o[0]];
    return ["kb", null];
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
  install(win) {
    const own = win.navigator.getGamepads ? win.navigator.getGamepads.bind(win.navigator) : () => [];
    const wrap = (gp, i) => gp && { id: gp.id, index: i, connected: gp.connected, mapping: gp.mapping, timestamp: gp.timestamp,
      buttons: gp.buttons, axes: gp.axes, vibrationActuator: gp.vibrationActuator };
    win.navigator.getGamepads = () => {
      const real = own();
      return this.slots().map((s, i) => (typeof s === "number" ? wrap(real[s], i) : null));
    };
    const held = new Set();
    const p2 = (type, e) => {
      if (!e.isTrusted || this.slots()[1] !== "kb") return;
      const b = CODE_TO_BTN[e.code];
      if (!b) return;
      if (type === "keydown") held.add(e.code); else held.delete(e.code);
      e.stopImmediatePropagation(); e.preventDefault();
      if (held.has("Backspace") && held.has("Enter")) { held.clear(); return sendTo(win, "quit", "keydown", () => sendTo(win, "quit", "keyup")); }
      const [key, code, keyCode] = P2_CODES[b];
      const c = win.document.getElementById("canvas") || win.document;
      c.dispatchEvent(new win.KeyboardEvent(type, { key, code, keyCode, which: keyCode, location: 3, bubbles: true, cancelable: true }));
    };
    win.addEventListener("keydown", e => p2("keydown", e), true);
    win.addEventListener("keyup", e => p2("keyup", e), true);
  },
};

// evento de tecla sintético no ES (canvas) ou no jogo (canvas do iframe)
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

// ---------------------------------------------------------------- instalação
export function installControls({ canvas, siteMode = false, site = null }) {
  window.r36sPads = pads;
  const touch = matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
  const state = { panel: false, touch, pads, esHeld: new Set(), touchHeld: new Set() };
  window.r36s.controls = state;

  // o SDL do ES não vê os controles (seriam um joystick sem configuração): eles chegam ao ES como teclas
  navigator.getGamepads = () => [];
  addEventListener("gamepadconnected", e => { e.stopImmediatePropagation(); pads.connect(e.gamepad); }, true);
  addEventListener("gamepaddisconnected", e => { e.stopImmediatePropagation(); pads.disconnect(e.gamepad.index); }, true);

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

  // ---- ES: controle -> teclas do layout (Select só no soltar, para Start+Select poder trocar P1/P2 sem efeito no ES)
  let selectUsed = false, prevGame = false;
  function poll() {
    requestAnimationFrame(poll);
    pads.scan();
    const inGame = !!window.r36s.game;
    if (inGame !== prevGame) {
      document.body.classList.toggle("r36s-analog", inGame && ANALOG_SYSTEMS.test(window.r36s.game.rom || ""));
      prevGame = inGame; releaseES(); if (!inGame) render(); else { clearTimeout(badgeTimer); badgeTimer = setTimeout(() => badges.classList.remove("show"), 5000); } }
    if (inGame || state.panel) return padsForPanel();
    const now = new Set();
    for (const gp of nativeGetPads()) {
      if (!gp || !gp.connected) continue;
      gp.buttons.forEach((b, i) => { if (PAD_MAP[i] && (b.pressed || b.value > 0.5)) now.add(PAD_MAP[i]); });
      const [x = 0, y = 0] = gp.axes;
      if (x < -AXIS) now.add("left"); if (x > AXIS) now.add("right");
      if (y < -AXIS) now.add("up"); if (y > AXIS) now.add("down");
    }
    const held = state.esHeld;
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
  function releaseES() { for (const b of state.esHeld) if (b !== "select") sendTo(window, b, "keyup"); state.esHeld.clear(); selectUsed = false; }
  // com o painel aberto, A/Start do controle fecham o painel
  let panelPrev = new Set();
  function padsForPanel() {
    if (!state.panel) return;
    const now = new Set();
    for (const gp of nativeGetPads()) if (gp && gp.connected) gp.buttons.forEach((b, i) => { if (b.pressed) now.add(i); });
    if ((now.has(1) && !panelPrev.has(1)) || (now.has(9) && !panelPrev.has(9))) closePanel();
    panelPrev = now;
  }
  requestAnimationFrame(poll);

  // ---- painel "Comandos"
  const panel = el("div", { id: "r36s-panel", role: "dialog", "aria-modal": "true", "aria-labelledby": "r36s-panel-title" });
  let tab = touch ? "touch" : "keys";
  const dontShow = el("input", { type: "checkbox" });
  function refreshPanel() {
    const tabs = [["keys", "Teclado"], ["pad", "Controle"]].concat(touch ? [["touch", "Toque"]] : []);
    const body = tab === "keys" ? keysTab() : tab === "pad" ? padTab() : touchTab();
    panel.replaceChildren(el("div", { class: "box" },
      el("div", { class: "head" },
        el("h1", { id: "r36s-panel-title", text: "Comandos" }),
        el("div", { class: "tabs", role: "group", "aria-label": "Tipo de controle" },
          ...tabs.map(([id, label]) => el("button", { type: "button", class: id === tab ? "on" : "", "aria-pressed": String(id === tab), text: label,
            onclick: () => { tab = id; refreshPanel(); } })))),
      body,
      el("div", { class: "foot" },
        el("label", {}, dontShow, " Não mostrar de novo"),
        el("button", { type: "button", class: "go", text: "Jogar (Enter)", onclick: closePanel }))));
  }
  function openPanel() {
    if (pads.order.length && tab === "keys") tab = "pad";
    state.panel = true; refreshPanel(); panel.classList.add("show"); releaseES();
    panel.querySelector(".go").focus();
  }
  function closePanel() {
    if (!state.panel) return;
    state.panel = false; panel.classList.remove("show");
    if (dontShow.checked) store.set("r36s-comandos-off", "1");
    const w = target(); try { (w === window ? canvas : w.document.getElementById("canvas")).focus(); } catch (e) {}
  }
  state.open = openPanel; state.close = closePanel;
  // com o painel aberto as teclas são dele (não chegam ao ES nem ao jogo); Enter/Esc fecham
  for (const type of ["keydown", "keyup"]) addEventListener(type, e => {
    if (!state.panel) return;
    e.stopImmediatePropagation();   // nem o ES (keepFocus repassa teclas ao canvas) nem o jogo veem
    if (type === "keydown" && (e.key === "Enter" || e.key === "Escape")) { e.preventDefault(); closePanel(); }
    else if (e.key !== "Tab" && !(e.key === " " && /^(INPUT|BUTTON)$/.test(e.target.tagName))) e.preventDefault();
  }, true);

  const help = el("button", { id: "r36s-help", type: "button", "aria-label": "Mostrar comandos", text: "?", onclick: () => (state.panel ? closePanel() : openPanel()) });

  document.body.append(toast, badges, panel, help);
  if (touch) installTouch(state, { openPanel, siteMode, site });
  if (siteMode && store.get("r36s-comandos-off") !== "1") openPanel();
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
      el("p", { text: "Conecte um segundo controle e ele vira o Jogador 2 sozinho. Com um controle só, o teclado fica de Jogador 1 e o controle de Jogador 2. Aperte Start + Select no controle para trocar de lugar." })));
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
      ...(game ? [item("Menu do RetroArch", () => tap("menu")), item("Salvar estado", () => tap("save")), item("Carregar estado", () => tap("load")), item("Sair do jogo", () => tap("quit"))] : []),
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
  const sync = () => {
    const now = new Set();
    for (const s of fingers.values()) for (const b of s) now.add(b);
    const held = state.touchHeld, game = !!window.r36s.game;
    if (now.size === held.size && [...now].every(b => held.has(b))) return;   // nada mudou
    // Select+Start no toque, durante o jogo: sai (o player só aceita a combinação de teclas reais)
    if (game && now.has("select") && now.has("start") && !(held.has("select") && held.has("start"))) tap("quit");
    for (const b of held) if (!now.has(b)) { press(b, false); for (const e of shown.get(b) || []) e.classList.remove("on"); }
    for (const b of now) if (!held.has(b)) { press(b, true); for (const e of shown.get(b) || []) e.classList.add("on"); }
    state.touchHeld = now;
  };
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
