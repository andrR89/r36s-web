// Abre o jogo escolhido no seletor: o RetroArch roda em retroarch/play.html num iframe por cima do seletor e avisa a
// volta com postMessage({type:"r36s-exit"}). Núcleo: data/cores.json (data/mkcores.py) diz qual núcleo web roda cada
// sistema (pasta /roms/<sistema>/); sistema sem núcleo web: aviso por 3 s (código 1). Núcleos com threads (PSP) no site
// sem crossOriginIsolated: aba própria (isolatedGame). Sem WebGL: explica em vez de abrir uma tela preta.
// launch({system, core, rom}) -> Promise<código de saída>; window.r36s.game = jogo aberto (controls.js e testes leem).
// site: parent.r36sSite (token do Drive para a aba isolada) ou null; focusBack(): devolve o foco ao seletor.
export async function createLauncher({ io, site, focusBack }) {
  const r36s = window.r36s;
  r36s.game = null;
  let cores = { systems: {} };
  try { cores = await fetch(new URL("../data/cores.json", import.meta.url)).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }); }
  catch (e) { console.warn("[r36s] data/cores.json indisponível", e); }
  r36s.cores = cores;
  // contexto descartado na hora: o Chrome limita quantos ficam vivos
  const webgl = () => { const c = document.createElement("canvas").getContext("webgl"); const l = c && c.getExtension("WEBGL_lose_context"); if (l) l.loseContext(); return !!c; };

  return async ({ system, core, rom }) => {
    console.log("[r36s] lançando", system, core, rom);
    const sys = cores.systems[system];
    if (!sys || !sys.core) {
      const name = sys ? sys.fullname || system : system || "este sistema";
      notice("Sistema sem emulador no navegador", sys && sys.note ? `${name}: ${sys.note}` : name);
      r36s.lastGame = { system, core, rom, code: 1, why: "sem núcleo web", started: false };
      return 1;
    }
    if (!webgl()) {
      notice("O navegador não liberou o 3D (WebGL)", "Feche o navegador por completo e abra de novo. No Chrome: chrome://gpu deve mostrar WebGL \"Hardware accelerated\".", 8000);
      r36s.lastGame = { system, core, rom, code: 1, why: "sem WebGL", started: false };
      return 1;
    }
    if (!core || !sys.cores.includes(core)) { if (core) console.log(`[r36s] núcleo ${core} não existe na web: usando ${sys.core}`); core = sys.core; }
    try { await io.loadIndex(); } catch (e) {   // o player acha a ROM, a BIOS e as irmãs pelo manifest
      notice("Não deu para ler o índice da biblioteca", e.message, 6000);
      r36s.lastGame = { system, core, rom, code: 1, why: "sem índice", started: false };
      return 1;
    }
    // núcleo com pthreads e esta página sem crossOriginIsolated (site: sem COEP por causa do login do Google): aba própria
    if (sys.threads && !self.crossOriginIsolated) return isolatedGame(r36s, site, focusBack, { system, core, rom });
    return iframeGame(r36s, focusBack, { system, core, rom });
  };
}

// jogo no iframe por cima do seletor; resolve com o código de saída
function iframeGame(r36s, focusBack, { system, core, rom }) {
  return new Promise(resolve => {
    const f = document.createElement("iframe");
    f.id = "game";
    f.title = "jogo";
    f.allow = "autoplay; fullscreen; gamepad";   // autoplay: o áudio do jogo herda a tecla que lançou
    f.src = new URL("../retroarch/play.html?" + new URLSearchParams({ system, core, rom }), import.meta.url).href;
    let done = false;
    const game = { iframe: f, system, core, rom, started: false, t0: performance.now() };
    const finish = (code, why) => {
      if (done) return;
      done = true;
      removeEventListener("message", onMsg);
      console.log("[r36s] jogo terminou", code, why || "");
      f.remove();
      r36s.game = null;
      r36s.lastGame = { ...game, iframe: undefined, code, why };
      focusBack();
      resolve(code);
    };
    // sair antes de o jogo começar (ainda baixando): o RetroArch nem escuta a tecla de sair
    game.abort = why => finish(1, why || "cancelado no carregamento");
    const onMsg = e => {
      if (e.source !== f.contentWindow || e.origin !== location.origin || !e.data) return;
      if (e.data.type === "r36s-started") game.started = true;
      if (e.data.type === "r36s-exit") finish(e.data.code | 0, e.data.saved === false ? "save não subiu" : "");
    };
    addEventListener("message", onMsg);
    f.addEventListener("load", () => {
      // página do player não carregou (404, erro de rede): volta para a lista
      let ok = false;
      try { ok = !!f.contentWindow.r36sPlay; } catch (e) {}
      if (!ok) return finish(1, "player não carregou");
      f.contentWindow.focus();
    });
    document.body.append(f);
    r36s.game = game;
    f.focus();
  });
}

