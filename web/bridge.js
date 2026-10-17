// Ponte ES -> RetroArch: o C++ (es-core/src/platform.cpp, runSystemCommand sob _WEB_) faz
// `await Module.webLaunch({system, core, rom})` e fica suspenso até a promise resolver com o código de saída.
// O jogo roda em retroarch/play.html num iframe por cima do canvas do ES; ele avisa com postMessage({type:"r36s-exit"}).
// Núcleo: data/cores.json (data/mkcores.py) diz qual núcleo web roda cada sistema (pasta /roms/<sistema>/). O núcleo do
// comando do dArkOS vale se for o da web; senão usa o mapeado. Sistema sem núcleo web (ou comando não-libretro sem
// mapeamento): aviso por 3 s por cima do ES, que volta para a lista na hora (código 1).
export async function installBridge(Module, canvas) {
  const r36s = window.r36s;
  r36s.game = null;
  let cores = { systems: {} };
  try { cores = await fetch("data/cores.json").then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }); }
  catch (e) { console.warn("[r36s] data/cores.json indisponível", e); }
  r36s.cores = cores;

  Module.webLaunch = ({ system, core, rom }) => new Promise(resolve => {
    console.log("[r36s] lançando", system, core, rom);
    const sys = cores.systems[system];
    if (!sys || !sys.core) {
      const name = sys ? sys.fullname || system : system || "este sistema";
      notice("Sistema sem emulador no navegador", sys && sys.note ? `${name}: ${sys.note}` : name);
      r36s.lastGame = { system, core, rom, code: 1, why: "sem núcleo web", started: false };
      return resolve(1);
    }
    if (!sys.cores.includes(core)) { if (core) console.log(`[r36s] núcleo ${core} não existe na web: usando ${sys.core}`); core = sys.core; }
    // núcleo com pthreads e esta página sem crossOriginIsolated (site: sem COEP por causa do login do Google): aba própria
    if (sys.threads && !self.crossOriginIsolated) return isolatedGame(r36s, canvas, { system, core, rom }).then(resolve);
    const f = document.createElement("iframe");
    f.id = "game";
    f.title = "jogo";
    f.allow = "autoplay; fullscreen; gamepad";   // autoplay: o áudio do jogo herda a tecla que lançou
    f.src = "retroarch/play.html?" + new URLSearchParams({ system, core, rom });
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
      canvas.focus();
      resolve(code);
    };
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
// parent.r36sSite.token: só em memória); a aba avisa início/fim e manda "alive". Enquanto isso o ES espera, com aviso.
const CHANNEL = "r36s-isolated";   // o mesmo em retroarch/isolated.js
const ALIVE_MS = 150000;   // aba em segundo plano tem timers estrangulados (até 1/min): folga grande
function isolatedGame(r36s, canvas, { system, core, rom }) {
  return new Promise(resolve => {
    const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const url = "retroarch/isolated.html?" + new URLSearchParams({ session: id, system, core, rom });
    const site = (() => { try { return parent !== window ? parent.r36sSite : null; } catch (e) { return null; } })();
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
      canvas.focus();
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
          manifest: (io && io.manifest) || (r36s.fs && r36s.fs.manifest) || null, eager: io ? io.eager : null,
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
    box.onBack = () => finish(1, "voltou pela aba do ES");
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

// aviso HTML por cima do ES (não mexe no ES): some sozinho
export function notice(text, sub, ms = 3000) {
  document.getElementById("notice")?.remove();
  const d = document.createElement("div");
  d.id = "notice"; d.setAttribute("role", "alert");
  d.append(text);
  if (sub) { const s = document.createElement("small"); s.textContent = sub; d.append(s); }
  document.body.append(d);
  setTimeout(() => d.remove(), ms);
}

// Foco no ES: o SDL escuta o teclado no #canvas. Ao carregar, ao clicar em qualquer lugar e ao voltar para a aba,
// o canvas recebe o foco; uma tecla apertada com o foco fora dele é repassada (senão a primeira tecla se perde).
export function keepFocus(canvas) {
  const active = () => !window.r36s.game && !(window.r36s.controls && window.r36s.controls.panel);   // painel de comandos aberto: foco nele
  const focus = () => { if (active() && document.activeElement !== canvas) canvas.focus(); };
  addEventListener("pointerdown", () => setTimeout(focus, 0));
  addEventListener("focus", focus);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) focus(); });
  for (const type of ["keydown", "keyup"]) {
    document.addEventListener(type, e => {
      if (!active() || e.target === canvas || !e.isTrusted) return;
      e.preventDefault();
      canvas.focus();
      canvas.dispatchEvent(new KeyboardEvent(type, {
        key: e.key, code: e.code, location: e.location, repeat: e.repeat, bubbles: true, cancelable: true,
        ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey,
        keyCode: e.keyCode, which: e.which, charCode: e.charCode,
      }));
    }, true);
  }
  focus();
}
