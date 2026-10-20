// Telas do seletor: Início (destaque + prateleiras), Sistema (grade) e Busca (lista); barra lateral no PC.
// Capas das fileiras, da grade e da busca: miniatura WebP (thumb), senão box/shot; destaque e ficha usam a original.
// Cada capa é um botão com data-nav (foco por controle: web/app/nav.js) que abre a ficha.
import * as P from "./prefs.js";

export const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v; else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids) if (c != null) e.append(c);
  return e;
};
const ROW_MAX = 20, SEARCH_MAX = 200;
const fmt = n => Number(n).toLocaleString("pt-BR");

// ctx: { lib, media, openSheet(game), go(hash) }
export function cover(ctx, g) {
  const sys = ctx.lib.system(g.s);
  return el("button", { type: "button", class: `cover${sys && !sys.playable ? " off" : ""}`, "data-nav": true, "data-rom": g.rom,
    "aria-label": `${g.name} (${sys ? sys.name : g.s})`, onclick: () => ctx.openSheet(g) },
    el("span", { class: "art" }, el("span", { class: "ph", text: g.name }), ctx.media.img(g.thumb || g.box || g.shot)),
    el("span", { class: "label", text: g.name }));
}

// id: identifica a fileira (o foco volta para a mesma capa na mesma fileira quando o Início é refeito)
function row(ctx, id, title, games, more) {
  if (!games.length) return null;
  return el("section", { class: "row", "data-row": id, "data-sys": more ? more.id : null },
    el("h2", {}, el("span", { text: title }), more ? el("a", { href: `#/s/${more.id}`, "data-nav": true, class: "more", text: `ver todos ${fmt(more.count)} ›` }) : null),
    el("div", { class: "shelf" }, ...games.map(g => cover(ctx, g))));
}

function hero(ctx, g) {
  const sys = ctx.lib.system(g.s);
  return el("section", { class: "hero", "data-row": "hero" },
    ctx.media.img(g.shot || g.box, "bg"),
    el("div", { class: "txt" },
      el("span", { class: "kicker", text: `Continuar · ${sys ? sys.name : g.s}` }),
      el("b", { text: g.name }),
      el("button", { type: "button", class: "play", "data-nav": true, text: "▶ Jogar", onclick: () => ctx.openSheet(g, { play: true }) })));
}

export function renderHome(ctx) {
  const { lib } = ctx, prefs = P.load();
  const recent = prefs.recent.map(lib.byRom).filter(Boolean), fav = prefs.fav.map(lib.byRom).filter(Boolean);
  return el("div", { class: "home" },
    recent[0] ? hero(ctx, recent[0]) : null,
    row(ctx, "recent", "Recentes", recent.slice(0, ROW_MAX)),
    row(ctx, "fav", "Favoritos", fav.slice(0, ROW_MAX)),
    ...lib.systems.map(s => row(ctx, s.id, s.name, lib.games(s.id).slice(0, ROW_MAX), s)));
}

export function renderSystem(ctx, id, order) {
  const s = ctx.lib.system(id);
  if (!s) return el("p", { class: "empty", text: "Sistema não encontrado." });
  const seg = (v, label) => el("button", { type: "button", "data-nav": true, class: v === order ? "on" : "", "aria-pressed": String(v === order), text: label,
    onclick: () => ctx.go(`#/s/${id}${v === "ano" ? "?ordem=ano" : ""}`, true) });
  return el("div", { class: "system" },
    el("div", { class: "sys-head" }, el("h1", { text: s.name }), el("span", { class: "count", text: `${fmt(s.count)} jogos` }),
      el("div", { class: "seg", role: "group", "aria-label": "Ordem" }, seg("az", "A–Z"), seg("ano", "Ano"))),
    s.playable ? null : el("p", { class: "note", text: `Sem emulador no navegador${s.note ? `: ${s.note}` : ""}.` }),
    el("div", { class: "grid" }, ...ctx.lib.games(id, order).map(g => cover(ctx, g))));
}

export function renderSearch(ctx, q) {
  const all = ctx.lib.search(q, SEARCH_MAX + 1), hits = all.slice(0, SEARCH_MAX);
  const n = all.length > SEARCH_MAX ? `${fmt(SEARCH_MAX)}+` : fmt(hits.length);
  return el("div", { class: "results" },
    el("p", { class: "count", role: "status", text: q.trim() ? `${n} ${hits.length === 1 ? "jogo" : "jogos"}` : "Digite o nome de um jogo" }),
    ...hits.map(g => { const s = ctx.lib.system(g.s);
      return el("button", { type: "button", class: "hit", "data-nav": true, "data-rom": g.rom, onclick: () => ctx.openSheet(g) },
        el("span", { class: "art" }, el("span", { class: "ph", text: "" }), ctx.media.img(g.thumb || g.box || g.shot)),
        el("span", { class: "t" }, el("b", { text: g.name }), el("small", { text: [s ? s.name : g.s, g.year].filter(Boolean).join(" · ") }))); }));
}

export function renderSide(ctx, current) {
  const link = (hash, text, on) => el("a", { href: hash, "data-nav": true, class: on ? "on" : "", text });
  const fav = P.load().fav.some(r => ctx.lib.byRom(r))
    ? el("a", { href: "#/", "data-nav": true, text: "★ Favoritos", onclick: e => { e.preventDefault(); ctx.showFav(); } }) : null;
  return [link("#/", "Início", current === "home"), fav, ...ctx.lib.systems.map(s => link(`#/s/${s.id}`, s.name, current === s.id))].filter(Boolean);
}