// Jogo numa aba isolada (retroarch/isolated.html, servida com COOP same-origin + COEP: threads/SharedArrayBuffer).
// O COOP corta o window.opener: a conversa é pelo BroadcastChannel (protocolo em retroarch/isolated.js). Esta página
// responde com o backend, a biblioteca, o índice (manifesto + eager.bin já baixados) e o token do Drive (pedido ao site,
// site.token: só em memória); a aba avisa início/fim e manda "alive". Enquanto isso o seletor espera, com aviso.
const CHANNEL = "r36s-isolated";   // o mesmo em retroarch/isolated.js
const ALIVE_MS = 150000;   // aba em segundo plano tem timers estrangulados (até 1/min): folga grande
function isolatedGame(r36s, site, focusBack, { system, core, rom }) {
  return new Promise(resolve => {
    const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const url = new URL("../retroarch/isolated.html?" + new URLSearchParams({ session: id, system, core, rom }), import.meta.url).href;
    const ch = new BroadcastChannel(CHANNEL);
    const game = { isolated: true, session: id, system, core, rom, started: false, opened: false, hello: false, t0: performance.now() };
    let done = false, seen = performance.now(), timer = 0;
    const box = isolatedNotice();
    const finish = (code, why) => {
      if (done) return;
      done = true;
      clearInterval(timer);
      ch.postMessage({ id, type: "close" });   // se a aba ainda estiver aberta (Voltar, tempo esgotado), ela sai e fecha
      ch.close();
      box.remove();
      console.log("[r36s] jogo (aba isolada) terminou", code, why || "");
      r36s.game = null;
      r36s.lastGame = { ...game, code, why };
      focusBack();
      resolve(code);
    };
    const token = force => site && site.token ? site.token(force).catch(() => "") : Promise.resolve("");
    ch.onmessage = async e => {
      const d = e.data;
      if (!d || d.id !== id || done) return;
      seen = performance.now();
      const reply = extra => ch.postMessage({ id, type: "reply", rid: d.rid, ...extra });
      if (d.type === "hello") {
        game.hello = true;
        const io = r36s.io, drive = site && site.drive;
        reply({ backend: r36s.backend, signedIn: !!drive, api: drive ? drive.api : null, library: site ? site.library : null,
          manifest: io ? io.manifest : null, eager: io ? io.eager : null,
          token: drive ? await token(false) : "", slots: window.r36sPads ? window.r36sPads.slots() : null });
      } else if (d.type === "token") reply({ token: await token(!!d.force) });
      else if (d.type === "gone") finish(1, "aba do jogo fechada");
      else if (d.type === "play" && d.data) {
        if (d.data.type === "r36s-started") { game.started = true; box.started(); }
        if (d.data.type === "r36s-exit") finish(d.data.code | 0, d.data.saved === false ? "save não subiu" : "");
      }
    };
    const open = () => {
      const w = window.open(url, "_blank");   // tecla/clique que lançou o jogo = ativação do usuário
      if (!w) return false;
      game.opened = true; game.t0 = seen = performance.now();
      box.waiting();
      return true;
    };
    box.onOpen = () => open();
    box.onBack = () => finish(1, "voltou pela aba do seletor");
    if (!open()) box.blocked();   // popup bloqueado (controle físico não conta como ativação): botão para abrir
    timer = setInterval(() => {
      const now = performance.now();
      if (game.opened && !game.hello && now - game.t0 > 30000) finish(1, "aba do jogo não respondeu");
      else if (game.hello && now - seen > ALIVE_MS) finish(1, "aba do jogo parou de responder");
    }, 2000);
    r36s.game = game;
  });
}

// aviso fixo enquanto o jogo roda na outra aba (com botões: abrir de novo se o popup foi bloqueado, voltar à lista)
function isolatedNotice() {
  document.getElementById("isolated")?.remove();
  const d = document.createElement("div");
  d.id = "isolated"; d.setAttribute("role", "status");
  const title = document.createElement("b"); title.textContent = "PSP abre numa aba própria";
  const sub = document.createElement("small");
  const btns = document.createElement("div");
  const mk = (text, on) => { const b = document.createElement("button"); b.type = "button"; b.textContent = text; b.addEventListener("click", on); return b; };
  const openBtn = mk("Abrir o jogo", () => d.onOpen && d.onOpen());
  const backBtn = mk("Voltar para a lista", () => d.onBack && d.onBack());
  btns.append(backBtn);
  d.append(title, sub, btns);
  document.body.append(d);
  d.waiting = () => { sub.textContent = "Carregando o jogo na outra aba… Para voltar: Select+Start (Backspace+Enter) no jogo, ou feche a aba."; openBtn.remove(); };
  d.started = () => { sub.textContent = "O jogo está rodando na outra aba. Select+Start (Backspace+Enter) lá volta para cá."; };
  d.blocked = () => { sub.textContent = "O navegador bloqueou a aba nova. Clique para abrir o jogo."; btns.prepend(openBtn); openBtn.focus(); };
  return d;
}

// aviso HTML por cima do seletor: some sozinho
export function notice(text, sub, ms = 3000) {
  document.getElementById("notice")?.remove();
  const d = document.createElement("div");
  d.id = "notice"; d.setAttribute("role", "alert");
  d.append(text);
  if (sub) { const s = document.createElement("small"); s.textContent = sub; d.append(s); }
  document.body.append(d);
  setTimeout(() => d.remove(), ms);
}
