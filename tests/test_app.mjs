// node tests/test_app.mjs — funções puras do seletor (web/app/library.js, web/app/prefs.js)
import assert from "node:assert/strict";
const mem = new Map();
globalThis.localStorage = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) };
const { createLibrary, norm } = await import("../web/app/library.js");
const P = await import("../web/app/prefs.js");
let n = 0; const t = (name, f) => { f(); n++; console.log("ok", name); };

const data = { version: 1,
  systems: [{ id: "snes", name: "Super Nintendo", count: 3, playable: true, note: "" }, { id: "ports", name: "Ports", count: 1, playable: false, note: "x" }],
  games: [
    { s: "snes", rom: "/roms/snes/b.sfc", name: "Ação Total", year: 1995 },
    { s: "snes", rom: "/roms/snes/a.sfc", name: "Donkey Kong Country 3", year: 1996 },
    { s: "snes", rom: "/roms/snes/c.sfc", name: "Chrono Trigger", year: 1995 },
    { s: "ports", rom: "/roms/ports/d.sh", name: "Doom" } ] };
const lib = createLibrary(data);

t("norm: sem acento e minúsculo", () => assert.equal(norm("AÇÃO Total"), "acao total"));
t("jogos do sistema em ordem A–Z", () => assert.deepEqual(lib.games("snes").map(g => g.name), ["Ação Total", "Chrono Trigger", "Donkey Kong Country 3"]));
t("ordem por ano (empate: nome)", () => assert.deepEqual(lib.games("snes", "ano").map(g => g.name), ["Ação Total", "Chrono Trigger", "Donkey Kong Country 3"]));
t("busca sem acento, várias palavras", () => assert.deepEqual(lib.search("acao").map(g => g.name), ["Ação Total"]));
t("busca: começo do nome vem antes", () => assert.deepEqual(lib.search("d").map(g => g.name), ["Donkey Kong Country 3", "Doom"]));
t("busca por 'kong 3'", () => assert.deepEqual(lib.search("kong 3").map(g => g.rom), ["/roms/snes/a.sfc"]));
t("busca vazia", () => assert.deepEqual(lib.search("  "), []));
t("byRom e system", () => { assert.equal(lib.byRom("/roms/ports/d.sh").name, "Doom"); assert.equal(lib.system("ports").playable, false); });

t("favoritos liga/desliga", () => {
  assert.equal(P.toggleFav("/roms/snes/a.sfc"), true);
  assert.equal(P.isFav("/roms/snes/a.sfc"), true);
  assert.equal(P.toggleFav("/roms/snes/a.sfc"), false);
  assert.deepEqual(P.load().fav, []);
});
t("recentes: mais novo primeiro, sem repetir, até 20", () => {
  for (let i = 0; i < 25; i++) P.played(`/r/${i}`);
  P.played("/r/3");
  const r = P.load().recent;
  assert.equal(r.length, 20); assert.equal(r[0], "/r/3"); assert.equal(r.filter(x => x === "/r/3").length, 1);
});
t("localStorage quebrado não derruba", () => { mem.set("r36s-prefs-v1", "{nada"); assert.deepEqual(P.load(), { fav: [], recent: [] }); });
console.log(`${n} testes ok`);
