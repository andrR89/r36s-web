// Ponte ES -> RetroArch: o C++ (es-core/src/platform.cpp, runSystemCommand sob _WEB_) faz
// `await Module.webLaunch({system, core, rom})` e fica suspenso até a promise resolver com o código de saída.
// O jogo roda em retroarch/play.html num iframe por cima do canvas do ES; ele avisa com postMessage({type:"r36s-exit"}).
export function installBridge(Module, canvas) {
  const r36s = window.r36s;
  r36s.game = null;

  Module.webLaunch = ({ system, core, rom }) => new Promise(resolve => {
    console.log("[r36s] lançando", system, core, rom);
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

// Foco no ES: o SDL escuta o teclado no #canvas. Ao carregar, ao clicar em qualquer lugar e ao voltar para a aba,
// o canvas recebe o foco; uma tecla apertada com o foco fora dele é repassada (senão a primeira tecla se perde).
export function keepFocus(canvas) {
  const active = () => !window.r36s.game;
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
