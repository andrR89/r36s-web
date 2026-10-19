// Navegação do seletor por controle, teclado e direcional de toque. O controle chega aqui como as teclas do layout do
// R36S (web/controls.js: WASD, L = A, K = B, Enter = Start, Backspace = Select), como eventos sintéticos; o teclado
// também vale com setas, Enter e Esc. Foco espacial: a seta vai para o [data-nav] visível mais perto naquela direção.
const DIR = { w: "up", ArrowUp: "up", s: "down", ArrowDown: "down", a: "left", ArrowLeft: "left", d: "right", ArrowRight: "right" };

function visible(e) { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.closest("[hidden]"); }
function scope() { return document.getElementById("sheet") || document.querySelector("#menu-pop:not([hidden])") || document; }

// área do elemento: setas verticais não trocam de área (da grade para a barra lateral, por exemplo) se houver para onde
// ir na mesma; nas horizontais só se troca entre a barra lateral e o centro, e só quando a área acabou naquele lado
const AREA = "#side, #view, .top, #sheet, #menu-pop";
const area = e => e.closest(AREA);

export function move(dir) {
  const cur = document.activeElement;
  const items = [...scope().querySelectorAll("[data-nav]")].filter(e => !e.disabled && visible(e));
  if (!items.length) return;
  if (!items.includes(cur)) return items[0].focus();
  const a = cur.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  const horiz = dir === "left" || dir === "right";
  const ahead = [];
  for (const e of items) {
    if (e === cur) continue;
    const b = e.getBoundingClientRect(), dx = b.left + b.width / 2 - ax, dy = b.top + b.height / 2 - ay;
    if (dir === "right" ? dx > 4 : dir === "left" ? dx < -4 : dir === "down" ? dy > 4 : dy < -4) ahead.push({ e, b, dx, dy });
  }
  const home = area(cur), same = ahead.filter(c => area(c.e) === home);
  let pool = same;
  if (!pool.length) {
    const to = horiz && home && (home.id === "view" && dir === "left" ? "side" : home.id === "side" && dir === "right" ? "view" : null);
    pool = horiz ? ahead.filter(c => to && area(c.e)?.id === to) : ahead;
  }
  let best = null;
  if (!horiz) {
    // vertical: primeiro quem está logo abaixo/acima (faixa horizontal sobreposta), capa/botão antes de "ver todos";
    // o mais perto na vertical, depois na horizontal
    const over = pool.filter(c => c.b.left < a.right - 1 && c.b.right > a.left + 1);
    const plain = over.filter(c => !c.e.matches(".more"));
    const set = plain.length ? plain : over;
    for (const c of set) if (!best || Math.abs(c.dy) < Math.abs(best.dy) - 1 || (Math.abs(c.dy) <= Math.abs(best.dy) + 1 && Math.abs(c.dx) < Math.abs(best.dx))) best = c;
    if (!best) {   // ninguém na mesma faixa: o mais perto, com o desvio lateral pesando 3x
      let bestD = Infinity;
      for (const c of pool) { const d = Math.abs(c.dy) + Math.abs(c.dx) * 3; if (d < bestD) { bestD = d; best = c; } }
    }
  } else {
    let bestD = Infinity;
    for (const { e, b, dx, dy } of pool) {
      // o desvio vertical conta pela folga entre as caixas (0 se se sobrepõem): a próxima capa da fileira ganha do
      // "ver todos" acima dela
      const gap = Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom));
      const d = Math.abs(dx) + gap * 3 + Math.abs(dy);
      if (d < bestD) { bestD = d; best = { e }; }
    }
  }
  if (!best) return;
  best.e.focus({ preventScroll: true });
  best.e.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
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
