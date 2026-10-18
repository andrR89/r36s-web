// SPA do site: home -> login Google -> biblioteca (própria / compartilhada / as duas / nenhuma) -> ES em tela cheia.
// O ES roda num iframe (../index.html?backend=drive|demo) e pega daqui, por window.r36sSite (mesma origem), a camada
// do Drive (../drive.js, com o token em memória) e a biblioteca escolhida. Sair do ES = remover o iframe.
import cfg from "./config.js";
import { createAuth } from "./auth.js";
import { createDrive } from "../drive.js";

const $ = s => document.querySelector(s);
const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} } };
const REMEMBER = "r36s-library";
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v; else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids) if (c != null) e.append(c);
  return e;
};

const put = (box, ...kids) => box.replaceChildren(...kids.filter(k => k != null));   // replaceChildren(null) escreveria "null"

// o login vence em 1 h e renovar abre um popup do Google, que só sai com um toque: aviso por cima de tudo (até do jogo)
function askGesture(renew) {
  return new Promise(resolve => {
    const err = h("p", { class: "renew-err", role: "alert" });
    const btn = h("button", { type: "button", class: "gbtn", text: "Continuar com o Google", onclick: async () => {
      btn.disabled = true; err.textContent = "";
      try { const t = await renew(); box.remove(); resolve(t); }
      catch (e) { err.textContent = `Não deu: ${e.message}. Toque de novo.`; btn.disabled = false; }
    } });
    const box = h("div", { id: "renew", role: "dialog", "aria-modal": "true", "aria-labelledby": "renew-t" },
      h("div", { class: "renew-box" }, h("h2", { id: "renew-t", class: "pixel", text: "Login vencido" }),
        h("p", { text: "O acesso ao Google Drive dura 1 hora. Toque para renovar e o jogo continua de onde parou." }), btn, err));
    document.body.append(box);
    btn.focus();
  });
}
const auth = createAuth({ ...cfg, askGesture });
const drive = createDrive({ api: cfg.api, getToken: f => auth.getToken(f), peekToken: () => auth.peekToken() });
const app = { state: "home", libraries: null, library: null, user: null, error: null };
window.r36sApp = app;   // inspeção nos testes
app.askGesture = askGesture;

// ponte para o ES (iframe): mesma origem
window.r36sSite = {
  get drive() { return auth.signedIn ? drive : null; },
  get library() { return app.library; },
  // token para a aba isolada do PSP (web/bridge.js responde a ela pelo BroadcastChannel; nunca vai para URL/storage)
  token(force) { return auth.signedIn ? auth.getToken(force) : Promise.resolve(""); },
  exit() { location.hash = app.library ? "#/biblioteca" : "#/"; },
};

// ---------------------------------------------------------------- rotas
const screens = [...document.querySelectorAll("[data-screen]")];
function show(name) {
  for (const s of screens) s.hidden = s.dataset.screen !== name;
  app.state = name === "biblioteca" ? app.state : name;
  document.title = { home: "R36S Web", entrar: "R36S Web — entrar", biblioteca: "R36S Web — biblioteca", jogar: "R36S Web — jogando" }[name] || "R36S Web";
}
function route() {
  const r = location.hash.startsWith("#/") ? location.hash.slice(2) : "";
  if (r !== "jogar" && r !== "demo") unmountES();
  if (r === "entrar") return show("entrar");
  if (r === "biblioteca") {
    if (!auth.signedIn) return void (location.hash = "#/entrar");
    show("biblioteca"); return loadLibraries();
  }
  if (r === "jogar") {
    if (!auth.signedIn) return void (location.hash = "#/entrar");
    if (!app.library) return void (location.hash = "#/biblioteca");
    show("jogar"); return mountES("drive");
  }
  if (r === "demo") { app.library = null; show("jogar"); return mountES("demo"); }
  show("home");
  if (location.hash && !location.hash.startsWith("#/")) document.getElementById(location.hash.slice(1))?.scrollIntoView();
}
addEventListener("hashchange", route);

// ---------------------------------------------------------------- login
$("#google-btn").addEventListener("click", async () => {
  const btn = $("#google-btn"), err = $("#login-err");
  btn.disabled = true; err.textContent = "";
  try {
    await auth.signIn();
    location.hash = "#/biblioteca";
  } catch (e) {
    err.textContent = `Não deu para entrar: ${e.message}`;
  } finally { btn.disabled = false; }
});
$("#sign-out").addEventListener("click", () => {
  auth.signOut(); app.libraries = null; app.library = null; app.user = null;
  location.hash = "#/";
});

// ---------------------------------------------------------------- biblioteca
const fmt = n => Number(n || 0).toLocaleString("pt-BR");
const ownerName = lib => {
  const o = lib.owner || {};
  const first = (o.displayName || o.emailAddress || "").split(/[\s@]/)[0];
  return first ? `Biblioteca de ${first}` : "Biblioteca compartilhada";
};
const libTitle = lib => (lib.kind === "own" ? "Minha pasta R36S" : ownerName(lib));
const libMeta = (lib, withSaves) => {
  if (!lib.index) return "sem índice ainda: falta gerar R36S/.web (docs/deploy.md)";
  const i = lib.index.info || {};
  return `${fmt(i.systems)} sistemas · ${fmt(i.games)} jogos` + (withSaves ? " · seus saves ficam no seu Drive" : "");
};

