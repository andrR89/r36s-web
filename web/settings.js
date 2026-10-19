// Preferências de controle, por aparelho (localStorage). Usadas pela página do seletor (web/controls.js, web/config-ui.js)
// e pelo player (web/retroarch/play.js: zona morta e sensibilidade). Funções de mapeamento puras (testes em
// tests/test_settings.mjs). Design: docs/superpowers/specs/2026-10-17-configurar-controles-design.md
export const KEY = "r36s-controles-v1";

// ações do layout do R36S, na ordem da tela
export const ACTIONS = ["up", "down", "left", "right", "a", "b", "x", "y", "l", "r", "l2", "r2", "start", "select",
  "lsu", "lsd", "lsl", "lsr", "rsu", "rsd", "rsl", "rsr"];
export const LABELS = { up: "Cima", down: "Baixo", left: "Esquerda", right: "Direita", a: "A", b: "B", x: "X", y: "Y",
  l: "L", r: "R", l2: "L2", r2: "R2", start: "Start", select: "Select",
  lsu: "Analógico esq. ↑", lsd: "Analógico esq. ↓", lsl: "Analógico esq. ←", lsr: "Analógico esq. →",
  rsu: "Analógico dir. ↑", rsd: "Analógico dir. ↓", rsl: "Analógico dir. ←", rsr: "Analógico dir. →" };

// teclado: a tecla canônica de cada ação (event.code) — é o que o seletor (web/app/nav.js) e o RetroArch (retroarch.cfg web)
// entendem. Remapear = dizer qual tecla física faz a ação; a tradução manda a canônica.
export const CANON_KEYS = { up: "KeyW", down: "KeyS", left: "KeyA", right: "KeyD", a: "KeyL", b: "KeyK", x: "KeyI", y: "KeyJ",
  l: "KeyU", r: "KeyO", l2: "KeyY", r2: "KeyP", start: "Enter", select: "Backspace",
  lsu: "ArrowUp", lsd: "ArrowDown", lsl: "ArrowLeft", lsr: "ArrowRight", rsu: "KeyT", rsd: "KeyG", rsl: "KeyF", rsr: "KeyH" };

// controle: o mapeamento "standard" da Gamepad API pela posição do R36S (baixo = B, direita = A, esquerda = Y, cima = X)
// — é o que o seletor (web/app/nav.js) e o retroarch.cfg web (PAD_BUTTONS/PAD_AXES) esperam. Fonte: "b:N" botão, "a:N+"/"a:N-" meio-eixo.
export const CANON_PAD = { up: "b:12", down: "b:13", left: "b:14", right: "b:15", a: "b:1", b: "b:0", x: "b:3", y: "b:2",
  l: "b:4", r: "b:5", l2: "b:6", r2: "b:7", start: "b:9", select: "b:8",
  lsu: "a:1-", lsd: "a:1+", lsl: "a:0-", lsr: "a:0+", rsu: "a:3-", rsd: "a:3+", rsl: "a:2-", rsr: "a:2+" };
export const PAD_NAMES = { 0: "A (baixo)", 1: "B (direita)", 2: "X (esquerda)", 3: "Y (cima)", 4: "LB", 5: "RB", 6: "LT", 7: "RT",
  8: "View/Select", 9: "Menu/Start", 10: "L3", 11: "R3", 12: "Cruz ↑", 13: "Cruz ↓", 14: "Cruz ←", 15: "Cruz →", 16: "Home" };

export const DEFAULTS = {
  players: "auto",          // auto (1 controle = P1, teclado/toque = P2) | teclado-p1
  keys: {},                 // ação -> event.code (só o que mudou)
  pad: {},                  // ação -> "b:N" | "a:N+" | "a:N-" (só o que mudou)
  touch: { size: "m", opacity: 0.85, sticks: "auto", dpadAsStick: false },
  analog: { deadzone: 0.15, sensitivity: 1.0, touchAnalog: true },
};

const clone = o => JSON.parse(JSON.stringify(o));
function merge(base, over) {
  const out = clone(base);
  for (const [k, v] of Object.entries(over || {}))
    out[k] = v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object" ? { ...base[k], ...v } : v;
  return out;
}

let current = null;
const listeners = new Set();
export function load() {
  if (current) return current;
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) {}
  current = merge(DEFAULTS, saved);
  return current;
}
export function save(next) {
  current = merge(DEFAULTS, next);
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch (e) {}
  for (const f of listeners) try { f(current); } catch (e) { console.warn("[settings]", e); }
  return current;
}
export function update(fn) { const s = clone(load()); fn(s); return save(s); }
export function reset() { return save(clone(DEFAULTS)); }
export function onChange(f) { listeners.add(f); return () => listeners.delete(f); }
// outra aba/iframe mudou: recarrega
if (typeof addEventListener === "function") addEventListener("storage", e => { if (e.key === KEY) { current = null; const s = load(); for (const f of listeners) f(s); } });

