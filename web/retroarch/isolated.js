// Aba isolada do player (isolated.html): núcleos com pthreads (cores.json "threads": PSP) lançados pelo site.
// Com COOP same-origin a aba não tem window.opener; tudo que o player pegaria do pai (parent.r36s.io) vem da página do
// ES (web/bridge.js) pelo BroadcastChannel "r36s-isolated", mensagens com o id da sessão (?session=):
//   aba -> ES: hello (pede a configuração), token {force} (renovação), play {data} (r36s-started/r36s-exit do play.js),
//              alive (a cada 2 s), gone (aba fechando sem sair pelo jogo)
//   ES -> aba: reply {rid, ...} (resposta a hello/token), close (o ES pediu para voltar à lista)
// O token do Drive só existe em memória aqui (nem URL nem localStorage); renovação a cada minuto e no 401.
import { createDrive } from "../drive.js";
import { createIO } from "../io.js";

const CHANNEL = "r36s-isolated";   // o mesmo em web/bridge.js
const id = new URLSearchParams(location.search).get("session") || "";
const msg = document.getElementById("msg");
const ch = new BroadcastChannel(CHANNEL);
const send = d => ch.postMessage({ ...d, id });
const waiting = new Map();
let rid = 0, ended = false;
const host = { isolated: true, crossOriginIsolated: self.crossOriginIsolated };
window.r36sIsolated = host;   // inspeção nos testes

function ask(type, extra = {}, ms = 15000) {
  return new Promise((resolve, reject) => {
    const r = ++rid;
    const t = setTimeout(() => { waiting.delete(r); reject(new Error("a aba do site não respondeu")); }, ms);
    waiting.set(r, d => { clearTimeout(t); resolve(d); });
    send({ type, rid: r, ...extra });
  });
}
ch.onmessage = e => {
  const d = e.data;
  if (!d || d.id !== id) return;
  if (d.type === "reply" && waiting.has(d.rid)) { const f = waiting.get(d.rid); waiting.delete(d.rid); f(d); }
  if (d.type === "close") {
    const p = window.r36sPlay;
    if (p && p.quit && !p.finished) p.quit("fechado pela aba do ES"); else end({ type: "r36s-exit", code: 1, saved: true });
  }
};

function fail(text, sub) {
  msg.className = "err"; msg.replaceChildren(text);
  if (sub) { const s = document.createElement("small"); s.textContent = sub; msg.append(s); }
  msg.style.display = "flex";
}

// fim: avisa o ES e fecha a aba (aberta por script: window.close vale); se não fechar, deixa o aviso
function end(data) {
  if (ended) return;
  ended = true;
  send({ type: "play", data });
  setTimeout(() => { window.close(); fail("jogo encerrado", "pode fechar esta aba e voltar para o EmulationStation"); }, 300);
}

// P1/P2 como a página do ES decidiu (web/controls.js): navigator.getGamepads() devolve [P1, P2]
function padOrder(slots) {
  if (!Array.isArray(slots) || !slots.some(s => typeof s === "number") || !navigator.getGamepads) return;
  const own = navigator.getGamepads.bind(navigator);
  navigator.getGamepads = () => {
    const real = own();
    return slots.map((s, i) => {
      const gp = typeof s === "number" ? real[s] : null;
      return gp && { id: gp.id, index: i, connected: gp.connected, mapping: gp.mapping, timestamp: gp.timestamp, buttons: gp.buttons, axes: gp.axes, vibrationActuator: gp.vibrationActuator };
    });
  };
}

async function boot() {
  if (!id) return fail("abra o jogo pelo EmulationStation", "esta aba é aberta pelo site para jogos de PSP");
  if (!self.crossOriginIsolated) console.warn("[isolated] sem crossOriginIsolated: o núcleo com threads não vai iniciar (cabeçalhos COOP/COEP)");
  let cfg;
  try { cfg = await ask("hello"); }
  catch (e) { return fail("não deu para falar com a aba do site", "volte para a aba do EmulationStation e abra o jogo de novo"); }
  setInterval(() => send({ type: "alive" }), 2000);
  addEventListener("pagehide", () => { if (!ended) send({ type: "gone" }); });

  let token = cfg.token || "";
  host.tokenRenewals = 0;
  async function getToken(force) {
    if (token && !force) return token;
    const r = await ask("token", { force: !!force }, 30000);
    host.tokenRenewals++;
    token = r.token || "";
    if (!token) throw Object.assign(new Error("não logado"), { status: 401 });
    return token;
  }
  // o site renova 2 min antes de vencer; pegar o atual a cada minuto mantém o XHR síncrono (peekToken) com token válido
  if (cfg.signedIn) setInterval(() => ask("token", { force: false }, 30000).then(r => { if (r.token) token = r.token; }).catch(() => {}), 60000);
  const drive = cfg.signedIn ? createDrive({ api: cfg.api, getToken, peekToken: () => token }) : null;
  const io = cfg.backend === "hub" ? null
    : createIO({ backend: cfg.backend, site: { drive, library: cfg.library }, preload: { manifest: cfg.manifest, eager: cfg.eager } });
  padOrder(cfg.slots);
  Object.assign(host, {
    io, manifest: cfg.manifest, backend: cfg.backend, getToken,
    post(data) {
      if (data.type === "r36s-exit") end(data);
      else send({ type: "play", data });
    },
  });
  window.r36sHost = host;
  await import("./play.js");
}
boot();
