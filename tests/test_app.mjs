// node tests/test_app.mjs — funções puras do seletor (web/app/library.js, web/app/prefs.js)
import assert from "node:assert/strict";
// compara bytes sem o diff do assert: com MBs diferentes o Node monta uma mensagem de dezenas de GB (já derrubou a máquina)
const iguais = (a, b, msg = "bytes") => assert.ok(Buffer.from(a.buffer || a, a.byteOffset || 0, a.length).equals(Buffer.from(b.buffer || b, b.byteOffset || 0, b.length)), `${msg}: ${a.length} x ${b.length} bytes, conteúdo diferente`);
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
t("ordem por ano: mais velho primeiro, sem ano no fim", () => {
  const l = createLibrary({ systems: [{ id: "x", name: "X", count: 3 }], games: [
    { s: "x", rom: "/a", name: "Alfa", year: 2001 }, { s: "x", rom: "/b", name: "Beta" }, { s: "x", rom: "/c", name: "Gama", year: 1990 }] });
  assert.deepEqual(l.games("x", "ano").map(g => g.name), ["Gama", "Alfa", "Beta"]);
});
t("lista do sistema não pode ser bagunçada por quem usa", () => assert.throws(() => lib.games("snes").reverse()));
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
// io.thumb: miniatura = recorte [início, tamanho] do pacote do sistema, lido com Range
const { createIO } = await import("../web/io.js");
globalThis.self = globalThis;   // io.js usa self.caches (sem Cache API no node: sem cache)
const blobs = [];
URL.createObjectURL = b => { blobs.push(b); return `blob:${blobs.length}`; };
const pack = Uint8Array.from({ length: 64 }, (_, i) => i);
let calls = [];
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), range: init.headers && init.headers.Range });
  const m = /bytes=(\d+)-(\d+)/.exec(init.headers && init.headers.Range || "");
  return globalThis.fakeIgnoresRange || !m ? new Response(pack.slice(), { status: 200 }) : new Response(pack.slice(+m[1], +m[2] + 1), { status: 206 });
};
const lastBlob = async () => [...new Uint8Array(await blobs.at(-1).arrayBuffer())];
const hub = createIO({ backend: "hub" });
assert.equal(await hub.thumb("@capas/snes.bin?ab12", 10, 4), `blob:${blobs.length}`);
assert.ok(calls[0].url.endsWith("/web/data/capas/snes.bin?ab12")); assert.equal(calls[0].range, "bytes=10-13");
assert.deepEqual(await lastBlob(), [10, 11, 12, 13]); assert.equal(blobs.at(-1).type, "image/webp");
n++; console.log("ok io.thumb no hub: Range no pacote");
calls = [];
await createIO({ backend: "demo" }).thumb("@capas/nes x.bin?1", 0, 2);
assert.ok(calls[0].url.endsWith("/web/site/demo/data/capas/nes%20x.bin?1")); n++; console.log("ok io.thumb no demo");
// servidor que ignora Range (200 com o pacote todo): recorta, e o pacote fica guardado para as próximas
globalThis.fakeIgnoresRange = true; calls = [];
const io2 = createIO({ backend: "demo" });
await io2.thumb("@capas/gb.bin?9", 5, 3); assert.deepEqual(await lastBlob(), [5, 6, 7]);
await io2.thumb("@capas/gb.bin?9", 20, 2); assert.deepEqual(await lastBlob(), [20, 21]);
assert.equal(calls.length, 1); n++; console.log("ok io.thumb sem Range: um download do pacote");
globalThis.fakeIgnoresRange = false;
// backend drive: biblioteca cifrada (web/cripto.js) — arquivos por bloco, índice, capas e miniaturas decifrados aqui
const C = await import("../web/cripto.js");
const mestraT = crypto.getRandomValues(new Uint8Array(32));
const keys = { catalogo: await C.derivar(mestraT, "catalogo"), "sistema:snes": await C.derivar(mestraT, "sistema:snes") };
const romTexto = Uint8Array.from({ length: 2 * C.BLOCO + 100 }, (_, i) => i % 251);
const manifestT = { dirs: ["/roms", "/roms/snes"], files: { "/roms/snes/J.sfc": { size: romTexto.length, kind: "empty", id: "rom", v: "1" },
                                                         "/roms/gba/X.gba": { size: 4, kind: "empty", id: "gba", v: "1" } } };
const capaT = new Uint8Array([137, 80, 78, 71, 1, 2, 3]), thumbT = new Uint8Array([82, 73, 70, 70, 9]);
const arquivosT = {
  rom: await C.cifrarArquivo(keys["sistema:snes"], romTexto),
  man: await C.cifrarArquivo(keys.catalogo, new TextEncoder().encode(JSON.stringify(manifestT))),
  capa: await C.cifrarArquivo(keys.catalogo, capaT),
  pacote: await C.cifrarRegistro(keys.catalogo, thumbT),
};
const pedidosT = [];
const driveT = { api: "https://x", mediaUrl: id => "https://x/" + id, authHeader: () => "Bearer t",
  media: async (id, o = {}) => {
    pedidosT.push([id, o.range]);
    const a = arquivosT[id];
    if (!a) return new Response(null, { status: 404 });
    if (!o.range) return new Response(a.slice(), { status: 200 });
    return new Response(a.slice(o.range[0], o.range[1] + 1), { status: 206 });
  } };
