// Aba "Configurar" do painel de Comandos (web/controls.js): jogadores, remapear teclado e controle, joystick de toque,
// analógicos. Tudo salvo no aparelho (web/settings.js) e aplicado na hora. Design:
// docs/superpowers/specs/2026-10-17-configurar-controles-design.md
import * as S from "./settings.js";

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v; else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids) if (c != null) e.append(c);
  return e;
};
const section = (title, ...kids) => el("section", { class: "cfg" }, el("h2", { text: title }), ...kids);
const seg = (name, value, options, onpick) => el("div", { class: "seg", role: "group", "aria-label": name },
  ...options.map(([v, label]) => el("button", { type: "button", class: v === value ? "on" : "", "aria-pressed": String(v === value), text: label,
    onclick: () => onpick(v) })));
const slider = (label, value, min, max, step, fmt, onset) => {
  const out = el("output", { text: fmt(value) });
  const inp = el("input", { type: "range", min, max, step, value, "aria-label": label,
    oninput: e => { out.textContent = fmt(+e.target.value); }, onchange: e => onset(+e.target.value) });
  return el("label", { class: "slider" }, el("span", { text: label }), inp, out);
};

// ctx: { state, pads, nativeGetPads, refresh() }
export function configTab(ctx) {
  const s = S.load();
  const rerender = () => ctx.refresh();
  const set = fn => { S.update(fn); rerender(); };

  // ---- jogadores
  const hasPad = ctx.pads.order.length > 0;
  const players = section("Jogadores",
    seg("Quem é o Jogador 1", s.players, [["auto", "Controle é o P1"], ["teclado-p1", "Teclado/toque é o P1"]], v => set(x => { x.players = v; ctx.pads.swapped = false; ctx.pads.changed(); })),
    el("p", { class: "note", text: hasPad
      ? `Agora: P1 · ${ctx.pads.label(ctx.pads.slots()[0])}${ctx.pads.slots()[1] != null ? ` · P2 · ${ctx.pads.label(ctx.pads.slots()[1])}` : ""}. Start + Select no controle troca.`
      : "Com um controle só, ele vira o Jogador 1 (ou o 2, se escolher teclado/toque como P1). Com dois, a ordem em que conectaram." }));

  // ---- remapear: teclado
  const binding = ctx.state.bindingAction;
  const keyRows = S.ACTIONS.map(a => {
    const code = s.keys[a] || S.CANON_KEYS[a], changed = !!s.keys[a] && s.keys[a] !== S.CANON_KEYS[a];
    const waiting = binding && binding.kind === "key" && binding.action === a;
    return el("button", { type: "button", class: `map${changed ? " changed" : ""}${waiting ? " wait" : ""}`, "data-key-action": a,
      onclick: () => startKey(a) }, el("span", { text: S.LABELS[a] }), el("b", { text: waiting ? "aperte uma tecla…" : S.keyName(code) }));
  });
  function startKey(a) {
    ctx.state.bindingAction = { kind: "key", action: a };
    ctx.state.binding = e => {
      ctx.state.binding = null; ctx.state.bindingAction = null;
      if (e.code === "Escape") return rerender();
      set(x => {
        // a tecla escolhida sai de outra ação que a usava (trocam de lugar)
        const prev = x.keys[a] || S.CANON_KEYS[a];
        for (const b of S.ACTIONS) if (b !== a && (x.keys[b] || S.CANON_KEYS[b]) === e.code) x.keys[b] = prev;
        x.keys[a] = e.code;
        for (const b of S.ACTIONS) if (x.keys[b] === S.CANON_KEYS[b]) delete x.keys[b];
      });
    };
    rerender();
  }

  // ---- remapear: controle
  const padRows = S.ACTIONS.map(a => {
    const src = s.pad[a] || S.CANON_PAD[a], changed = !!s.pad[a] && s.pad[a] !== S.CANON_PAD[a];
    const waiting = binding && binding.kind === "pad" && binding.action === a;
    return el("button", { type: "button", class: `map${changed ? " changed" : ""}${waiting ? " wait" : ""}`, "data-pad-action": a,
      onclick: () => startPad(a) }, el("span", { text: S.LABELS[a] }), el("b", { text: waiting ? "aperte no controle…" : S.sourceName(src) }));
  });
  function startPad(a) {
    ctx.state.bindingAction = { kind: "pad", action: a };
    ctx.state.padBinding = src => {
      ctx.state.padBinding = null; ctx.state.bindingAction = null;
      set(x => {
        const prev = x.pad[a] || S.CANON_PAD[a];
        for (const b of S.ACTIONS) if (b !== a && (x.pad[b] || S.CANON_PAD[b]) === src) x.pad[b] = prev;
        x.pad[a] = src;
        for (const b of S.ACTIONS) if (x.pad[b] === S.CANON_PAD[b]) delete x.pad[b];
      });
    };
    // Esc no teclado cancela
    ctx.state.binding = e => { if (e.code === "Escape") { ctx.state.binding = null; ctx.state.padBinding = null; ctx.state.bindingAction = null; rerender(); } };
    rerender();
  }

  // ---- toque
  const t = s.touch;
  const touch = section("Joystick de toque",
    el("div", { class: "row" }, el("span", { text: "Tamanho" }), seg("Tamanho", t.size, [["p", "P"], ["m", "M"], ["g", "G"]], v => set(x => { x.touch.size = v; }))),
    slider("Transparência", t.opacity, 0.3, 1, 0.05, v => Math.round(v * 100) + "%", v => set(x => { x.touch.opacity = v; })),
    el("div", { class: "row" }, el("span", { text: "Analógicos na tela" }),
      seg("Analógicos na tela", t.sticks, [["auto", "Auto"], ["sempre", "Sempre"], ["nunca", "Nunca"]], v => set(x => { x.touch.sticks = v; }))),
    el("p", { class: "note", text: "Auto: só nos jogos de N64, PSP, Dreamcast e PlayStation. Sempre: em todo jogo." }),
    el("label", { class: "check" }, el("input", { type: "checkbox", checked: t.dpadAsStick, onchange: e => set(x => { x.touch.dpadAsStick = e.target.checked; }) }),
      " Direcional vira o analógico esquerdo (no jogo)"));

  // ---- analógicos
  const an = s.analog;
  const analog = section("Analógicos",
    slider("Zona morta", an.deadzone, 0, 0.5, 0.01, v => Math.round(v * 100) + "%", v => set(x => { x.analog.deadzone = v; })),
    slider("Sensibilidade", an.sensitivity, 0.5, 2, 0.05, v => v.toFixed(2) + "×", v => set(x => { x.analog.sensitivity = v; })),
    el("label", { class: "check" }, el("input", { type: "checkbox", checked: an.touchAnalog, onchange: e => set(x => { x.analog.touchAnalog = e.target.checked; }) }),
      " Analógico de toque de verdade (meio caminho = meia força)"),
    el("p", { class: "note", text: "Zona morta e sensibilidade valem para o próximo jogo que abrir." }));

  return el("div", { class: "tab-config" },
    players,
    section("Teclado", el("p", { class: "note", text: "Toque numa ação e aperte a tecla nova. Esc cancela." }), el("div", { class: "maps" }, ...keyRows)),
    section("Controle", el("p", { class: "note", text: hasPad ? "Toque numa ação e aperte o botão ou mexa o analógico." : "Conecte um controle e aperte um botão para remapear." }),
      el("div", { class: "maps" }, ...padRows)),
    touch, analog,
    el("button", { type: "button", class: "reset", text: "Restaurar o padrão", onclick: () => { ctx.state.binding = null; ctx.state.padBinding = null; ctx.state.bindingAction = null; S.reset(); rerender(); } }));
}
