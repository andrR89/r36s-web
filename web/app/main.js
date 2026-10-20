// Seletor de jogos (substitui o EmulationStation): lê data/library.json.gz pelo io.js (hub, demo ou Drive), desenha as
// telas e abre o jogo com launch.js. Rotas no hash: #/ (Início), #/s/<sistema>[?ordem=ano], #/busca?q=…
import { createIO } from "../io.js";
import { installControls } from "../controls.js";
import { createLibrary } from "./library.js";
import { createMedia } from "./media.js";
import { createLauncher } from "./launch.js";
import { renderHome, renderSystem, renderSearch, renderSide, el } from "./views.js";
import { openSheet } from "./sheet.js";
import { installNav } from "./nav.js";
import * as P from "./prefs.js";

const t0 = performance.now();
const $ = s => document.querySelector(s);
const status = $("#status");
const showFatal = (what, e) => {
  if (window.r36s && window.r36s.error || status.className === "err") return;   // já tem uma explicação na tela
  const msg = String(e && (e.message || e) || e).slice(0, 300);
  status.className = "err";
  status.textContent = `Erro: ${what}. ${msg} — ${navigator.userAgent.replace(/^Mozilla\/5.0 /, "").slice(0, 120)}`;
  if (window.r36s) window.r36s.error = msg;
};
addEventListener("error", e => { if (!(window.r36s && window.r36s.ready)) showFatal("erro ao iniciar", e.error || e.message); });
addEventListener("unhandledrejection", e => { if (!(window.r36s && window.r36s.ready)) showFatal("erro ao iniciar", e.reason); });

const backend = new URLSearchParams(location.search).get("backend") || "hub";
const site = (() => { try { return parent !== window ? parent.r36sSite : null; } catch (e) { return null; } })();
if (backend !== "hub" && !site) { status.textContent = "abra pelo site (site/) para usar o Google Drive"; status.className = "err"; throw new Error("backend " + backend + " sem o site"); }
const io = createIO({ backend, site });
window.r36s = { ready: false, t0, backend, io };
const app = $("#app"), view = $("#view"), side = $("#side"), q = $("#q");
const controls = installControls({ canvas: app, siteMode: !!site, site });

let lib;
try {
  const r = await io.fetchFrom(location.href)("data/library.json.gz");
  if (r.status === 404) throw Object.assign(new Error("biblioteca sem library.json.gz"), { old: true });
  if (!r.ok) throw new Error(`library.json.gz HTTP ${r.status}`);
  // gzip feito pelo gerador (o hub e o Drive podem mandar sem compressão): descompacta aqui; se um servidor já
  // descompactou (Content-Encoding: gzip), os bytes não começam com 1f 8b e vão direto
  const buf = new Uint8Array(await r.arrayBuffer());
  const text = buf[0] === 0x1f && buf[1] === 0x8b
    ? await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).text()
    : new TextDecoder().decode(buf);
  lib = createLibrary(JSON.parse(text));
} catch (e) {
  status.className = "err";
  status.textContent = e.old ? "Esta biblioteca precisa ser atualizada: rode data/mkmanifest.py --drive-ids e build/upload/sobe.sh (docs/deploy.md)." : `Não deu para abrir a biblioteca: ${e.message}`;
  window.r36s.error = e.message;
  throw e;
}
const media = createMedia(io);
const launch = await createLauncher({ io, site, focusBack: () => (document.querySelector("#sheet .play") || app).focus() });
window.r36s.launch = launch;
q.placeholder = `Buscar em ${lib.total.toLocaleString("pt-BR")} jogos`;

const ctx = {
  lib, media, io,
  go: (hash, replace) => { replace ? history.replaceState(null, "", hash) : history.pushState(null, "", hash); route(); },
  openSheet: (g, opts) => openSheet(sheetCtx, g, opts),
  // "Favoritos" da barra lateral: a fileira do Início
  showFav: () => {
    if (current !== "home") ctx.go("#/");
    const r = view.querySelector('[data-row="fav"]');
    if (!r) return;
    r.scrollIntoView({ block: "start" });
    r.querySelector("[data-nav]:not(.more)")?.focus({ preventScroll: true });
  },
};
const sheetCtx = {
  lib, media, io,
  launch: async g => { const code = await launch({ system: g.s, core: "", rom: g.rom }); if (window.r36s.lastGame && window.r36s.lastGame.started) P.played(g.rom); return code; },
  // fecha a ficha: volta o foco para a mesma capa, na mesma fileira (o Início é refeito se recentes/favoritos mudaram)
  onClose: g => {
    const rom = last && last.dataset.rom || g.rom, rowId = last && last.closest("[data-row]")?.dataset.row;
    if (current === "home") refreshHome();
    let back = last && document.contains(last) ? last : null;
    if (!back && rowId === "hero") back = view.querySelector(".hero .play");
    if (!back && rowId) back = view.querySelector(`[data-row="${CSS.escape(rowId)}"] [data-rom="${CSS.escape(rom)}"]`);
    if (!back) back = view.querySelector(`[data-rom="${CSS.escape(rom)}"]`);
    side.replaceChildren(...renderSide(ctx, current));   // "Favoritos" aparece/some
    if (back) { back.focus({ preventScroll: true }); back.scrollIntoView({ block: "nearest", inline: "nearest" }); }
    else app.focus({ preventScroll: true });
  },
};
let current = null, last = null, homePrefs = "";
document.addEventListener("focusin", e => { if (e.target.closest && e.target.closest("#view")) last = e.target; });
// Início refeito só se recentes/favoritos mudaram (senão o foco e as imagens ficam como estão), mantendo a rolagem
function refreshHome() {
  if (JSON.stringify(P.load()) === homePrefs) return;
  const y = scrollY; media.release(view); view.replaceChildren(home()); scrollTo(0, y);
}
const home = () => { homePrefs = JSON.stringify(P.load()); return renderHome(ctx); };

