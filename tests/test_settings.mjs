// node tests/test_settings.mjs — funções puras de web/settings.js (sem navegador)
import assert from "node:assert/strict";
const mem = new Map();
globalThis.localStorage = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) };
const S = await import("../web/settings.js");

const pad = (axes = [0, 0, 0, 0], pressed = []) => ({ id: "X", index: 0, connected: true, timestamp: 1, axes,
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })) });
let n = 0; const t = (name, f) => { f(); n++; console.log("ok", name); };

t("padrão: controle sai igual (B baixo = índice 0, A direita = 1)", () => {
  const m = S.mapPad(pad([0.6, 0, 0, -1], [0, 9]), {}, 0.15);
  assert.equal(m.buttons[0].pressed, true); assert.equal(m.buttons[9].pressed, true); assert.equal(m.buttons[1].pressed, false);
  assert.equal(m.axes[0], +((0.6 - 0.15) / 0.85).toFixed(4)); assert.equal(m.axes[3], -1);
});
t("zona morta zera o eixo", () => { assert.equal(S.mapPad(pad([0.1, -0.12, 0, 0]), {}, 0.15).axes.join(), "0,0,0,0"); });
t("remapear: A no botão 0 e B no 1 (troca)", () => {
  const m = S.mapPad(pad([0, 0, 0, 0], [0]), { a: "b:0", b: "b:1" }, 0.15);
  assert.equal(m.buttons[1].pressed, true); assert.equal(m.buttons[0].pressed, false);
});
t("remapear: analógico direito ↑ num botão (LB)", () => {
  const m = S.mapPad(pad([0, 0, 0, 0], [4]), { rsu: "b:4" }, 0.15);
  assert.equal(m.axes[3], -1);
});
t("remapear: botão A num meio-eixo", () => {
  assert.equal(S.mapPad(pad([0, 0, 0.9, 0]), { a: "a:2+" }, 0.15).buttons[1].pressed, true);
});
t("teclado: tecla nova faz a ação e a canônica antiga morre", () => {
  const k = S.keyTable({ a: "Space" });
  assert.equal(k.byCode.get("Space"), "a"); assert.ok(k.dead.has("KeyL")); assert.equal(k.byCode.get("KeyL"), undefined);
});
t("teclado: trocar A e B não mata nenhuma", () => {
  const k = S.keyTable({ a: "KeyK", b: "KeyL" });
  assert.equal(k.byCode.get("KeyK"), "a"); assert.equal(k.byCode.get("KeyL"), "b"); assert.equal(k.dead.size, 0);
});
t("jogadores: 1 controle = P1 no automático, teclado P2; teclado-p1 inverte; troca", () => {
  assert.deepEqual(S.slotsFor([3], "auto"), [3, "kb"]);
  assert.deepEqual(S.slotsFor([3], "teclado-p1"), ["kb", 3]);
  assert.deepEqual(S.slotsFor([3], "auto", true), ["kb", 3]);
  assert.deepEqual(S.slotsFor([1, 2], "auto"), [1, 2]); assert.deepEqual(S.slotsFor([1, 2], "auto", true), [2, 1]);
  assert.deepEqual(S.slotsFor([], "auto"), ["kb", null]);
});
t("persistência: update/reset", () => {
  S.update(s => { s.touch.size = "g"; s.keys.a = "Space"; });
  assert.equal(JSON.parse(mem.get(S.KEY)).touch.size, "g");
  assert.equal(S.load().touch.opacity, 0.85);   // mescla com o padrão
  S.reset(); assert.deepEqual(S.load().keys, {});
});
t("nomes", () => { assert.equal(S.keyName("KeyL"), "L"); assert.equal(S.sourceName("a:3-"), "Analógico dir. ↑"); assert.equal(S.sourceName("b:1"), "B (direita)"); });
console.log(`${n} testes ok`);
