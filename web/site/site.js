// SPA do site: home -> login Google -> biblioteca (do backend, com chaves; ou tela sem acesso) -> seletor de jogos em tela cheia.
// O seletor roda num iframe (../index.html?backend=drive|demo) e pega daqui, por window.r36sSite (mesma origem), a camada
// do Drive (../drive.js, com o token em memória) e a biblioteca (índice + chaves, só em memória). Sair do seletor = remover o iframe.
import cfg from "./config.js";
import { createAuth } from "./auth.js";
import { createDrive } from "../drive.js";
import { biblioteca, pedirAcesso } from "./acesso.js";

const $ = s => document.querySelector(s);
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

// ponte para o seletor (iframe): mesma origem
window.r36sSite = {
  get drive() { return auth.signedIn ? drive : null; },
  get library() { return app.library; },
  // token para a aba isolada do PSP (web/app/launch.js responde a ela pelo BroadcastChannel; nunca vai para URL/storage)
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
  if (r !== "jogar" && r !== "demo") unmountApp();
  if (r === "entrar") return show("entrar");
  if (r === "biblioteca") {
    if (!auth.signedIn) return void (location.hash = "#/entrar");
    show("biblioteca"); return loadLibraries();
  }
  if (r === "jogar") {
    if (!auth.signedIn) return void (location.hash = "#/entrar");
    if (!app.library) return void (location.hash = "#/biblioteca");
    show("jogar"); return mountApp("drive");
  }
  if (r === "demo") { app.library = null; show("jogar"); return mountApp("demo"); }
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
  auth.signOut(); app.libraries = null; app.semAcesso = undefined; app.library = null; app.user = null;
  location.hash = "#/";
});

// ---------------------------------------------------------------- biblioteca
// A biblioteca vem do backend (função r36s: índice + chaves de quem foi aprovado), não de pastas do Drive.
const fmt = n => Number(n || 0).toLocaleString("pt-BR");
const ownerName = lib => {
  const o = lib.owner || {};
  const first = (o.displayName || o.emailAddress || "").split(/[\s@]/)[0];
  return first ? `Biblioteca de ${first}` : "Biblioteca compartilhada";
};
const libMeta = lib => {
  const i = (lib.index && lib.index.info) || {};
  return `${fmt(i.systems)} sistemas · ${fmt(i.games)} jogos · seus saves ficam no seu Drive`;
};

// busca a biblioteca no backend; 403 = sem acesso (app.semAcesso guarda o pedido: null = nunca pediu)
async function fetchLibrary() {
  const go = force => auth.getToken(force).then(token => biblioteca({ funcoes: cfg.funcoes, token }));
  try { return await go(false); }
  catch (e) { if (e.status !== 401) throw e; return go(true); }   // login vencido: renova (pode pedir um toque) e tenta de novo
}

async function loadLibraries(force) {
  const box = $("#lib");
  if (!app.user) drive.user().then(u => { app.user = u; $("#user-name").textContent = u.displayName || u.emailAddress || "você"; auth.setHint(u.emailAddress); }).catch(() => {});
  else $("#user-name").textContent = app.user.displayName || app.user.emailAddress;
  if (!app.libraries || force) {
    app.state = "loading";
    put(box, h("p", { class: "loading", text: "ABRINDO A BIBLIOTECA…" }));
    try { app.libraries = [await fetchLibrary()]; app.semAcesso = undefined; app.error = null; }
    catch (e) {
      if (e.status === 403) { app.libraries = []; app.semAcesso = e.pedido; app.error = null; }
      else {
        app.state = "error"; app.error = e.message;
        return put(box, h("h1", { text: "Servidor de chaves indisponível" }), h("p", { class: "err", text: e.message }),
          h("button", { type: "button", class: "ghost switch", text: "Tentar de novo", onclick: () => loadLibraries(true) }));
      }
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
  const lib = app.libraries[0];
  if (!lib) return renderSemAcesso(box);
  app.state = lib.kind;
  const card = h("div", { class: `lib-card ${lib.kind}` },
    h("img", { src: "img/biblioteca.png", alt: "" }),
    h("div", { class: "info" },
      h("span", { class: "kind", text: "COMPARTILHADA COM VOCÊ" }),
      h("span", { class: "lib-title", text: ownerName(lib) }),
      h("span", { class: "lib-meta", text: libMeta(lib) })),
    h("button", { type: "button", class: "play-btn", text: "Jogar", disabled: !lib.index, onclick: () => play(lib) }));
  put(box, h("h1", { text: "Biblioteca encontrada" }), card);
}

// conta sem acesso: pedir (formulário), aguardando (pendente) ou recusado; sempre dá para tentar de novo ou ver o demo
function renderSemAcesso(box) {
  const pedido = app.semAcesso;   // null = nunca pediu
  app.state = pedido ? `sem-acesso-${pedido.status}` : "sem-acesso";
  const msg = h("p", { class: "hint", role: "status" });
  const retry = h("button", { type: "button", class: "ghost switch", text: "Tentar de novo", onclick: () => loadLibraries(true) });
  const demo = h("a", { class: "switch", href: "#/demo", text: "Ver o modo demonstração" });
  let corpo;
  if (!pedido) {
    const nome = h("input", { type: "text", id: "pedido-nome", name: "nome", required: true, maxlength: 80, autocomplete: "name" });
    const mensagem = h("textarea", { id: "pedido-msg", name: "mensagem", rows: 3, maxlength: 500 });
    const enviar = h("button", { type: "submit", class: "solid", text: "Pedir acesso" });
    corpo = h("form", { class: "pedido", onsubmit: async e => {
      e.preventDefault();
      if (!nome.value.trim()) { msg.textContent = "Diga seu nome."; return; }
      enviar.disabled = true; msg.textContent = "";
      try {
        await pedirAcesso({ funcoes: cfg.funcoes, token: await auth.getToken(false), nome: nome.value.trim(), mensagem: mensagem.value.trim() });
        app.semAcesso = { status: "pendente" };
        app.state = "sem-acesso-enviado";
        msg.textContent = "Pedido enviado. Assim que o André aprovar, é só entrar de novo.";
        corpo.replaceChildren(msg);
      } catch (x) { msg.textContent = `Não deu para enviar o pedido: ${x.message}`; enviar.disabled = false; }
    } },
      h("p", { class: "hint", text: "Esta biblioteca é privada. Conte quem você é e o André recebe o pedido para aprovar." }),
      h("label", { for: "pedido-nome", text: "Seu nome" }), nome,
      h("label", { for: "pedido-msg", text: "Mensagem (opcional)" }), mensagem,
      enviar, msg);
  } else {
    corpo = h("p", { class: "hint", role: "status",
      text: pedido.status === "recusado" ? "O pedido não foi aprovado." : "Seu pedido está aguardando aprovação." });
  }
  put(box, h("h1", { text: "Sem acesso à biblioteca" }), corpo, retry, demo);
}

// ---------------------------------------------------------------- seletor em tela cheia
let appFrame = null;
function mountApp(backend) {
  if (appFrame && appFrame.dataset.backend === backend) return;
  unmountApp();
  appFrame = h("iframe", { src: `../index.html?backend=${backend}`, title: "R36S", allow: "autoplay; fullscreen; gamepad" });
  appFrame.dataset.backend = backend;
  appFrame.addEventListener("load", () => appFrame && appFrame.contentWindow.focus());
  $("#jogar").replaceChildren(appFrame);
}
function unmountApp() {
  if (!appFrame) return;
  appFrame.remove(); appFrame = null;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

route();
