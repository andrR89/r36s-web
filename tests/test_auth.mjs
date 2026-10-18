// node tests/test_auth.mjs
// Renovação do login (web/site/auth.js): sem toque o navegador bloqueia o popup do Google e a resposta nunca vem; depois
// de silentMs o auth pede um toque (askGesture) uma vez só para todos que esperam e renova dentro dele.
import assert from "node:assert/strict";
globalThis.window = globalThis;
let gesture = false, calls = 0;
const client = { requestAccessToken() { calls++; if (gesture) setTimeout(() => client.callback({ access_token: `tok${calls}`, expires_in: 3600 }), 10); } };
globalThis.google = { accounts: { oauth2: { initTokenClient: () => client, hasGrantedAllScopes: () => true } } };
const { createAuth } = await import("../web/site/auth.js");
let asks = 0;
const auth = createAuth({ auth: "google", scopes: "a b", silentMs: 200,
  askGesture: renew => { asks++; return new Promise(r => setTimeout(() => { gesture = true; r(renew()); }, 50)); } });
gesture = true;
assert.equal(await auth.signIn(), "tok1");
assert.equal(await auth.getToken(false), "tok1");              // válido: sem popup
gesture = false;
const t0 = Date.now();
const [a, b] = await Promise.all([auth.getToken(true), auth.getToken(true)]);   // vencido/401: popup bloqueado
assert.equal(a, b);
assert.equal(asks, 1, "um toque só para os dois pedidos");
assert.ok(Date.now() - t0 >= 200 && Date.now() - t0 < 2000);
assert.equal(auth.peekToken(), a);
// sem askGesture (testes antigos): o erro sobe em vez de travar
gesture = false;
const bare = createAuth({ auth: "google", scopes: "a b", silentMs: 100 });
await assert.rejects(bare.getToken(true), /não respondeu/);
console.log("ok auth");
process.exit(0);