const libT = { index: { manifest: { id: "man", v: "1", size: 0 }, eager: { id: "eag", v: "1", size: 0 }, library: { id: "lib", v: "1", size: 0 } }, keys };
const cif = createIO({ backend: "drive", site: { drive: driveT, library: libT } });
const f = cif.fetchFrom(new URL("../web/index.html", import.meta.url).href);
// arquivo inteiro e intervalo cruzando blocos
iguais(new Uint8Array(await (await f("fs/roms/snes/J.sfc")).arrayBuffer()), romTexto, "ROM inteira");
const r = await f("fs/roms/snes/J.sfc", { headers: { Range: `bytes=${C.BLOCO - 3}-${C.BLOCO + 4}` } });
assert.equal(r.status, 206);
iguais(new Uint8Array(await r.arrayBuffer()), romTexto.subarray(C.BLOCO - 3, C.BLOCO + 5), "Range");
assert.deepEqual(pedidosT.at(-1), ["rom", [0, 2 * C.CIFRADO - 1]]);
n++; console.log("ok io drive cifrado: arquivo inteiro e Range cruzando blocos");
// sufixo "bytes=-N" = últimos N bytes (cruzando bloco); N maior que o arquivo = tudo; -0, vários intervalos e lixo = 416
{
  const r = await f("fs/roms/snes/J.sfc", { headers: { Range: "bytes=-150" } });
  assert.equal(r.status, 206);
  assert.equal(r.headers.get("Content-Range"), `bytes ${romTexto.length - 150}-${romTexto.length - 1}/${romTexto.length}`);
  iguais(new Uint8Array(await r.arrayBuffer()), romTexto.subarray(romTexto.length - 150), "Range sufixo");
  assert.deepEqual(pedidosT.at(-1), ["rom", [C.CIFRADO, 3 * C.CIFRADO - 1 - (C.BLOCO - 100)]]);
  const tudo = await f("fs/roms/snes/J.sfc", { headers: { Range: `bytes=-${romTexto.length + 9}` } });
  assert.equal(tudo.status, 206);
  iguais(new Uint8Array(await tudo.arrayBuffer()), romTexto, "Range sufixo maior que o arquivo");
  const fim = await f("fs/roms/snes/J.sfc", { headers: { Range: `bytes=${romTexto.length - 2}-` } });
  iguais(new Uint8Array(await fim.arrayBuffer()), romTexto.subarray(romTexto.length - 2), "Range aberto");
  for (const ruim of ["bytes=-0", "bytes=0-1,5-6", "bytes=-", "itens=0-1", `bytes=${romTexto.length}-`])
    assert.equal((await f("fs/roms/snes/J.sfc", { headers: { Range: ruim } })).status, 416, ruim);
}
n++; console.log("ok io drive cifrado: Range sufixo, aberto e inválidos");
// sistema sem chave -> 403; canOpen
assert.equal((await f("fs/roms/gba/X.gba")).status, 403);
assert.equal(cif.canOpen("snes"), true);
assert.equal(cif.canOpen("gba"), false);
assert.equal(createIO({ backend: "hub" }).canOpen("gba"), true);
n++; console.log("ok io drive cifrado: sistema sem chave 403, canOpen");
// capa e miniatura decifradas (o fetch daqui é falso: o conteúdo sai do Blob entregue ao createObjectURL)
await cif.image("capa.abc123"); assert.deepEqual(await lastBlob(), [...capaT]);
await cif.thumb("pacote.abc123", 0, arquivosT.pacote.length); assert.deepEqual(await lastBlob(), [...thumbT]);
assert.equal(blobs.at(-1).type, "image/webp");
n++; console.log("ok io drive cifrado: capa e miniatura decifradas");
// lerPedacos (⬇ ROM): pedaços em ordem, juntos = o arquivo
{
  const partes = [];
  for await (const p of cif.lerPedacos("/roms/snes/J.sfc", { passo: C.BLOCO - 7 })) partes.push(p);
  assert.equal(partes.length, 3);
  iguais(new Uint8Array(await new Blob(partes).arrayBuffer()), romTexto, "lerPedacos");
  await assert.rejects(async () => { for await (const p of cif.lerPedacos("/roms/gba/X.gba")) void p; }, e => e.status === 403);
  n++; console.log("ok io drive cifrado: lerPedacos");
}
// bloco adulterado -> 502
arquivosT.rom[50] ^= 1;
assert.equal((await f("fs/roms/snes/J.sfc", { headers: { Range: "bytes=0-9" } })).status, 502);
arquivosT.rom[50] ^= 1;
// índice adulterado -> 502
{
  arquivosT.man[40] ^= 1;
  const c2 = createIO({ backend: "drive", site: { drive: driveT, library: libT } });
  assert.equal((await c2.fetchFrom(new URL("../web/index.html", import.meta.url).href)("data/manifest.json")).status, 502);
  arquivosT.man[40] ^= 1;
}
n++; console.log("ok io drive cifrado: bloco ou índice adulterado = 502");
await assert.rejects(cif.thumb("@capas/snes.bin", 0, 1), /@/); n++; console.log("ok io.thumb @ no Drive é erro");
// servidor sem Range: chamadas ao mesmo tempo esperam um download só; só um pacote inteiro fica na memória
{
  globalThis.fakeIgnoresRange = true; calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, i) => { await new Promise(r => setTimeout(r, 20)); return realFetch(u, i); };
  const io3 = createIO({ backend: "demo" });
  await Promise.all([io3.thumb("@capas/a.bin?1", 0, 2), io3.thumb("@capas/a.bin?1", 4, 2), io3.thumb("@capas/a.bin?1", 8, 2)]);
  assert.equal(calls.length, 1); n++; console.log("ok io.thumb sem Range: chamadas simultâneas, um download");
  await io3.thumb("@capas/b.bin?1", 0, 2); await io3.thumb("@capas/a.bin?1", 12, 2);
  assert.equal(calls.length, 3); n++; console.log("ok io.thumb sem Range: um pacote inteiro na memória por vez");
  globalThis.fetch = realFetch; globalThis.fakeIgnoresRange = false;
}
// 206 com tamanho errado: erro (não guarda recorte quebrado)
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(pack.slice(0, 3), { status: 206 });
  await assert.rejects(createIO({ backend: "hub" }).thumb("@capas/c.bin?1", 0, 5), /tamanho|bytes/);
  globalThis.fetch = realFetch; n++; console.log("ok io.thumb: 206 de tamanho errado é erro");
}
// Drive que ignorou o Range (200 com o pacote todo): cancela o corpo e falha, não baixa o pacote por capa
{
  let canceled = false;
  const body = () => new ReadableStream({ pull(c) { c.enqueue(pack); }, cancel() { canceled = true; } });
  const d = createIO({ backend: "drive", site: { drive: { api: "https://x", media: async () => new Response(body(), { status: 200, headers: { "Content-Length": "100000" } }) }, library: { keys } } });
  await assert.rejects(d.thumb("1P.abc", 10, 4), /Range/);
  assert.ok(canceled); n++; console.log("ok io.thumb no Drive: 200 sem Range cancela e falha");
  const d2 = createIO({ backend: "drive", site: { drive: { api: "https://x", media: async () => new Response(pack.slice(0, 3), { status: 206 }) }, library: { keys } } });
  await assert.rejects(d2.thumb("1P.abc", 0, 5), /tamanho|bytes/); n++; console.log("ok io.thumb no Drive: 206 de tamanho errado é erro");
}
// limpeza do cache: some recorte de pacote que não é mais o atual; capas originais e o outro backend ficam
{
  const store = new Map();
  globalThis.caches = { open: async () => ({
    match: async k => (store.has(String(k)) ? store.get(String(k)).clone() : undefined),
    put: async (k, r) => { store.set(String(k), r); },
    keys: async () => [...store.keys()].map(url => ({ url })),
    delete: async k => store.delete(typeof k === "string" ? k : k.url) }) };
  const reg = await C.cifrarRegistro(keys.catalogo, Uint8Array.of(7, 8));   // no Drive o pacote é de registros cifrados
  const drive = { api: "https://x", media: async (id, o) => new Response(reg.slice(o.range[0], o.range[1] + 1), { status: 206 }) };
  const h = createIO({ backend: "hub", site: null }), dm = createIO({ backend: "demo" }), dr = createIO({ backend: "drive", site: { drive, library: { keys } } });
  await h.thumb("@capas/snes.bin?old", 0, 2); await h.thumb("@capas/snes.bin?new", 0, 2); await h.thumb("@capas/gba.bin?g1", 2, 2);
  await dm.thumb("@capas/nes.bin?d1", 0, 2);
  await dr.thumb("1Snes.old111", 0, reg.length); await dr.thumb("1Snes.new222", 0, reg.length);
  const orig = "https://x/r36s-cache/1Cover/abc"; store.set(orig, new Response("png"));
  const before = [...store.keys()];
  assert.equal(before.length, 7);
  assert.equal(await h.pruneThumbs(["@capas/snes.bin?new", "@capas/gba.bin?g1"]), 1);
  assert.equal(await dr.pruneThumbs(["1Snes.new222"]), 1);
  const left = [...store.keys()];
  assert.ok(!left.some(k => k.includes("snes.bin?old") || k.includes("/1Snes/old111/")));
  assert.ok(left.some(k => k.includes("nes.bin?d1")) && left.includes(orig) && left.some(k => k.includes("/1Snes/new222/")));
  assert.equal(left.length, 5); n++; console.log("ok io.pruneThumbs: só recortes de pacotes velhos do próprio backend");
  // e o recorte guardado é usado na próxima vez (sem rede)
  calls = []; await h.thumb("@capas/gba.bin?g1", 2, 2); assert.equal(calls.length, 0); n++; console.log("ok io.thumb: recorte do cache");
}
console.log(`${n} testes ok`);