async function loadLibraries(force) {
  const box = $("#lib");
  if (!app.user) drive.user().then(u => { app.user = u; $("#user-name").textContent = u.displayName || u.emailAddress || "você"; auth.setHint(u.emailAddress); }).catch(() => {});
  else $("#user-name").textContent = app.user.displayName || app.user.emailAddress;
  if (!app.libraries || force) {
    app.state = "loading";
    put(box, h("p", { class: "loading", text: "PROCURANDO A PASTA R36S…" }));
    try { app.libraries = await drive.findLibraries(); app.error = null; }
    catch (e) {
      app.state = "error"; app.error = e.message;
      return put(box, h("h1", { text: "Não deu para ler o Drive" }), h("p", { class: "err", text: e.message }),
        h("button", { type: "button", class: "ghost switch", text: "Tentar de novo", onclick: () => loadLibraries(true) }));
    }
  }
  renderLibraries();
}

function play(lib) {
  app.library = lib;
  if (matchMedia("(pointer: coarse)").matches) document.documentElement.requestFullscreen?.().catch(() => {});
  location.hash = "#/jogar";
}

function renderLibraries() {
  const box = $("#lib");
  const { own, shared } = app.libraries;
  const all = [...shared, ...own];
  const remembered = all.find(l => l.id === store.get(REMEMBER));
  if (!all.length) return renderNone(box);
  if (all.length === 1 || remembered) {
    const lib = remembered || all[0];
    app.state = all.length === 1 ? lib.kind : "both-remembered";
    const card = h("div", { class: `lib-card ${lib.kind}` },
      lib.kind === "shared" ? h("img", { src: "img/biblioteca.png", alt: "" }) : null,
      h("div", { class: "info" },
        h("span", { class: "kind", text: lib.kind === "shared" ? "COMPARTILHADA COM VOCÊ" : "NO SEU DRIVE" }),
        h("span", { class: "lib-title", text: libTitle(lib) }),
        h("span", { class: "lib-meta", text: libMeta(lib, lib.kind === "shared") })),
      h("button", { type: "button", class: "play-btn", text: "Jogar", disabled: !lib.index, onclick: () => play(lib) }));
    put(box, h("h1", { text: "Biblioteca encontrada" }), card,
      !lib.index && lib.kind === "own" ? ownHint() : null,
      remembered && all.length > 1 ? h("button", { type: "button", class: "switch", text: "Trocar de biblioteca",
        onclick: () => { store.set(REMEMBER, null); renderLibraries(); } }) : null);
    return;
  }
  app.state = "both";
  const remember = h("input", { type: "checkbox", id: "remember" });
  const choice = lib => h("button", { type: "button", class: `choice ${lib.kind}`, onclick: () => { if (remember.checked) store.set(REMEMBER, lib.id); if (lib.index) play(lib); else renderLibraries(); } },
    h("span", { class: "kind", text: lib.kind === "shared" ? "COMPARTILHADA" : "SUA" }),
    h("span", { class: "lib-title", text: libTitle(lib) }),
    h("span", { class: "lib-meta", text: libMeta(lib, false) }));
  put(box, h("h1", { text: "Qual biblioteca?" }), h("div", { class: "choose" }, ...all.map(choice)),
    h("label", { class: "remember" }, remember, " Lembrar a escolha neste aparelho"));
}

function ownHint() {
  return h("p", { class: "hint" }, "Suba os jogos para a pasta R36S do seu Drive (uma subpasta por sistema: snes, nes, gba…) e gere o índice ",
    h("code", { text: "R36S/.web" }), " com ", h("code", { text: "data/mkmanifest.py --drive-ids" }), " — passo a passo em docs/deploy.md.");
}

function renderNone(box) {
  app.state = "none";
  const msg = h("p", { class: "hint", role: "status" });
  put(box, h("h1", { text: "Nenhuma biblioteca ainda" }),
    h("div", { class: "none" },
      h("div", {}, h("b", { text: "Testar agora" }), h("p", { text: "Abre o ES com jogos homebrew livres que já vêm no site." }),
        h("button", { type: "button", class: "solid", text: "Modo demonstração", onclick: () => { location.hash = "#/demo"; } })),
      h("div", {}, h("b", { text: "Usar meus jogos" }), h("p", { text: "Crie a pasta R36S no seu Drive com uma subpasta por sistema: snes, nes, gba…" }),
        h("button", { type: "button", class: "ghost", text: "Criar pasta no meu Drive", onclick: async e => {
          e.target.disabled = true;
          try { await drive.createLibrary(); await loadLibraries(true); }
          catch (x) { msg.textContent = `Não deu para criar a pasta: ${x.message}`; e.target.disabled = false; }
        } })),
      h("div", {}, h("b", { text: "Biblioteca da família" }), h("p", { text: "Peça acesso: o dono recebe um e-mail do Google para aprovar." }),
        h("button", { type: "button", class: "ghost", text: "Pedir acesso", onclick: () => {
          if (cfg.requestAccessUrl) open(cfg.requestAccessUrl, "_blank", "noopener");
          else msg.textContent = "O link para pedir acesso ainda não foi configurado. Peça ao dono da biblioteca para compartilhar a pasta R36S com o seu e-mail.";
        } }))),
    msg);
}

// ---------------------------------------------------------------- ES em tela cheia
let esFrame = null;
function mountES(backend) {
  if (esFrame && esFrame.dataset.backend === backend) return;
  unmountES();
  esFrame = h("iframe", { src: `../index.html?backend=${backend}`, title: "EmulationStation", allow: "autoplay; fullscreen; gamepad" });
  esFrame.dataset.backend = backend;
  esFrame.addEventListener("load", () => esFrame && esFrame.contentWindow.focus());
  $("#jogar").replaceChildren(esFrame);
}
function unmountES() {
  if (!esFrame) return;
  esFrame.remove(); esFrame = null;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

route();