function route() {
  const h = location.hash || "#/";
  const [path, query] = h.slice(1).split("?");
  const params = new URLSearchParams(query || "");
  let node;
  if (path.startsWith("/s/")) { current = decodeURIComponent(path.slice(3)); node = renderSystem(ctx, current, params.get("ordem") === "ano" ? "ano" : "az"); }
  else if (path === "/busca") { current = "busca"; const v = params.get("q") || ""; if (q.value !== v) q.value = v; node = renderSearch(ctx, v); }
  else { current = "home"; node = home(); }
  if (current !== "busca" && q.value && document.activeElement !== q) q.value = "";   // saiu da busca: campo limpo
  media.release(view);   // Drive: as capas da tela anterior soltam os blobs
  view.replaceChildren(node);
  side.replaceChildren(...renderSide(ctx, current));
  if (current !== "busca") scrollTo(0, 0);
}
addEventListener("hashchange", route);
let typing = 0;
q.addEventListener("input", () => {
  clearTimeout(typing);
  typing = setTimeout(() => ctx.go(`#/busca?q=${encodeURIComponent(q.value)}`, location.hash.startsWith("#/busca")), 120);
});
$(".brand").addEventListener("click", () => ctx.go("#/"));

// menu ≡: Comandos (painel de controles), tela cheia, voltar ao site
const menu = el("div", { id: "menu-pop", role: "menu", hidden: true }), menuBtn = $("#menu");
const showMenu = on => { menu.hidden = !on; menuBtn.setAttribute("aria-expanded", String(on)); };
const item = (label, fn) => el("button", { type: "button", role: "menuitem", "data-nav": true, text: label, onclick: () => { showMenu(false); fn(); } });
menu.append(item("Comandos", () => controls.open()),
  item("Tela cheia", () => (document.fullscreenElement ? document.exitFullscreen() : (parent !== window ? parent.document.documentElement : document.documentElement).requestFullscreen()).catch(() => {})),
  ...(site && site.exit ? [item("Voltar ao site", () => site.exit())] : []));
document.body.append(menu);
showMenu(false);
menuBtn.addEventListener("click", () => { showMenu(menu.hidden); if (!menu.hidden) menu.querySelector("button").focus(); });
// toque/clique fora fecha o menu
addEventListener("pointerdown", e => { if (!menu.hidden && !menu.contains(e.target) && !menuBtn.contains(e.target)) showMenu(false); }, true);

installNav({ blocked: () => !!window.r36s.game || !!controls.panel,
  back: () => {
    if (!menu.hidden) { showMenu(false); return menuBtn.focus(); }
    if (document.getElementById("sheet")) return history.back();
    // não usa history.back(): no iframe ele pode voltar a página do site; replace: o Voltar do navegador não reabre a tela
    if (current !== "home") { q.value = ""; return ctx.go("#/", true); }
  } });

route();
status.remove();
(view.querySelector("[data-nav]") || app).focus({ preventScroll: true });
window.r36s.ready = true;
window.r36s.readyMs = Math.round(performance.now() - t0);
setTimeout(() => io.loadIndex().catch(e => console.warn("[r36s] índice do emulador", e)), 1500);   // pronto para o ▶
// recortes de miniaturas de pacotes antigos (o índice mudou) saem do cache; uma vez, depois da primeira tela
setTimeout(() => io.pruneThumbs(lib.systems.map(s => s.capas).filter(Boolean))
  .then(n => { if (n) console.info(`[r36s] ${n} miniaturas antigas saíram do cache`); }, e => console.warn("[r36s] limpeza das miniaturas", e)), 5000);
