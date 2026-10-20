// Ficha do jogo: print, nome, etiquetas, descrição e os botões Jogar, Favoritar e ⬇ ROM. No celular é um painel que
// sobe de baixo; no PC, um painel no meio. Fica aberta durante o jogo: ao voltar, o foco volta para "Jogar".
import { el } from "./views.js";
import * as P from "./prefs.js";
import { downloadRom } from "./download.js";

// ctx: { lib, media, io, launch(game) -> Promise<código>, onClose(game) }
export function openSheet(ctx, g, { play = false } = {}) {
  const old = document.getElementById("sheet");
  if (old) { ctx.media.release(old); old.remove(); }
  const sys = ctx.lib.system(g.s);
  const playable = !!(sys && sys.playable);
  const msg = el("p", { class: "msg", role: "status" });
  const playBtn = el("button", { type: "button", class: "play", "data-nav": true, disabled: !playable, text: "▶ Jogar" });
  const favBtn = el("button", { type: "button", class: "fav", "data-nav": true, "aria-pressed": String(P.isFav(g.rom)) });
  const favText = () => { const on = P.isFav(g.rom); favBtn.textContent = on ? "★ Favorito" : "☆ Favoritar"; favBtn.setAttribute("aria-pressed", String(on)); };
  favText();
  favBtn.addEventListener("click", () => { P.toggleFav(g.rom); favText(); });
  const romBtn = el("button", { type: "button", class: "rom", "data-nav": true, text: "⬇ ROM" });
  let abort = null;
  romBtn.addEventListener("click", async () => {
    if (abort) { abort.abort(); return; }
    abort = new AbortController(); romBtn.textContent = "Cancelar";
    try {
      const how = await downloadRom(ctx.io, g, (got, total) => { msg.textContent = `Baixando ${Math.round(got / 1e6)} / ${Math.round(total / 1e6)} MB…`; }, abort.signal);
      msg.textContent = how === "arquivo" ? "Salvo." : "Download iniciado.";
    } catch (e) { msg.textContent = e.name === "AbortError" ? "Download cancelado." : `Não deu para baixar: ${e.message}`; }
    finally { abort = null; romBtn.textContent = "⬇ ROM"; }
  });
  playBtn.addEventListener("click", async () => {
    if (playBtn.disabled) return;
    playBtn.disabled = true; playBtn.textContent = "preparando…"; msg.textContent = "";
    const code = await ctx.launch(g);
    playBtn.disabled = false; playBtn.textContent = "▶ Jogar";
    if (code !== 0 && window.r36s.lastGame && window.r36s.lastGame.why && !/cancelado|voltou/.test(window.r36s.lastGame.why)) msg.textContent = `O jogo fechou: ${window.r36s.lastGame.why}`;
    playBtn.focus();
  });
  const tags = [sys ? sys.name : g.s, g.year, g.players && `${g.players} jogador${g.players === "1" ? "" : "es"}`, g.genre].filter(Boolean);
  const app = document.getElementById("app");
  const close = () => {
    if (abort) abort.abort();   // download da ROM em andamento: cancela
    ctx.media.release(box); box.remove(); removeEventListener("popstate", onPop);
    app.inert = false; ctx.onClose(g);
  };
  const onPop = () => {
    if (document.getElementById("sheet") !== box) return;
    // Voltar do Android com o jogo aberto: a ficha fica (o jogo sai pelo Select+Start); repõe a entrada do histórico
    if (window.r36s.game) return history.pushState({ sheet: true }, "");
    close();
  };
  const box = el("div", { id: "sheet", role: "dialog", "aria-modal": "true", "aria-label": g.name, onclick: e => { if (e.target === box) history.back(); } },
    el("div", { class: "panel" },
      el("button", { type: "button", class: "x", "data-nav": true, "aria-label": "Fechar", text: "✕", onclick: () => history.back() }),
      el("div", { class: "shot" }, ctx.media.img(g.shot || g.box)),
      el("h2", { text: g.name }),
      el("div", { class: "tags" }, ...tags.map(t => el("span", { text: String(t) }))),
      g.desc ? el("p", { class: "desc", text: g.desc }) : null,
      playable ? null : el("p", { class: "note", text: sys && sys.semAcesso ? `${sys.note}.` : `Sem emulador no navegador${sys && sys.note ? `: ${sys.note}` : ""}.` }),
      el("div", { class: "btns" }, playable ? playBtn : null, favBtn, romBtn),
      msg));
  history.pushState({ sheet: true }, "");
  addEventListener("popstate", onPop);
  document.body.append(box);
  app.inert = true;   // leitor de tela e Tab só na ficha
  (playable ? playBtn : favBtn).focus();
  if (play && playable) playBtn.click();
  return box;
}