// ---------------------------------------------------------------- teclado
// tecla física -> ação; e o conjunto de teclas canônicas que perderam a ação (deixam de valer)
export function keyTable(keys = load().keys) {
  const byCode = new Map(), dead = new Set();
  for (const a of ACTIONS) byCode.set(keys[a] || CANON_KEYS[a], a);
  for (const a of ACTIONS) if (keys[a] && keys[a] !== CANON_KEYS[a] && byCode.get(CANON_KEYS[a]) === undefined) dead.add(CANON_KEYS[a]);
  return { byCode, dead, changed: Object.keys(keys).length > 0 };
}

// ---------------------------------------------------------------- controle
const src = s => { const m = /^([ab]):(\d+)([+-]?)$/.exec(s || ""); return m ? { kind: m[1], i: +m[2], sign: m[3] === "-" ? -1 : 1 } : null; };
// quanto a fonte está "apertada", 0..1 (eixo: só o meio-eixo do sinal, já sem a zona morta)
export function sourceValue(gp, s, deadzone = 0) {
  const q = src(s);
  if (!q || !gp) return 0;
  if (q.kind === "b") { const b = gp.buttons[q.i]; return b ? (typeof b === "object" ? (b.pressed ? Math.max(b.value, 1) : b.value) : +b) : 0; }
  const v = (gp.axes[q.i] || 0) * q.sign;
  return v <= deadzone ? 0 : Math.min(1, (v - deadzone) / (1 - deadzone));
}
const AXES = [["lsl", "lsr"], ["lsu", "lsd"], ["rsl", "rsr"], ["rsu", "rsd"]];
const BUTTONS = { 0: "b", 1: "a", 2: "y", 3: "x", 4: "l", 5: "r", 6: "l2", 7: "r2", 8: "select", 9: "start", 12: "up", 13: "down", 14: "left", 15: "right" };
// controle real -> controle "standard" no layout do R36S, com o remapeamento e a zona morta aplicados
export function mapPad(gp, pad = load().pad, deadzone = load().analog.deadzone) {
  if (!gp) return null;
  const from = a => pad[a] || CANON_PAD[a];
  const buttons = Array.from({ length: 17 }, (_, i) => {
    const v = sourceValue(gp, BUTTONS[i] ? from(BUTTONS[i]) : "b:" + i);
    return { pressed: v >= 0.5, touched: v > 0, value: v };
  });
  const axes = AXES.map(([neg, pos]) => +(sourceValue(gp, from(pos), deadzone) - sourceValue(gp, from(neg), deadzone)).toFixed(4));
  return { id: gp.id, index: gp.index, connected: gp.connected, mapping: "standard", timestamp: gp.timestamp, buttons, axes,
    vibrationActuator: gp.vibrationActuator };
}
// o que mudou num controle desde o último quadro (para "aperte o botão" na tela de remapear)
export function padActive(gp, threshold = 0.6) {
  if (!gp) return null;
  for (let i = 0; i < gp.buttons.length; i++) if (sourceValue(gp, "b:" + i) > threshold) return "b:" + i;
  for (let i = 0; i < gp.axes.length; i++) { const v = gp.axes[i] || 0; if (Math.abs(v) > threshold) return `a:${i}${v < 0 ? "-" : "+"}`; }
  return null;
}
export function sourceName(s) {
  const q = src(s);
  if (!q) return "—";
  if (q.kind === "b") return PAD_NAMES[q.i] || `Botão ${q.i}`;
  const stick = q.i < 2 ? "Analógico esq." : q.i < 4 ? "Analógico dir." : `Eixo ${q.i}`;
  const dir = q.i % 2 === 0 ? (q.sign < 0 ? "←" : "→") : (q.sign < 0 ? "↑" : "↓");
  return `${stick} ${dir}`;
}
export function keyName(code) {
  if (!code) return "—";
  const m = /^Key([A-Z])$/.exec(code) || /^Digit(\d)$/.exec(code);
  if (m) return m[1];
  return { ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Space: "Espaço", Backspace: "Backspace", Enter: "Enter",
    ShiftLeft: "Shift esq.", ShiftRight: "Shift dir.", ControlLeft: "Ctrl esq.", ControlRight: "Ctrl dir.", AltLeft: "Alt",
    Semicolon: "Ç / ;", Comma: ",", Period: ".", Slash: "/", Quote: "'", BracketLeft: "[", BracketRight: "]", Tab: "Tab" }[code] || code.replace(/^Numpad/, "Num ");
}

// ---------------------------------------------------------------- jogadores
// slots [P1, P2] a partir da ordem de conexão dos controles; "kb" = teclado/toque
export function slotsFor(order, players = load().players, swapped = false) {
  let s;
  if (order.length >= 2) s = [order[0], order[1]];
  else if (order.length === 1) s = players === "teclado-p1" ? ["kb", order[0]] : [order[0], "kb"];
  else return ["kb", null];
  return swapped ? [s[1], s[0]] : s;
}
