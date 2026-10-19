// Navegação do seletor por controle, teclado e direcional de toque. O controle chega aqui como as teclas do layout do
// R36S (web/controls.js: WASD, L = A, K = B, Enter = Start, Backspace = Select), como eventos sintéticos; o teclado
// também vale com setas, Enter e Esc. Foco espacial: a seta vai para o [data-nav] visível mais perto naquela direção.
const DIR = { w: "up", ArrowUp: "up", s: "down", ArrowDown: "down", a: "left", ArrowLeft: "left", d: "right", ArrowRight: "right" };

function visible(e) { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.closest("[hidden]"); }
function scope() { return document.getElementById("sheet") || document.querySelector("#menu-pop:not([hidden])") || document; }

export function move(dir) {
  const cur = document.activeElement;
  const items = [...scope().querySelectorAll("[data-nav]")].filter(e => !e.disabled && visible(e));
  if (!items.length) return;
  if (!items.includes(cur)) return items[0].focus();
  const a = cur.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  const horiz = dir === "left" || dir === "right";
  let best = null, bestD = Infinity;
  for (const e of items) {
    if (e === cur) continue;
    const b = e.getBoundingClientRect(), dx = b.left + b.width / 2 - ax, dy = b.top + b.height / 2 - ay;
    const ahead = dir === "right" ? dx > 4 : dir === "left" ? dx < -4 : dir === "down" ? dy > 4 : dy < -4;
    if (!ahead) continue;
    // o desvio lateral conta pela folga entre as caixas (0 se se sobrepõem), senão o "ver todos" da fileira de baixo
    // ganha das capas logo abaixo
    const gap = horiz ? Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom))
      : Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right));
    const d = (horiz ? Math.abs(dx) : Math.abs(dy)) + gap * 3 + (horiz ? Math.abs(dy) : Math.abs(dx));
    if (d < bestD) { bestD = d; best = e; }
  }
  if (!best) return;
  best.focus({ preventScroll: true });
  best.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
}

// blocked(): jogo aberto ou painel de comandos (as teclas são deles); back(): o B/Esc
export function installNav({ blocked, back }) {
  addEventListener("keydown", e => {
    if (blocked()) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    // tecla segurada: a repetição não aperta de novo (nem o click nativo do Enter), senão o A segurado abre o jogo
    if (e.repeat && (k === "l" || k === "Enter" || k === " ")) { e.preventDefault(); return; }
    const typing = e.isTrusted && e.target instanceof HTMLInputElement;
    if (typing && (k.length === 1 || k === "Backspace" || k === "ArrowLeft" || k === "ArrowRight")) return;   // texto da busca
    const dir = DIR[k];
    if (dir) { e.preventDefault(); return move(dir); }
    const el = document.activeElement;
    if (k === "l" || (k === "Enter" && !e.isTrusted)) {   // A, ou Start do controle: aperta o que está em foco
      e.preventDefault();
      if (el && el !== document.body && el.click) el.click();
      return;
    }
    if (k === "k" || k === "Escape" || (k === "Backspace" && !typing)) { e.preventDefault(); back(); }
  });
}
