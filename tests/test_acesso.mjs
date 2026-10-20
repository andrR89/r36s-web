import { test } from "node:test";
import assert from "node:assert/strict";
import * as C from "../web/cripto.js";
import { biblioteca, pedirAcesso } from "../web/site/acesso.js";

const mestra = crypto.getRandomValues(new Uint8Array(32));
const fakeFetch = (status, corpoDe) => async (url, init) => {
  const req = JSON.parse(init.body || "{}");
  return new Response(JSON.stringify(await corpoDe(url, req, init)), { status });
};

test("biblioteca: chaves desembrulhadas, índice e sistemas", async () => {
  const fetch = fakeFetch(200, async (url, req, init) => {
    assert.equal(url, "https://f/r36s");
    assert.equal(init.headers.Authorization, "Bearer tok");
    return { indice: { library: { id: "L" }, info: { systems: 1, games: 2 } }, sistemas: ["snes"],
             chaves: { catalogo: await C.embrulhar(await C.derivar(mestra, "catalogo"), req.publica) } };
  });
  const lib = await biblioteca({ funcoes: "https://f", token: "tok", fetch });
  assert.equal(lib.id, "r36s");
  assert.deepEqual(lib.sistemas, ["snes"]);
  assert.deepEqual(lib.keys.catalogo, await C.derivar(mestra, "catalogo"));
  assert.equal(lib.index.info.games, 2);
});

test("biblioteca: 403 traz o pedido", async () => {
  const fetch = fakeFetch(403, async () => ({ error: "acesso", pedido: { status: "pendente" } }));
  await assert.rejects(biblioteca({ funcoes: "https://f", token: "t", fetch }), e => e.status === 403 && e.pedido.status === "pendente");
});

test("pedirAcesso", async () => {
  const fetch = fakeFetch(200, async (url, req) => { assert.equal(url, "https://f/conta?op=pedir"); assert.equal(req.nome, "Bia"); return { status: "pendente" }; });
  assert.equal(await pedirAcesso({ funcoes: "https://f", token: "t", nome: "Bia", mensagem: "oi", fetch }), "pendente");
});
