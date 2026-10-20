# Acesso cifrado à biblioteca — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a biblioteca do R36S no Drive vira arquivos opacos e cifrados; só o backend da biblioteca (Supabase
`h-games-web`) entrega as chaves, a quem foi aprovado.

**Architecture:** um módulo de formato (`web/cripto.js`) usado igual pelo empacotador (Node) e pelo site (navegador):
blocos AES-256-GCM de 1 MiB, chaves por sistema derivadas (HKDF) de uma mestra. O empacotador `data/cifrar.mjs`
transforma a saída em claro do `mkmanifest.py` (modo hub) em arquivos opacos + índice cifrado. O backend ganha a
função `r36s` (mesmo núcleo, login e tabela `acesso` da biblioteca). O `io.js` decifra no backend `drive`; o
`lazyFile` do player decifra síncrono (`@noble/ciphers`).

**Tech Stack:** WebCrypto, `@noble/ciphers` 2.0.1 (empacotada com esbuild), Node 26 (`node:test`), Python 3
(`mkmanifest.py` sem mudança de formato), Supabase (Postgres + Vault + Edge Functions Deno), rclone, Playwright
(`/home/andre/Workspace/web-ports/tools/pw`) com `/usr/bin/chromium`.

**Spec:** `docs/superpowers/specs/2026-10-20-acesso-cifrado-design.md`.

**Desvio da spec (simplificação):** em vez de um modo `mkmanifest --cifrado`, o `mkmanifest.py` continua só gerando o
índice em claro (modo hub, que já existe e é testado) e **toda** a parte cifrada fica no `data/cifrar.mjs` (três
subcomandos). Assim o formato da cifra vive num lugar só (JS, o mesmo código do navegador).

## Decisão depois da Tarefa 1 (vale para o plano inteiro)

A medida reprovou o AES-GCM em JS (591 ms por 4 MB, CPU 4x). Formato trocado para **ChaCha20-Poly1305** (spec, seção
"Cifra: ChaCha20"): `cifrarBloco`/`cifrarRegistro` e os caminhos assíncronos usam `chacha20poly1305` da
`@noble/ciphers` (conferem a etiqueta); `decifrarIntervaloSync` usa `chacha20` com contador 1, **sem** conferir a
etiqueta. Nonce, AAD, tamanhos (28 bytes por bloco), HKDF, nomes e embrulho não mudam, nem a API exportada do
`web/cripto.js`. Onde o código das tarefas abaixo disser AES-GCM/`gcm`, vale ChaCha20-Poly1305. Consequência para os
testes: adulterar um bloco faz o caminho assíncrono falhar (502/erro), mas o `decifrarIntervaloSync` só devolve bytes
errados (não lança).

## Regras para quem executa

- Repositórios: `/home/andre/Workspace/web-ports/r36s` (branch `etapa1`) e `/home/andre/Workspace/web-ports/biblioteca`
  (git local). Commits locais; **nunca** `git push`, deploy, `rclone` de escrita, SQL no Supabase de verdade ou
  `publicar.sh` (exceto nos passos da Tarefa 10, que só o controlador executa, cada um com ok do andre).
- O cartão (`/run/media/andre/EASYROMS`, `ROOTFS`) é **só leitura**. Testes usam cartões falsos em diretório temporário.
- Navegador e builds: `systemd-run --user --scope -q -p MemoryMax=12G <comando>`.
- **Testes Node também, com teto menor:** `systemd-run --user --scope -q -p MemoryMax=4G -p MemorySwapMax=0 timeout 600
  node ...`. Em 2026-10-20 um `assert.deepEqual` entre dois arrays de MBs diferentes (fase vermelha do TDD) fez o Node
  montar uma mensagem de diff de 24 GB e o oomd matou o Chrome do andre. Comparar bytes grandes só com o `iguais(a, b)`
  dos testes (Buffer.equals), nunca `deepEqual`/`equal` de arrays ou hex de MBs.
- No fim de cada tarefa que roda o player: `md5sum` do save do DK3
  (`saves/snes/Donkey Kong Country 3 - Dixie Kong's Double Trouble! (USA) (PT-BR).srm`) = `42a492ce4260a522416a75be0ebd353e`
  e nenhum save novo em `saves/` (apagar os criados pelos testes).
- Comentários em português, no estilo dos arquivos vizinhos (curtos, explicam o porquê).

## Mapa de arquivos

r36s:
- Criar `web/vendor/noble-aes.js` (gerado), `web/vendor/LICENSE-noble-ciphers`
- Criar `web/cripto.js` — formato, HKDF, cifra/decifra assíncrona e síncrona, embrulho
- Criar `tests/test_cripto.mjs`, `tests/cripto_perf.mjs`
- Criar `data/cifrar.mjs` — `mestra`, `cifrar`, `indice`, `ponteiro`
- Criar `tests/test_cifrar.mjs`
- Criar `web/site/acesso.js` — chama a função `r36s` e `conta?op=pedir`
- Criar `tests/mock_chaves.mjs` — backend local com o mesmo contrato
- Modificar `web/site/config.js`, `web/site/site.js`, `web/site/site.css` (tela sem acesso)
- Modificar `web/io.js`, `web/retroarch/play.js` (`lazyFile`), `web/app/download.js`, `web/app/main.js`
- Modificar `tests/test_app.mjs`, `tests/download.mjs`, `tests/e2e_site.mjs`, `tests/mock_drive.py` (se preciso)
- Modificar `build/upload/sobe.sh` (gitignored), `docs/deploy.md`, `LICENSES.md`

biblioteca:
- Criar `supabase/migrations/0003_r36s.sql`, `supabase/functions/_shared/r36s.js`, `supabase/functions/r36s/index.ts`
- Modificar `supabase/functions/_shared/nucleo.js`, `tools/funcoes-local.mjs`, `tools/publicar.sh`, `site/admin.js`
  (+ textos de `site/i18n`)
- Criar `tests/r36s.test.mjs`

---

### Tarefa 1: `web/cripto.js` + `@noble/ciphers` + medida de desempenho (PORTÃO)

**Files:**
- Create: `web/vendor/noble-aes.js`, `web/vendor/LICENSE-noble-ciphers`, `web/cripto.js`, `tests/test_cripto.mjs`, `tests/cripto_perf.mjs`
- Modify: `LICENSES.md`

- [ ] **Passo 1: empacotar a `@noble/ciphers` 2.0.1 num arquivo só**

```bash
S=/tmp/claude-1000/-home-andre-Workspace/b51375b0-c435-4115-9cf3-05c21deb9623/scratchpad/noble
rm -rf $S && mkdir -p $S && cd $S && npm init -y >/dev/null && npm install --no-audit --no-fund @noble/ciphers@2.0.1 esbuild@0.25.10
printf 'export { gcm } from "@noble/ciphers/aes.js";\n' > entry.mjs
npx esbuild entry.mjs --bundle --format=esm --minify --legal-comments=inline --outfile=/home/andre/Workspace/web-ports/r36s/web/vendor/noble-aes.js
cp node_modules/@noble/ciphers/LICENSE /home/andre/Workspace/web-ports/r36s/web/vendor/LICENSE-noble-ciphers
```

Esperado: `web/vendor/noble-aes.js` com algumas dezenas de KB, exportando `gcm`. Acrescentar ao `LICENSES.md` uma linha
no estilo das existentes: `web/vendor/noble-aes.js — @noble/ciphers 2.0.1 (MIT, Paul Miller), AES-GCM; licença em
web/vendor/LICENSE-noble-ciphers`.

- [ ] **Passo 2: escrever o teste (falha: `web/cripto.js` não existe)**

`tests/test_cripto.mjs`:

```js
// node --test tests/test_cripto.mjs — formato cifrado (spec 2026-10-20-acesso-cifrado)
import { test } from "node:test";
import assert from "node:assert/strict";
import * as C from "../web/cripto.js";

const hex = u => Buffer.from(u).toString("hex");
const mestra = Uint8Array.from({ length: 32 }, (_, i) => i);
const aleatorio = n => { const u = new Uint8Array(n); for (let i = 0; i < n; i += 65536) crypto.getRandomValues(u.subarray(i, i + 65536)); return u; };

test("HKDF: vetores fixos (os mesmos do backend, biblioteca tests/r36s.test.mjs)", async () => {
  assert.equal(hex(await C.derivar(mestra, "sistema:snes")), "50b722a3831e29f5f085f4b7fae749c2290e2f87a407e697b932afca2315b2d9");
  assert.equal(hex(await C.derivar(mestra, "bios")), "e96920eaf8527c5d391ba2face23de1af2a6c754db72a89ce47304af9a1fad71");
  assert.equal(hex(await C.derivar(mestra, "catalogo")), "ad0a9b7103e748b6ac22f4498d330fe90b7bb640fcd34c3bf3c842c59a6d5c2f");
  assert.equal(hex(await C.derivar(mestra, "nomes")), "42e465717c62c55f63b403c82934e97861c39a284373e8ab8239f8c0818bb4f7");
});

test("chaveDoCaminho", () => {
  assert.equal(C.chaveDoCaminho("/roms/snes/Jogo.sfc"), "sistema:snes");
  assert.equal(C.chaveDoCaminho("/roms/pico-8/carts/x.p8.png"), "sistema:pico-8");
  assert.equal(C.chaveDoCaminho("/roms/bios/scph1001.bin"), "bios");
  assert.equal(C.chaveDoCaminho("/roms/solto.txt"), "catalogo");
  assert.equal(C.chaveDoCaminho("/home/ark/.config/retroarch/retroarch.cfg"), "catalogo");
});

test("tamanhos e faixa", () => {
  const M = C.BLOCO;
  assert.equal(C.tamanhoCifrado(0), 0);
  assert.equal(C.tamanhoCifrado(1), 29);
  assert.equal(C.tamanhoCifrado(M), M + 28);
  assert.equal(C.tamanhoCifrado(M + 1), M + 1 + 56);
  assert.equal(C.tamanhoClaro(C.tamanhoCifrado(3 * M + 5)), 3 * M + 5);
  assert.deepEqual(C.faixa(0, 9, 100), { i: 0, j: 0, cDe: 0, cAte: 127 });
  assert.deepEqual(C.faixa(M, 2 * M - 1, 3 * M), { i: 1, j: 1, cDe: M + 28, cAte: 2 * (M + 28) - 1 });
});

test("arquivo: ida e volta, determinístico, qualquer intervalo, síncrono == assíncrono", async () => {
  const k = await C.derivar(mestra, "sistema:snes");
  for (const size of [0, 1, C.BLOCO - 1, C.BLOCO, C.BLOCO + 1, 3 * C.BLOCO + 12345]) {
    const texto = aleatorio(size);
    const cif = await C.cifrarArquivo(k, texto);
    assert.equal(cif.length, C.tamanhoCifrado(size));
    assert.equal(hex(await C.cifrarArquivo(k, texto)), hex(cif));          // mesmo conteúdo -> mesmo arquivo
    assert.equal(hex(await C.decifrarArquivo(k, cif)), hex(texto));
    if (!size) continue;
    for (const [de, ate] of [[0, size - 1], [0, 0], [size - 1, size - 1], [Math.floor(size / 3), Math.floor(2 * size / 3)]]) {
      const f = C.faixa(de, ate, size);
      const pedaco = cif.subarray(f.cDe, f.cAte + 1);
      const esperado = hex(texto.subarray(de, ate + 1));
      assert.equal(hex(await C.decifrarIntervalo(k, pedaco, de, ate, size)), esperado);
      assert.equal(hex(C.decifrarIntervaloSync(k, pedaco, de, ate, size)), esperado);
    }
  }
});

test("AAD: bloco trocado, cortado ou com outra chave falha", async () => {
  const k = await C.derivar(mestra, "sistema:snes"), outra = await C.derivar(mestra, "bios");
  const texto = aleatorio(2 * C.BLOCO), cif = await C.cifrarArquivo(k, texto);
  const trocado = new Uint8Array(cif.length);
  trocado.set(cif.subarray(C.CIFRADO), 0); trocado.set(cif.subarray(0, C.CIFRADO), C.CIFRADO);
  await assert.rejects(C.decifrarArquivo(k, trocado));
  assert.throws(() => C.decifrarIntervaloSync(k, trocado, 0, 10, texto.length));
  await assert.rejects(C.decifrarArquivo(k, cif.subarray(0, C.CIFRADO)));     // n_blocos no AAD: arquivo cortado
  await assert.rejects(C.decifrarArquivo(outra, cif));
});

test("registro de miniatura", async () => {
  const k = await C.derivar(mestra, "catalogo"), webp = aleatorio(5000);
  const r = await C.cifrarRegistro(k, webp);
  assert.equal(r.length, 5000 + 28);
  assert.equal(hex(await C.decifrarRegistro(k, r)), hex(webp));
  r[40] ^= 1;
  await assert.rejects(C.decifrarRegistro(k, r));
});

test("nome opaco", async () => {
  const n = await C.derivar(mestra, "nomes");
  const a = await C.nomeOpaco(n, "/roms/snes/Jogo.sfc");
  assert.match(a, /^[0-9a-f]{24}$/);
  assert.equal(a, await C.nomeOpaco(n, "/roms/snes/Jogo.sfc"));
  assert.notEqual(a, await C.nomeOpaco(n, "/roms/snes/Jogo2.sfc"));
});

test("embrulho: o navegador recebe a chave crua", async () => {
  const k = await C.derivar(mestra, "sistema:snes");
  const { privada, publica } = await C.novoPar();
  const resp = await C.embrulhar(k, publica);
  assert.equal(hex(await C.desembrulharCru(privada, resp)), hex(k));
});
```

Rodar: `node --test tests/test_cripto.mjs` — Esperado: FALHA (`Cannot find module .../web/cripto.js`).

- [ ] **Passo 3: implementar `web/cripto.js`**

```js
// Formato cifrado da biblioteca no Drive (spec docs/superpowers/specs/2026-10-20-acesso-cifrado-design.md). O mesmo
// arquivo roda no navegador (io.js, site) e no Node (data/cifrar.mjs, testes).
//
//   chave(s) = HKDF-SHA256(mestra, salt "r36s-web/v1", info s): "sistema:<pasta de /roms>", "bios", "catalogo", "nomes"
//   arquivo  = blocos de 1 MiB: nonce (12) || AES-256-GCM(texto) || tag (16); AAD = "r36s" || u32 i || u32 n_blocos
//              nonce = HMAC-SHA256(chave, u32 i || texto)[:12] (mesmo conteúdo -> mesmo arquivo: republicar só sobe o
//              que mudou)
//   registro = miniatura: nonce || GCM(webp) || tag, AAD "r36s-thumb", nonce = HMAC(chave, webp)[:12]
//
// Assíncrono = WebCrypto. Síncrono (decifrarIntervaloSync) = AES-GCM da @noble/ciphers: o lazyFile do player lê com
// XHR síncrono dentro do fread do núcleo, onde a WebCrypto (só assíncrona) não serve. Por isso a chave do sistema
// chega ao JS como bytes (só em memória).
import { gcm } from "./vendor/noble-aes.js";

const subtle = globalThis.crypto.subtle;
const te = new TextEncoder();
export const BLOCO = 1 << 20, EXTRA = 28, CIFRADO = BLOCO + EXTRA;
const SALT = te.encode("r36s-web/v1");
const AAD_THUMB = te.encode("r36s-thumb");

export const nBlocos = size => Math.ceil(size / BLOCO);
export const tamanhoCifrado = size => size + nBlocos(size) * EXTRA;
export const tamanhoClaro = cifrado => cifrado - Math.ceil(cifrado / CIFRADO) * EXTRA;
// intervalo em claro [de, ate] (inclusive) -> blocos i..j e o intervalo cifrado [cDe, cAte] (inclusive)
export function faixa(de, ate, size) {
  const i = Math.floor(de / BLOCO), j = Math.floor(ate / BLOCO);
  return { i, j, cDe: i * CIFRADO, cAte: Math.min(tamanhoCifrado(size), (j + 1) * CIFRADO) - 1 };
}
const u32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const aad = (i, n) => Uint8Array.from([114, 51, 54, 115, ...u32(i), ...u32(n)]);   // "r36s" || i || n

// chave de um arquivo do cartão; capas, miniaturas e índices usam "catalogo" (quem chama decide)
export function chaveDoCaminho(vpath) {
  const p = vpath.split("/");
  if (p[1] !== "roms" || p.length < 4) return "catalogo";
  return p[2] === "bios" ? "bios" : "sistema:" + p[2];
}

export async function derivar(mestra, info) {
  const k = await subtle.importKey("raw", mestra, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: SALT, info: te.encode(info) }, k, 256));
}

const hmac = async (chave, ...partes) => {
  const k = await subtle.importKey("raw", chave, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const tudo = new Uint8Array(partes.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of partes) { tudo.set(p, at); at += p.length; }
  return new Uint8Array(await subtle.sign("HMAC", k, tudo));
};
// CryptoKey por chave crua (as mesmas chaves decifram milhares de blocos)
const chavesGcm = new WeakMap();
const gcmKey = chave => {
  let k = chavesGcm.get(chave);
  if (!k) chavesGcm.set(chave, (k = subtle.importKey("raw", chave, { name: "AES-GCM" }, false, ["encrypt", "decrypt"])));
  return k;
};

// ---- cifrar (empacotador) ----
export async function cifrarBloco(chave, i, n, texto) {
  const iv = (await hmac(chave, Uint8Array.from(u32(i)), texto)).subarray(0, 12);
  const c = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(i, n) }, await gcmKey(chave), texto));
  const out = new Uint8Array(12 + c.length);
  out.set(iv, 0); out.set(c, 12);
  return out;
}
export async function cifrarArquivo(chave, texto) {
  const n = nBlocos(texto.length), out = new Uint8Array(tamanhoCifrado(texto.length));
  for (let i = 0; i < n; i++) out.set(await cifrarBloco(chave, i, n, texto.subarray(i * BLOCO, (i + 1) * BLOCO)), i * CIFRADO);
  return out;
}
export async function cifrarRegistro(chave, dados) {
  const iv = (await hmac(chave, dados)).subarray(0, 12);
  const c = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv, additionalData: AAD_THUMB }, await gcmKey(chave), dados));
  const out = new Uint8Array(12 + c.length);
  out.set(iv, 0); out.set(c, 12);
  return out;
}
export async function nomeOpaco(chaveNomes, texto) {
  return Array.from((await hmac(chaveNomes, te.encode(texto))).subarray(0, 12), b => b.toString(16).padStart(2, "0")).join("");
}

// ---- decifrar ----
// blocos consecutivos a partir do bloco i (cifrado começa no início do bloco i); n = blocos do arquivo inteiro
async function decifrarBlocos(chave, cifrado, i, n) {
  const k = await gcmKey(chave), partes = [];
  for (let at = 0, b = i; at < cifrado.length; at += CIFRADO, b++) {
    const bloco = cifrado.subarray(at, at + CIFRADO);
    partes.push(new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: bloco.subarray(0, 12), additionalData: aad(b, n) }, k, bloco.subarray(12))));
  }
  return junta(partes);
}
function decifrarBlocosSync(chave, cifrado, i, n) {
  const partes = [];
  for (let at = 0, b = i; at < cifrado.length; at += CIFRADO, b++) {
    const bloco = cifrado.subarray(at, at + CIFRADO);
    partes.push(gcm(chave, bloco.subarray(0, 12), aad(b, n)).decrypt(bloco.subarray(12)));
  }
  return junta(partes);
}
const junta = partes => {
  if (partes.length === 1) return partes[0];
  const out = new Uint8Array(partes.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of partes) { out.set(p, at); at += p.length; }
  return out;
};
// cifrado = bytes [faixa.cDe, faixa.cAte] do arquivo; devolve o texto [de, ate]
export async function decifrarIntervalo(chave, cifrado, de, ate, size) {
  const { i } = faixa(de, ate, size);
  const t = await decifrarBlocos(chave, cifrado, i, nBlocos(size));
  return t.subarray(de - i * BLOCO, ate - i * BLOCO + 1);
}
export function decifrarIntervaloSync(chave, cifrado, de, ate, size) {
  const { i } = faixa(de, ate, size);
  const t = decifrarBlocosSync(chave, cifrado, i, nBlocos(size));
  return t.subarray(de - i * BLOCO, ate - i * BLOCO + 1);
}
export async function decifrarArquivo(chave, cifrado) {
  const size = tamanhoClaro(cifrado.length);
  return size ? decifrarIntervalo(chave, cifrado, 0, size - 1, size) : new Uint8Array(0);
}
export async function decifrarRegistro(chave, r) {
  return new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: r.subarray(0, 12), additionalData: AAD_THUMB }, await gcmKey(chave), r.subarray(12)));
}

// ---- chaves vindas do backend (mesmo embrulho da biblioteca: ECDH P-256 + AES-KW) ----
const ECDH = { name: "ECDH", namedCurve: "P-256" };
const b64 = u => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const deB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
export async function novoPar() {
  const par = await subtle.generateKey(ECDH, false, ["deriveKey"]);
  const p = await subtle.exportKey("jwk", par.publicKey);
  return { privada: par.privateKey, publica: { kty: p.kty, crv: p.crv, x: p.x, y: p.y } };
}
// lado do backend (aqui para os testes e o tests/mock_chaves.mjs; o de verdade é o da biblioteca, mesmo algoritmo)
export async function embrulhar(chaveCrua, publicaJwk) {
  const deles = await subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: publicaJwk.x, y: publicaJwk.y }, ECDH, false, []);
  const meu = await subtle.generateKey(ECDH, true, ["deriveKey"]);
  const kw = await subtle.deriveKey({ name: "ECDH", public: deles }, meu.privateKey, { name: "AES-KW", length: 256 }, false, ["wrapKey"]);
  const chave = await subtle.importKey("raw", chaveCrua, { name: "AES-GCM" }, true, ["decrypt"]);
  const pub = await subtle.exportKey("jwk", meu.publicKey);
  return { publica: { kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y }, embrulhada: b64(new Uint8Array(await subtle.wrapKey("raw", chave, kw, "AES-KW"))) };
}
export async function desembrulharCru(privada, resposta) {
  const deles = await subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: resposta.publica.x, y: resposta.publica.y }, ECDH, false, []);
  const kw = await subtle.deriveKey({ name: "ECDH", public: deles }, privada, { name: "AES-KW", length: 256 }, false, ["unwrapKey"]);
  const k = await subtle.unwrapKey("raw", deB64(resposta.embrulhada), kw, "AES-KW", { name: "AES-GCM" }, true, ["decrypt"]);
  return new Uint8Array(await subtle.exportKey("raw", k));
}
```

- [ ] **Passo 4: rodar** `node --test tests/test_cripto.mjs` — Esperado: todos passam.

- [ ] **Passo 5: medida no Chromium (portão)**

`tests/cripto_perf.mjs`:

```js
// node tests/cripto_perf.mjs [url base do web/] — decifra 4 MB (o pedaço do lazyFile) síncrono e assíncrono no
// Chromium, com a CPU 4x mais lenta (aproximação do celular). Critério da spec: síncrono < 150 ms.
import { chromium } from "/home/andre/Workspace/web-ports/tools/pw/node_modules/playwright-core/index.mjs";
const base = (process.argv[2] || "http://localhost:8770/r36s/").replace(/\/?$/, "/");
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium" });
const p = await browser.newPage();
await p.goto(base + "site/");
const cdp = await p.context().newCDPSession(p);
for (const rate of [1, 4]) {
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  const r = await p.evaluate(async b => {
    const C = await import(b + "cripto.js");
    const k = crypto.getRandomValues(new Uint8Array(32)), size = 4 << 20, t = new Uint8Array(size);
    for (let i = 0; i < size; i += 65536) crypto.getRandomValues(t.subarray(i, i + 65536));
    const cif = await C.cifrarArquivo(k, t);
    const med = async f => { const ts = []; for (let n = 0; n < 5; n++) { const a = performance.now(); await f(); ts.push(performance.now() - a); } return Math.round(ts.sort((x, y) => x - y)[2]); };
    return { sync: await med(() => C.decifrarIntervaloSync(k, cif, 0, size - 1, size)), async: await med(() => C.decifrarIntervalo(k, cif, 0, size - 1, size)) };
  }, base);
  console.log(JSON.stringify({ cpu: rate + "x", msPor4MB: r }));
}
await browser.close();
```

Rodar (hub no ar; se não estiver, recriar com o comando do topo das notas do projeto):
`systemd-run --user --scope -q -p MemoryMax=12G node tests/cripto_perf.mjs`

Esperado: duas linhas JSON. **Portão:** se `sync` com `cpu: "4x"` passar de 150 ms, PARAR e reportar os números ao
controlador (status BLOCKED) — a decisão (service worker ou aceitar) é do andre.

- [ ] **Passo 6: commit**

```bash
git add web/vendor web/cripto.js tests/test_cripto.mjs tests/cripto_perf.mjs LICENSES.md
git commit -m "cripto.js: formato cifrado da biblioteca (blocos AES-GCM de 1 MiB, HKDF, embrulho) + noble-ciphers"
```

---

### Tarefa 2: empacotador `data/cifrar.mjs`

**Files:**
- Create: `data/cifrar.mjs`, `tests/test_cifrar.mjs`

Entrada: o cartão (`<card>/roms/...`, a mesma raiz que o `mkmanifest.py` recebe) e a saída **em claro** do
`mkmanifest.py <card> <claro> --thumbs <cache>` (sem `--drive-ids`: `manifest.json`, `eager.bin`, `library.json.gz` com
imagens como caminho `/roms/...`, `capas/<sys>.bin` e `capas: "@capas/<sys>.bin?<h>"`).

Subcomandos:

```
node data/cifrar.mjs mestra  [--mestra F]                    cria a mestra (32 bytes, base64) em F se não existe (600)
node data/cifrar.mjs cifrar  --card C --claro D --out O --mapa M [--mestra F]
     cada arquivo de C/roms (fora ports/, themes/, pastas com ".", "System Volume Information", *.log) -> O/<opaco>,
     pacotes de miniaturas -> O/<opaco>; apaga de O o que não está mais no mapa; M = mapa (fica FORA de O: tem os nomes)
node data/cifrar.mjs indice  --claro D --out O --mapa M --lsjson L [--mestra F]
     com os IDs do Drive (L = rclone lsjson da pasta R36S-dados): manifest/library com IDs, cifrados com a chave
     do catálogo -> O/<opaco de "indice:manifest" | "indice:eager" | "indice:library">
node data/cifrar.mjs ponteiro --claro D --mapa M --lsjson L > indice.json
     o que vai para a tabela r36s_indice: {library, manifest, eager: {id, v, size}, sistemas, info: {systems, games}}
```

`F` padrão: `~/.config/r36s/mestra`. Mapa:
`{arquivos: {vpath: {o, size, mtime, k}}, capas: {sys: {o, thumbs: {"off,len": [off2, len2]}}}, indice: {manifest|eager|library: {o, size}}}`.
`k` = nome da chave usada (`catalogo` para as imagens citadas como `box`/`shot` no library; senão `chaveDoCaminho`).
`v` = os 10 primeiros do md5 do Drive (como o `read_lsjson` do `mkmanifest.py`); nas refs do library vão 6
(`"<id>.<v6>"`, como hoje).

- [ ] **Passo 1: teste (falha)**

`tests/test_cifrar.mjs` monta um cartão falso, roda o `mkmanifest.py` em claro e o `cifrar.mjs`, simula o Drive com
o `tests/mock_drive.py --lsjson` e confere:

```js
// node --test tests/test_cifrar.mjs — data/cifrar.mjs num cartão falso
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import * as C from "../web/cripto.js";

const ROOT = new URL("..", import.meta.url).pathname;
const SYSTEMS = `<systemList>
<system><name>snes</name><fullname>Super Nintendo</fullname><path>/roms/snes/</path><extension>.sfc .7z</extension></system>
<system><name>psx</name><fullname>PlayStation</fullname><path>/roms/psx</path><extension>.cue .bin .m3u</extension></system>
</systemList>`;
const GAMELIST = `<gameList><game><path>./Donkey.sfc</path><name>Donkey Kong</name><image>./images/dk.png</image></game></gameList>`;
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
  "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");

function cartao() {
  const w = mkdtempSync(join(tmpdir(), "cifrar-")), card = join(w, "card");
  const put = (p, d) => { mkdirSync(dirname(join(card, p)), { recursive: true }); writeFileSync(join(card, p), d); };
  put("etc/emulationstation/es_systems.cfg", SYSTEMS);
  put("roms/snes/gamelist.xml", GAMELIST);
  put("roms/snes/Donkey.sfc", Buffer.alloc(3 * C.BLOCO + 7, 1));
  put("roms/snes/images/dk.png", PNG);
  put("roms/psx/Disco.cue", 'FILE "Disco.bin" BINARY\n');
  put("roms/psx/Disco.bin", Buffer.from("BIN"));
  put("roms/psx/Disco.sbi", Buffer.from("SBI"));                              // fora das extensões: vai para o extra
  put("roms/bios/scph1001.bin", Buffer.alloc(512, 2));
  put("roms/ports/Jogo.sh", "#!/bin/sh");
  put("home/ark/.config/retroarch/retroarch.cfg", "video_driver = \"gl\"\n");
  return { w, card };
}
const run = (...a) => execFileSync("node", [join(ROOT, "data/cifrar.mjs"), ...a], { encoding: "utf8" });

test("cifrar -> indice -> ponteiro: nada em claro, tudo decifra", async () => {
  const { w, card } = cartao();
  const claro = join(w, "claro"), out = join(w, "out"), mapa = join(w, "mapa.json"), mestra = join(w, "mestra");
  execFileSync("python3", ["-I", join(ROOT, "data/mkmanifest.py"), card, claro, "--thumbs", join(w, "thumbs")]);
  run("mestra", "--mestra", mestra);
  run("cifrar", "--card", card, "--claro", claro, "--out", out, "--mapa", mapa, "--mestra", mestra);
  const M = JSON.parse(readFileSync(mapa, "utf8"));
  assert.ok(M.arquivos["/roms/snes/Donkey.sfc"] && M.arquivos["/roms/bios/scph1001.bin"]);
  assert.ok(!Object.keys(M.arquivos).some(p => p.startsWith("/roms/ports/")));
  assert.equal(M.arquivos["/roms/snes/images/dk.png"].k, "catalogo");
  assert.equal(M.arquivos["/roms/snes/Donkey.sfc"].k, "sistema:snes");
  // nenhum nome nem conteúdo em claro no que sobe
  for (const f of readdirSync(out)) {
    assert.match(f, /^[0-9a-f]{24}$/);
    const b = readFileSync(join(out, f)).toString("latin1");
    // só textos de 5+ letras: 3 letras aparecem por acaso em MBs de bytes aleatórios
    for (const s of ["Donkey", "Disco", "BINARY", "Super Nintendo", "gameList"]) assert.ok(!b.includes(s), `${s} em claro em ${f}`);
  }
  // Drive simulado: lsjson da pasta plana
  const ls = join(w, "ls.json");
  writeFileSync(ls, execFileSync("python3", ["-I", join(ROOT, "tests/mock_drive.py"), "--lsjson", out]));
  run("indice", "--claro", claro, "--out", out, "--mapa", mapa, "--lsjson", ls, "--mestra", mestra);
  writeFileSync(ls, execFileSync("python3", ["-I", join(ROOT, "tests/mock_drive.py"), "--lsjson", out]));
  const ptr = JSON.parse(run("ponteiro", "--claro", claro, "--mapa", mapa, "--lsjson", ls));
  assert.deepEqual(ptr.sistemas, ["psx", "snes"]);
  assert.deepEqual(ptr.info, { systems: 2, games: 2 });
  const byId = Object.fromEntries(JSON.parse(readFileSync(ls, "utf8")).map(i => [i.ID, i.Path]));
  const m = Buffer.from(readFileSync(mestra, "utf8").trim(), "base64");
  const cat = await C.derivar(m, "catalogo"), snes = await C.derivar(m, "sistema:snes");
  const abre = async (ref, k) => C.decifrarArquivo(k, new Uint8Array(readFileSync(join(out, byId[ref.id]))));
  const manifest = JSON.parse(new TextDecoder().decode(await abre(ptr.manifest, cat)));
  const library = JSON.parse(gunzipSync(await abre(ptr.library, cat)).toString());
  const rom = manifest.files["/roms/snes/Donkey.sfc"];
  assert.ok(rom.id && rom.v && rom.size === 3 * C.BLOCO + 7);
  assert.deepEqual(await C.decifrarArquivo(snes, new Uint8Array(readFileSync(join(out, byId[rom.id])))), new Uint8Array(3 * C.BLOCO + 7).fill(1));
  assert.ok((manifest.files["/roms/psx/Disco.bin"] || manifest.extra["/roms/psx/Disco.bin"])?.id);   // faixa citada pelo .cue
  assert.ok(manifest.extra["/roms/psx/Disco.sbi"]?.id);
  const g = library.games.find(x => x.rom === "/roms/snes/Donkey.sfc");
  assert.match(g.box || g.shot, /^[^/.]+\.[0-9a-f]{6}$/);                       // imagem: "<id>.<v6>"
  const s = library.systems.find(x => x.id === "snes");
  if (g.thumb) {                                                                // PNG de 1 px: a miniatura pode existir
    const pack = new Uint8Array(readFileSync(join(out, byId[s.capas.split(".")[0]])));
    const rec = pack.subarray(g.thumb[0], g.thumb[0] + g.thumb[1]);
    assert.ok((await C.decifrarRegistro(cat, rec)).length > 0);
  }
});

test("cifrar de novo: só o que mudou; arquivo removido sai de out", async () => {
  const { w, card } = cartao();
  const claro = join(w, "claro"), out = join(w, "out"), mapa = join(w, "mapa.json"), mestra = join(w, "mestra");
  execFileSync("python3", ["-I", join(ROOT, "data/mkmanifest.py"), card, claro]);
  run("mestra", "--mestra", mestra);
  run("cifrar", "--card", card, "--claro", claro, "--out", out, "--mapa", mapa, "--mestra", mestra);
  const antes = Object.fromEntries(readdirSync(out).map(f => [f, readFileSync(join(out, f)).toString("hex")]));
  const sai = JSON.parse(readFileSync(mapa, "utf8")).arquivos["/roms/psx/Disco.bin"].o;
  execFileSync("rm", [join(card, "roms/psx/Disco.bin")]);
  const log = run("cifrar", "--card", card, "--claro", claro, "--out", out, "--mapa", mapa, "--mestra", mestra);
  assert.match(log, /0 cifrados/);
  assert.ok(!existsSync(join(out, sai)));
  for (const f of readdirSync(out)) assert.equal(readFileSync(join(out, f)).toString("hex"), antes[f]);
});
```

Rodar: `node --test tests/test_cifrar.mjs` — Esperado: FALHA (`data/cifrar.mjs` não existe).

- [ ] **Passo 2: implementar `data/cifrar.mjs`**

```js
#!/usr/bin/env node
// cifrar.mjs - a biblioteca do cartão em arquivos opacos e cifrados para o Drive (spec 2026-10-20-acesso-cifrado).
// Formato: web/cripto.js. Lê o cartão só para leitura; o mapa (nomes reais -> opacos) fica fora da pasta que sobe.
//
//   node data/cifrar.mjs mestra   [--mestra F]
//   node data/cifrar.mjs cifrar   --card C --claro D --out O --mapa M [--mestra F]
//   node data/cifrar.mjs indice   --claro D --out O --mapa M --lsjson L [--mestra F]
//   node data/cifrar.mjs ponteiro --claro D --mapa M --lsjson L
//
// D = saída em claro do mkmanifest.py (modo hub, com --thumbs); L = rclone lsjson --hash da pasta do Drive.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, openSync, readSync, closeSync,
         writeSync, rmSync, chmodSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { gunzipSync, gzipSync } from "node:zlib";
import * as C from "../web/cripto.js";

const args = process.argv.slice(2), cmd = args[0];
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const MESTRA = opt("--mestra", join(homedir(), ".config/r36s/mestra"));
const FORA = /^(ports|themes|System Volume Information)$/;

function mestra({ criar = false } = {}) {
  if (!existsSync(MESTRA)) {
    if (!criar) throw new Error(`sem mestra em ${MESTRA} (rode: node data/cifrar.mjs mestra)`);
    mkdirSync(dirname(MESTRA), { recursive: true, mode: 0o700 });
    writeFileSync(MESTRA, Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64") + "\n", { mode: 0o600 });
    chmodSync(MESTRA, 0o600);
  }
  return new Uint8Array(Buffer.from(readFileSync(MESTRA, "utf8").trim(), "base64"));
}
const chaves = async m => {
  const cache = {};
  return async nome => cache[nome] || (cache[nome] = await C.derivar(m, nome));
};
const lerMapa = p => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : { arquivos: {}, capas: {}, indice: {} });
const gravar = (p, dados) => { writeFileSync(p + ".tmp", dados); renameSync(p + ".tmp", p); };
const library = claro => JSON.parse(gunzipSync(readFileSync(join(claro, "library.json.gz"))).toString());

// arquivos de <card>/roms que sobem (as mesmas exclusões do build/upload/sobe.sh)
function listar(card) {
  const out = [];
  const andar = (dir, v) => {
    for (const nome of readdirSync(dir).sort()) {
      if (nome.startsWith(".") || (v === "/roms" && FORA.test(nome)) || nome.endsWith(".log")) continue;
      const p = join(dir, nome), st = statSync(p);
      if (st.isDirectory()) andar(p, `${v}/${nome}`);
      else if (st.isFile()) out.push({ vpath: `${v}/${nome}`, real: p, size: st.size, mtime: Math.floor(st.mtimeMs) });
    }
  };
  andar(join(card, "roms"), "/roms");
  return out;
}

// cifra um arquivo do disco em streaming (bloco a bloco: ISOs de GB não passam pela memória inteiros)
async function cifrarDoDisco(chave, real, size, destino) {
  const n = C.nBlocos(size), buf = new Uint8Array(C.BLOCO), fi = openSync(real, "r"), fo = openSync(destino + ".tmp", "w");
  try {
    for (let i = 0; i < n; i++) {
      const len = Math.min(C.BLOCO, size - i * C.BLOCO);
      let lido = 0;
      while (lido < len) lido += readSync(fi, buf, lido, len - lido, i * C.BLOCO + lido);
      writeSync(fo, await C.cifrarBloco(chave, i, n, buf.subarray(0, len)));
    }
  } finally { closeSync(fi); closeSync(fo); }
  renameSync(destino + ".tmp", destino);
}

async function cifrar() {
  const card = opt("--card"), claro = opt("--claro"), out = opt("--out"), arqMapa = opt("--mapa");
  if (!card || !claro || !out || !arqMapa) throw new Error("uso: cifrar --card C --claro D --out O --mapa M");
  if (arqMapa.startsWith(out + "/")) throw new Error("o mapa tem os nomes reais: fora da pasta que sobe");
  mkdirSync(out, { recursive: true });
  const chave = await chaves(mestra()), nomes = await chave("nomes"), cat = await chave("catalogo");
  const lib = library(claro), antigo = lerMapa(arqMapa), mapa = { arquivos: {}, capas: {}, indice: antigo.indice || {} };
  const imagens = new Set(lib.games.flatMap(g => [g.box, g.shot]).filter(r => typeof r === "string" && r.startsWith("/")));
  let feitos = 0, bytes = 0;
  for (const f of listar(card)) {
    const k = imagens.has(f.vpath) ? "catalogo" : C.chaveDoCaminho(f.vpath);
    const o = await C.nomeOpaco(nomes, f.vpath), a = antigo.arquivos[f.vpath];
    mapa.arquivos[f.vpath] = { o, size: f.size, mtime: f.mtime, k };
    if (a && a.o === o && a.size === f.size && a.mtime === f.mtime && a.k === k && existsSync(join(out, o))) continue;
    await cifrarDoDisco(await chave(k), f.real, f.size, join(out, o));
    feitos++; bytes += f.size;
  }
  // miniaturas: cada recorte do pacote em claro vira um registro cifrado; offsets novos no mapa
  for (const s of lib.systems) {
    if (typeof s.capas !== "string" || !s.capas.startsWith("@capas/")) continue;
    const pacote = readFileSync(join(claro, s.capas.slice(1).split("?")[0]));
    const thumbs = {}, partes = [];
    let at = 0;
    for (const g of lib.games) {
      if (g.s !== s.id || !g.thumb) continue;
      const chaveT = g.thumb.join(",");
      if (thumbs[chaveT]) continue;
      const r = await C.cifrarRegistro(cat, pacote.subarray(g.thumb[0], g.thumb[0] + g.thumb[1]));
      thumbs[chaveT] = [at, r.length]; partes.push(r); at += r.length;
    }
    const o = await C.nomeOpaco(nomes, "capas:" + s.id);
    const dados = Buffer.concat(partes);
    if (!existsSync(join(out, o)) || !readFileSync(join(out, o)).equals(dados)) gravar(join(out, o), dados);
    mapa.capas[s.id] = { o, thumbs };
  }
  const validos = new Set([...Object.values(mapa.arquivos), ...Object.values(mapa.capas), ...Object.values(mapa.indice)].map(x => x.o));
  let apagados = 0;
  for (const f of readdirSync(out)) if (!validos.has(f)) { rmSync(join(out, f)); apagados++; }
  gravar(arqMapa, JSON.stringify(mapa));
  console.log(`${Object.keys(mapa.arquivos).length} arquivos, ${feitos} cifrados (${(bytes / 2 ** 20).toFixed(0)} MiB), ` +
              `${Object.keys(mapa.capas).length} pacotes de miniaturas, ${apagados} apagados de ${out}`);
}

// rclone lsjson -> {opaco: {id, v}}
const drive = ls => Object.fromEntries(JSON.parse(readFileSync(ls, "utf8")).filter(i => !i.IsDir)
  .map(i => [i.Path, { id: i.ID, v: ((i.Hashes || {}).md5 || (i.Hashes || {}).MD5 || "").slice(0, 10) }]));

async function indice() {
  const claro = opt("--claro"), out = opt("--out"), arqMapa = opt("--mapa"), ls = opt("--lsjson");
  if (!claro || !out || !arqMapa || !ls) throw new Error("uso: indice --claro D --out O --mapa M --lsjson L");
  const chave = await chaves(mestra()), nomes = await chave("nomes"), cat = await chave("catalogo");
  const mapa = lerMapa(arqMapa), ids = drive(ls), faltam = [];
  const ref = vpath => { const a = mapa.arquivos[vpath], d = a && ids[a.o]; if (a && !d) faltam.push(vpath); return d || null; };
  // manifest: IDs nos arquivos que o Drive serve; extra = arquivos das pastas fora do manifest (faixas .bin, BIOS)
  const manifest = JSON.parse(readFileSync(join(claro, "manifest.json"), "utf8"));
  for (const [vpath, e] of Object.entries(manifest.files)) {
    if (e.kind === "eager" || !vpath.startsWith("/roms/")) continue;
    const d = ref(vpath);
    if (d) { e.id = d.id; if (d.v) e.v = d.v; }
  }
  manifest.extra = {};
  for (const [vpath, a] of Object.entries(mapa.arquivos)) {
    if (manifest.files[vpath] || a.k === "catalogo") continue;
    const d = ref(vpath);
    if (d) manifest.extra[vpath] = { size: a.size, id: d.id };
  }
  // library: imagens e pacotes como "<id>.<v6>", miniaturas com os offsets dos registros cifrados
  const lib = library(claro);
  const curta = d => d.id + (d.v ? "." + d.v.slice(0, 6) : "");
  for (const s of lib.systems) {
    const c = mapa.capas[s.id], d = c && ids[c.o];
    if (d) s.capas = curta(d); else delete s.capas;
  }
  for (const g of lib.games) {
    for (const k of ["box", "shot"]) if (g[k]) { const d = ref(g[k]); if (d) g[k] = curta(d); else delete g[k]; }
    const c = mapa.capas[g.s];
    if (g.thumb && c && ids[c.o] && c.thumbs[g.thumb.join(",")]) g.thumb = c.thumbs[g.thumb.join(",")];
    else delete g.thumb;
  }
  const textos = {
    manifest: Buffer.from(JSON.stringify(manifest)),
    eager: readFileSync(join(claro, "eager.bin")),
    library: gzipSync(Buffer.from(JSON.stringify(lib)), { level: 9 }),
  };
  for (const [nome, dados] of Object.entries(textos)) {
    const o = await C.nomeOpaco(nomes, "indice:" + nome);
    gravar(join(out, o), await C.cifrarArquivo(cat, new Uint8Array(dados)));
    mapa.indice[nome] = { o, size: dados.length };
  }
  gravar(arqMapa, JSON.stringify(mapa));
  if (faltam.length) console.error(`aviso: ${faltam.length} arquivos sem ID no Drive (não subiram?), ex.: ${faltam.slice(0, 3).join(", ")}`);
  console.log(`índice cifrado: manifest ${textos.manifest.length} B, library ${textos.library.length} B, eager ${textos.eager.length} B`);
}

function ponteiro() {
  const claro = opt("--claro"), arqMapa = opt("--mapa"), ls = opt("--lsjson");
  if (!claro || !arqMapa || !ls) throw new Error("uso: ponteiro --claro D --mapa M --lsjson L");
  const mapa = lerMapa(arqMapa), ids = drive(ls), out = {};
  for (const nome of ["library", "manifest", "eager"]) {
    const i = mapa.indice[nome], d = i && ids[i.o];
    if (!d) throw new Error(`índice "${nome}" não está no Drive (rode indice e suba de novo)`);
    out[nome] = { id: d.id, v: d.v, size: i.size };
  }
  out.sistemas = [...new Set(Object.values(mapa.arquivos).map(a => a.k).filter(k => k.startsWith("sistema:")).map(k => k.slice(8)))].sort();
  const lib = library(claro);
  out.info = { systems: lib.systems.length, games: lib.games.length };
  process.stdout.write(JSON.stringify(out) + "\n");
}

const cmds = { mestra: () => { mestra({ criar: true }); console.log(`mestra em ${MESTRA}`); }, cifrar, indice, ponteiro };
if (!cmds[cmd]) { console.error(readFileSync(new URL(import.meta.url)).toString().split("\n").slice(1, 11).join("\n")); process.exit(1); }
await cmds[cmd]();
```

Observação para o executor: se o `mkmanifest.py` em claro não gerar `thumb` para o PNG de 1 px do teste, o `if
(g.thumb)` do teste cobre; não mudar o `mkmanifest.py` por causa disso. Se `mock_drive.py --lsjson` exigir uma pasta
com subpastas ou outro formato, ajustar só o teste (o formato é o do `rclone lsjson -R --hash`: `Path`, `ID`, `Size`,
`Hashes.md5`).

- [ ] **Passo 3: rodar** `node --test tests/test_cifrar.mjs tests/test_cripto.mjs` — Esperado: tudo passa.
- [ ] **Passo 4: commit**

```bash
git add data/cifrar.mjs tests/test_cifrar.mjs
git commit -m "cifrar.mjs: biblioteca do cartão em arquivos opacos e cifrados + índice cifrado"
```

---

### Tarefa 3: backend — migração e função `r36s` (repositório **biblioteca**)

**Files:**
- Create: `supabase/migrations/0003_r36s.sql`, `supabase/functions/_shared/r36s.js`, `supabase/functions/r36s/index.ts`, `tests/r36s.test.mjs`
- Modify: `supabase/functions/_shared/nucleo.js`, `tools/funcoes-local.mjs`, `tools/publicar.sh`

- [ ] **Passo 1: teste (falha)** — `tests/r36s.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { criarR36s, criarConta } from "../supabase/functions/_shared/nucleo.js";
import { derivar } from "../supabase/functions/_shared/r36s.js";
import { novoPar, b64 } from "../site/lib/cripto.js";

const hex = u => Buffer.from(u).toString("hex");
const mestra = Uint8Array.from({ length: 32 }, (_, i) => i);
const INDICE = { library: { id: "L", v: "1", size: 9 }, manifest: { id: "M", v: "1", size: 9 }, eager: { id: "E", v: "1", size: 9 },
                 sistemas: ["gba", "snes"], info: { systems: 2, games: 3 } };
function dbFalso(acessos) {
  const registro = [];
  return {
    registro,
    r36sSistemas: async email => acessos[email] || [],
    r36sIndice: async () => INDICE,
    r36sMestra: async () => b64(mestra),
    registrar: async (jogo, email, ok) => registro.push([jogo, email, ok]),
    pedidoDe: async email => (email === "pend@x.com" ? { status: "pendente" } : null),
  };
}
const quem = async t => ({ dono: "dono@x.com", fam: "fam@x.com", pend: "pend@x.com" })[t] || null;
const post = (h, tok, corpo, origem = "https://r36s-web.netlify.app") => h(new Request("http://x/r36s", {
  method: "POST", headers: { ...(tok ? { Authorization: "Bearer " + tok } : {}), "Content-Type": "application/json", Origin: origem },
  body: JSON.stringify(corpo) }));

test("HKDF igual ao do r36s (vetores fixos de r36s/tests/test_cripto.mjs)", async () => {
  assert.equal(hex(await derivar(mestra, "sistema:snes")), "50b722a3831e29f5f085f4b7fae749c2290e2f87a407e697b932afca2315b2d9");
  assert.equal(hex(await derivar(mestra, "catalogo")), "ad0a9b7103e748b6ac22f4498d330fe90b7bb640fcd34c3bf3c842c59a6d5c2f");
});

test("r36s: login, sem acesso (com o pedido), tudo, parcial, CORS", async () => {
  const db = dbFalso({ "dono@x.com": ["*"], "fam@x.com": ["snes", "nes"] });
  const h = criarR36s({ db, quem });
  const { publica } = await novoPar();
  assert.equal((await post(h, "", { publica })).status, 401);
  const sem = await post(h, "pend", { publica });
  assert.equal(sem.status, 403);
  assert.deepEqual(await sem.json(), { error: "acesso", pedido: { status: "pendente" } });
  const tudo = await (await post(h, "dono", { publica })).json();
  assert.deepEqual(tudo.sistemas, ["gba", "snes"]);
  assert.deepEqual(Object.keys(tudo.chaves).sort(), ["bios", "catalogo", "sistema:gba", "sistema:snes"]);
  assert.deepEqual(tudo.indice, INDICE);
  const r = await post(h, "fam", { publica });
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), "https://r36s-web.netlify.app");
  const parcial = await r.json();
  assert.deepEqual(parcial.sistemas, ["snes"]);                                   // "nes" não está no índice
  assert.deepEqual(Object.keys(parcial.chaves).sort(), ["bios", "catalogo", "sistema:snes"]);
  assert.deepEqual(db.registro.map(x => x[2]), [false, true, true]);
});

test("a chave entregue é a derivada (decifra com o cripto.js do r36s)", { skip: !existsSync(new URL("../../r36s/web/cripto.js", import.meta.url)) }, async () => {
  const R = await import("../../r36s/web/cripto.js");
  const h = criarR36s({ db: dbFalso({ "dono@x.com": ["*"] }), quem });
  const { privada, publica } = await R.novoPar();
  const body = await (await post(h, "dono", { publica })).json();
  assert.equal(hex(await R.desembrulharCru(privada, body.chaves["sistema:snes"])), hex(await R.derivar(mestra, "sistema:snes")));
});

test("conta?op=decidir aceita r36s:* e r36s:<sistema>", async () => {
  let decidido = null;
  const db = { ehAdmin: async e => e === "dono@x.com", decidir: async (email, status, jogos) => (decidido = { email, status, jogos }) };
  const h = criarConta({ db, quem });
  const r = await h(new Request("http://x/conta?op=decidir", { method: "POST", headers: { Authorization: "Bearer dono", "Content-Type": "application/json" },
    body: JSON.stringify({ email: "fam@x.com", acao: "aprovar", jogos: ["vena", "r36s:*", "r36s:pico-8", "r36s:../x", "x:y"] }) }));
  assert.equal(r.status, 200);
  assert.deepEqual(decidido.jogos, ["vena", "r36s:*", "r36s:pico-8"]);
});
```

Rodar: `node --test tests/r36s.test.mjs` — Esperado: FALHA (`criarR36s` não existe).

- [ ] **Passo 2: `supabase/functions/_shared/r36s.js`**

```js
// r36s.js - chaves do R36S Web: HKDF da mestra (Vault "r36s:mestra"), igual ao web/cripto.js do r36s
// (salt "r36s-web/v1", info "sistema:<id>" | "bios" | "catalogo").
const te = new TextEncoder();
export async function derivar(mestra, info) {
  const k = await crypto.subtle.importKey("raw", mestra, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: te.encode("r36s-web/v1"), info: te.encode(info) }, k, 256));
}
```

- [ ] **Passo 3: `nucleo.js`** — quatro mudanças:

1. Import: `import { derivar } from "./r36s.js";`
2. `ORIGENS` ganha `"https://r36s-web.netlify.app", "http://localhost:8770", "http://127.0.0.1:8770"`. O fallback de
   `Access-Control-Allow-Origin` continua o da biblioteca.
3. No `criarConta`, a validação dos jogos do `decidir`:

```js
const R36S = /^r36s:(\*|[A-Za-z0-9_.-]{1,40})$/;
// ...
const jogos = Array.isArray(corpo.jogos) ? corpo.jogos.map(String).filter((j) => j === "*" || ID.test(j) || R36S.test(j)) : [];
```

   e uma operação nova para o admin, antes do `return json(req, 404, { error: "op" })`:

```js
    if (op === "r36s" && req.method === "GET") {           // admin: os sistemas do R36S (para aprovar por sistema)
      const ind = await db.r36sIndice();
      return json(req, 200, { sistemas: (ind && ind.sistemas) || [] });
    }
```

4. Função nova, depois de `criarJogadas`:

```js
// "r36s": as chaves do R36S Web para quem foi aprovado (linhas "r36s:*" ou "r36s:<sistema>" em acesso; admin = tudo).
//   POST {publica: JWK} -> 200 {indice, sistemas, chaves: {catalogo, bios, "sistema:<id>": {publica, embrulhada}}}
//                        | 403 {error: "acesso", pedido: {status} | null} | 404 {error: "indice"}
// db: r36sSistemas(email) -> ["*"] | [ids], r36sIndice() -> {library, manifest, eager, sistemas, info} | null,
//     r36sMestra() -> base64, registrar(jogo, email, ok), pedidoDe(email)
export function criarR36s({ db, quem }) {
  return seguro(async (req) => {
    const { resposta, email } = await entrada(req, quem);
    if (resposta) return resposta;
    if (req.method !== "POST") return json(req, 405, { error: "method" });
    let corpo = {};
    try { corpo = await req.json(); } catch {}
    const pub = corpo.publica || {};
    if (typeof pub.x !== "string" || typeof pub.y !== "string") return json(req, 400, { error: "pedido" });
    const pode = await db.r36sSistemas(email);
    if (!pode.length) {
      await db.registrar("r36s", email, false);
      const p = await db.pedidoDe(email);
      return json(req, 403, { error: "acesso", pedido: p ? { status: p.status } : null });
    }
    const indice = await db.r36sIndice();
    if (!indice) return json(req, 404, { error: "indice" });
    const sistemas = pode.includes("*") ? indice.sistemas : indice.sistemas.filter((s) => pode.includes(s));
    const mestra = deB64(await db.r36sMestra());
    const chaves = {};
    try {
      for (const nome of ["catalogo", "bios", ...sistemas.map((s) => "sistema:" + s)])
        chaves[nome] = await embrulhar(await derivar(mestra, nome), pub);
    } catch { return json(req, 400, { error: "publica" }); }
    await db.registrar("r36s", email, true);
    return json(req, 200, { indice, sistemas, chaves });
  });
}
```

   No `dbSupabase`, três métodos:

```js
    r36sSistemas: (email) => rpc("r36s_sistemas", { p_email: email }),
    r36sIndice: async () => ((await rest("r36s_indice?select=indice&id=eq.1"))[0] || {}).indice || null,
    r36sMestra: () => rpc("r36s_mestra", {}),
```

- [ ] **Passo 4: `supabase/functions/r36s/index.ts`**

```ts
// Supabase Edge Function "r36s": as chaves do R36S Web (ver _shared/nucleo.js). Sem verificação de JWT: o
// Authorization leva o token do Google.
import { criarR36s, quemGoogle, dbSupabase } from "../_shared/nucleo.js";

const handler = criarR36s({
  db: dbSupabase(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!),
  quem: quemGoogle,
});
Deno.serve(handler);
```

- [ ] **Passo 5: `supabase/migrations/0003_r36s.sql`**

```sql
-- R36S Web no mesmo backend: a mestra no Vault ("r36s:mestra"), o ponteiro do índice cifrado no Drive e quem pode
-- abrir o quê (linhas "r36s:*" / "r36s:<sistema>" na tabela acesso; admins = tudo). Nada exposto pela API pública.
create table if not exists public.r36s_indice (
  id         int primary key default 1 check (id = 1),
  indice     jsonb not null,
  atualizado timestamptz not null default now()
);
alter table public.r36s_indice enable row level security;

create or replace function public.r36s_sistemas(p_email text) returns text[]
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.admins where email = lower(p_email)) then array['*']
    when exists (select 1 from public.acesso where email = lower(p_email) and jogo = 'r36s:*') then array['*']
    else coalesce((select array_agg(substr(jogo, 6) order by jogo) from public.acesso
                   where email = lower(p_email) and jogo like 'r36s:%'), '{}')
  end;
$$;

create or replace function public.r36s_mestra() returns text
language sql stable security definer set search_path = public, vault as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'r36s:mestra' limit 1;
$$;

create or replace function public.r36s_guardar_mestra(p_mestra text) returns void
language plpgsql security definer set search_path = public, vault as $$
declare v uuid;
begin
  select id into v from vault.secrets where name = 'r36s:mestra';
  if v is null then perform vault.create_secret(p_mestra, 'r36s:mestra', 'mestra do R36S Web');
  else perform vault.update_secret(v, p_mestra); end if;
end $$;

create or replace function public.r36s_publicar_indice(p_indice jsonb) returns void
language sql security definer set search_path = public as $$
  insert into public.r36s_indice (id, indice) values (1, p_indice)
  on conflict (id) do update set indice = excluded.indice, atualizado = now();
$$;

revoke all on function public.r36s_sistemas(text)          from public, anon, authenticated;
revoke all on function public.r36s_mestra()                from public, anon, authenticated;
revoke all on function public.r36s_guardar_mestra(text)    from public, anon, authenticated;
revoke all on function public.r36s_publicar_indice(jsonb)  from public, anon, authenticated;
grant execute on function public.r36s_sistemas(text), public.r36s_mestra() to service_role;
```

- [ ] **Passo 6: `tools/funcoes-local.mjs`** — rota `/functions/v1/r36s` com `criarR36s`, db em memória:
`r36sSistemas` = `tok-andre` → `["*"]`, demais pelas linhas `r36s:` do mesmo mapa de acessos em memória que a
`conta` usa; `r36sIndice` = JSON do arquivo `--r36s-indice` (ou null); `r36sMestra` = conteúdo de
`R36S_MESTRA` (arquivo, padrão `~/.config/r36s/mestra`) ou null; `registrar` = o `registro` existente. Seguir o
formato das rotas que já existem no arquivo.

- [ ] **Passo 7: `tools/publicar.sh`** — no `publicar_funcoes`, `functions deploy chave jogadas conta r36s`; e três
casos novos (no `case`, e no cabeçalho de uso):

```bash
  r36s-chave)
    # a mestra do R36S (~/.config/r36s/mestra, criada por `node data/cifrar.mjs mestra` no r36s) no Vault
    m=$(tr -d '\n' < "${R36S_MESTRA:-$HOME/.config/r36s/mestra}")
    sql "select public.r36s_guardar_mestra($(lit "$m"));" > /dev/null && echo "mestra do R36S no Vault" ;;
  r36s-indice)
    # o ponteiro do índice cifrado (saída do `cifrar.mjs ponteiro`)
    [ $# -ge 2 ] || { echo "uso: $0 r36s-indice <indice.json>"; exit 1; }
    python3 - "$2" > "$TMP/q.json" <<'PY'
import json, sys
lit = lambda s: "'" + s.replace("'", "''") + "'"
print(json.dumps({"query": f"select public.r36s_publicar_indice({lit(open(sys.argv[1]).read())}::jsonb);"}))
PY
    curl -sS -f -o /dev/null -X POST -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
      --data @"$TMP/q.json" "https://api.supabase.com/v1/projects/$SUPABASE_REF/database/query" && echo "índice do R36S no backend" ;;
  r36s-migrar)
    sql "$(cat supabase/migrations/0003_r36s.sql)" > /dev/null && echo "migração 0003 aplicada" ;;
```

- [ ] **Passo 8:** `npm test` — Esperado: tudo verde (os testes antigos e os novos). Commit:

```bash
git add supabase tools tests/r36s.test.mjs
git commit -m "r36s: chaves do R36S Web no mesmo backend (mestra no Vault, acesso por sistema)"
```

---

### Tarefa 4: admin — aprovar o R36S (repositório **biblioteca**)

**Files:** Modify `site/admin.js`, `site/lib/biblioteca.js` (função que chama `conta?op=r36s`), textos em `site/i18n/*`

- [ ] **Passo 1:** em `site/lib/biblioteca.js`, ao lado de `pedidos()`, exportar
`r36sSistemas = () => contaGet("r36s").then(r => r.sistemas)` usando o mesmo helper de `conta?op=` que `pedidos` usa.
- [ ] **Passo 2:** em `site/admin.js`, carregar a lista junto com os jogos
(`r36s = await r36sSistemas().catch(() => [])`) e, no bloco `.jogos-escolha` de cada pedido, uma segunda fieldset
"R36S" com `<input type=checkbox value="r36s:*">` (Tudo) e um checkbox `value="r36s:<id>"` por sistema; marcado se
`p.jogos` contém o valor (ou `r36s:*`). Os valores entram no mesmo `escolhidos` que já vai para `decidir`. A regra
"aprovar sem nada escolhido" continua valendo para o conjunto inteiro.
- [ ] **Passo 3:** chaves de texto novas (`admin.r36s`, `admin.r36sTudo`) em todos os idiomas de `site/i18n`.
- [ ] **Passo 4:** `npm test` e o `tests/e2e.mjs` da biblioteca (com `systemd-run ... MemoryMax=12G`) passam; abrir o
`admin.html` local (tools/servir.py) com `?mock=tok-andre` e tirar print da aprovação com o R36S para o controlador.
- [ ] **Passo 5:** commit `admin: aprovar acesso ao R36S (tudo ou por sistema)`.

---

### Tarefa 5: site — login com a função `r36s` e tela sem acesso (r36s)

**Files:**
- Create: `web/site/acesso.js`, `tests/mock_chaves.mjs`
- Modify: `web/site/config.js`, `web/site/site.js`, `web/site/site.css`, `tests/test_auth.mjs` ou novo `tests/test_acesso.mjs`

- [ ] **Passo 1: teste (falha)** — `tests/test_acesso.mjs`:

```js
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
```

- [ ] **Passo 2: `web/site/acesso.js`**

```js
// Acesso à biblioteca cifrada: o backend da biblioteca (Supabase h-games-web, função "r36s") confere o login do Google
// e devolve o ponteiro do índice no Drive e as chaves que esta conta pode usar (catálogo, BIOS, um por sistema),
// embrulhadas para um par ECDH feito agora. As chaves ficam só em memória (nunca em storage nem URL).
import { novoPar, desembrulharCru } from "../cripto.js";

// -> {id, name, kind, owner, index: {library, manifest, eager, sistemas, info}, sistemas, keys: {nome: Uint8Array}}
// erro: {status: 401 | 403 | 404 | 5xx, pedido: {status} | null}
export async function biblioteca({ funcoes, token, fetch = globalThis.fetch }) {
  const { privada, publica } = await novoPar();
  const r = await fetch(`${funcoes}/r36s`, { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
                                             body: JSON.stringify({ publica }) });
  const corpo = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(`chaves HTTP ${r.status}`), { status: r.status, pedido: corpo.pedido || null });
  const keys = {};
  for (const [nome, emb] of Object.entries(corpo.chaves || {})) keys[nome] = await desembrulharCru(privada, emb);
  return { id: "r36s", name: "R36S", kind: "shared", owner: { displayName: "André" }, index: corpo.indice, sistemas: corpo.sistemas || [], keys };
}

// pedido de acesso (mesma tabela da biblioteca; o dono aprova no admin.html dela) -> "pendente" | "aprovado"
export async function pedirAcesso({ funcoes, token, nome, mensagem, fetch = globalThis.fetch }) {
  const r = await fetch(`${funcoes}/conta?op=pedir`, { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
                                                       body: JSON.stringify({ nome, mensagem }) });
  if (!r.ok) throw Object.assign(new Error(`pedido HTTP ${r.status}`), { status: r.status });
  return (await r.json()).status;
}
```

- [ ] **Passo 3: `config.js`** — `funcoes: "https://grymbzwpukgauwoyttqc.supabase.co/functions/v1"` nos `defaults`;
remover `requestAccessUrl` (o pedido agora é pelo backend) e o comentário dele.

- [ ] **Passo 4: `site.js`** — trocar a descoberta de bibliotecas no Drive pela função:
  - `loadLibraries(force)`: no lugar de `drive.findLibraries()`, `app.libraries = [await biblioteca({ funcoes: cfg.funcoes,
    token: await auth.getToken(false) })]`. Erro com `status === 403` → `app.libraries = []; app.semAcesso = e.pedido`
    (null = nunca pediu); 401 → o mesmo caminho de login vencido que já existe; outro → `app.error` com
    "Servidor de chaves indisponível" e o botão de tentar de novo que a tela já tem.
  - `renderLibraries()`: com `app.semAcesso !== undefined` e nenhuma biblioteca, chama `renderSemAcesso(box)`; com uma
    biblioteca, mostra o cartão que já existe (título via `ownerName`: "Biblioteca de André"; `libMeta` lê
    `lib.index.info`, que tem `systems`/`games`).
  - Remover o que só servia às pastas do Drive: `createLibrary`/`renderNone`/`ownHint`, o "lembrar" (`REMEMBER`) e os
    textos sobre `R36S/.web`. `drive.js` mantém `findLibraries`/`libraryIndex` só se ainda forem usados por testes;
    senão sai também (apagar junto os testes que só testavam isso).
  - `renderSemAcesso(box)`: título "Sem acesso à biblioteca"; texto conforme `app.semAcesso`: null → formulário (nome,
    mensagem opcional, botão "Pedir acesso" → `pedirAcesso(...)` → mostra "Pedido enviado. Assim que o André aprovar,
    é só entrar de novo."); `pendente` → "Seu pedido está aguardando aprovação."; `recusado` → "O pedido não foi
    aprovado.". Em todos: botão "Tentar de novo" (`loadLibraries(true)`) e link para o demo (`#/demo`). Usar o helper
    `h(...)` e as classes visuais já usadas na tela da biblioteca; estilos novos mínimos em `site.css`.

- [ ] **Passo 5: `tests/mock_chaves.mjs`** — servidor local com o contrato da função (para os e2e do r36s):

```js
// node tests/mock_chaves.mjs <porta> --mestra <arquivo> --indice <indice.json>
// Backend local com o contrato da função "r36s" e de "conta?op=pedir" (o de verdade: biblioteca, supabase/functions).
// Tokens (os do tests/mock_drive.py): tok-shared = tudo, tok-own = só snes, tok-none = sem acesso (pode pedir),
// tok-both = pedido pendente. Inspeção: GET /_mock/pedidos.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import * as C from "../web/cripto.js";

const args = process.argv.slice(2), opt = n => args[args.indexOf(n) + 1];
const porta = Number(args[0]);
const mestra = new Uint8Array(Buffer.from(readFileSync(opt("--mestra"), "utf8").trim(), "base64"));
const indice = JSON.parse(readFileSync(opt("--indice"), "utf8"));
const PODE = { "tok-shared": ["*"], "tok-own": ["snes"] };
const pedidos = { "tok-both": "pendente" };
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };

createServer(async (req, res) => {
  const fim = (status, corpo) => { res.writeHead(status, { ...cors, "Content-Type": "application/json" }); res.end(JSON.stringify(corpo)); };
  if (req.method === "OPTIONS") return res.writeHead(204, cors), res.end();
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/_mock/pedidos") return fim(200, pedidos);
  const tok = (req.headers.authorization || "").replace(/^Bearer /, "");
  if (!tok.startsWith("tok-")) return fim(401, { error: "login" });
  let corpo = "";
  for await (const c of req) corpo += c;
  const dados = corpo ? JSON.parse(corpo) : {};
  if (url.pathname.endsWith("/conta") && url.searchParams.get("op") === "pedir") return fim(200, { status: (pedidos[tok] = "pendente") });
  if (!url.pathname.endsWith("/r36s")) return fim(404, { error: "op" });
  const pode = PODE[tok];
  if (!pode) return fim(403, { error: "acesso", pedido: pedidos[tok] ? { status: pedidos[tok] } : null });
  const sistemas = pode.includes("*") ? indice.sistemas : indice.sistemas.filter(s => pode.includes(s));
  const chaves = {};
  for (const n of ["catalogo", "bios", ...sistemas.map(s => "sistema:" + s)]) chaves[n] = await C.embrulhar(await C.derivar(mestra, n), dados.publica);
  fim(200, { indice, sistemas, chaves });
}).listen(porta, "127.0.0.1", () => console.log(`mock_chaves em ${porta}`));
```

- [ ] **Passo 6:** `node --test tests/test_acesso.mjs tests/test_cripto.mjs` e `node tests/test_auth.mjs` passam.
Commit: `site: chaves pelo backend da biblioteca (função r36s); tela sem acesso com pedido`.

---

### Tarefa 6: `io.js` decifrando no backend `drive` (r36s)

**Files:** Modify `web/io.js`, `tests/test_app.mjs`

A biblioteca (`site.library`) agora é `{index: {library, manifest, eager: {id, v, size}, sistemas, info}, keys}`.

- [ ] **Passo 1: testes (falham)** — em `tests/test_app.mjs`, a seção do backend `drive` (perto de `const drv =
createIO({ backend: "drive", ...`) passa a montar um Drive falso **cifrado** com `web/cripto.js`:

```js
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
const f = cif.fetchFrom("https://site/web/index.html");
// arquivo inteiro e intervalo cruzando blocos
assert.deepEqual(new Uint8Array(await (await f("fs/roms/snes/J.sfc")).arrayBuffer()), romTexto);
const r = await f("fs/roms/snes/J.sfc", { headers: { Range: `bytes=${C.BLOCO - 3}-${C.BLOCO + 4}` } });
assert.equal(r.status, 206);
assert.deepEqual(new Uint8Array(await r.arrayBuffer()), romTexto.subarray(C.BLOCO - 3, C.BLOCO + 5));
assert.deepEqual(pedidosT.at(-1), ["rom", [0, 2 * C.CIFRADO - 1]]);
// sistema sem chave -> 403; canOpen
assert.equal((await f("fs/roms/gba/X.gba")).status, 403);
assert.equal(cif.canOpen("snes"), true);
assert.equal(cif.canOpen("gba"), false);
// capa e miniatura decifradas
assert.deepEqual(new Uint8Array(await (await fetch(await cif.image("capa.abc123"))).arrayBuffer()), capaT);
assert.deepEqual(new Uint8Array(await (await fetch(await cif.thumb("pacote.abc123", 0, arquivosT.pacote.length))).arrayBuffer()), thumbT);
// bloco adulterado -> 502
arquivosT.rom[50] ^= 1;
assert.equal((await f("fs/roms/snes/J.sfc", { headers: { Range: "bytes=0-9" } })).status, 502);
arquivosT.rom[50] ^= 1;
```

Os testes antigos do backend `drive` em claro (`media` devolvendo bytes crus, imagens `"<id>.<v>"` em claro) são
substituídos por estes; hub e demo continuam como estão. O `readSync` usa XHR síncrono (não existe no Node): fica
para o e2e (Tarefa 8).

Rodar: `node tests/test_app.mjs` — Esperado: FALHA.

- [ ] **Passo 2: implementar no `io.js`** (só o backend `drive`; hub e demo intocados)

  - Import: `import { faixa, chaveDoCaminho, decifrarIntervalo, decifrarIntervaloSync, decifrarArquivo, decifrarRegistro } from "./cripto.js";`
  - Cabeçalho do arquivo: a linha do `drive` passa a dizer "biblioteca cifrada (spec 2026-10-20-acesso-cifrado): índice
    pelo backend, arquivos opacos no Drive decifrados aqui; cache guarda o cifrado".
  - Chaves: `const keys = (library && library.keys) || null; const keyOf = vpath => (keys && keys[chaveDoCaminho(vpath)]) || null;`
  - `driveFile(vpath, e, init)` (o ramo `eager` fica igual; sai o ramo `cacheable` de imagens/temas — imagens vêm pelo
    `image()`, temas não existem mais):

```js
    if (!e.id) return notFound();
    const k = keyOf(vpath);
    if (!k) return resp(null, 403);
    if (init.method === "HEAD") return resp(null, 200, { "Content-Length": String(e.size) });
    if (!e.size) return resp(new Uint8Array(0), 200, { "Content-Length": "0" });
    const range = init.headers && (init.headers.Range || init.headers.range);
    const m = range && /bytes=(\d+)-(\d*)/.exec(range);
    const de = m ? +m[1] : 0, ate = Math.min(e.size - 1, m && m[2] ? +m[2] : e.size - 1);
    if (de > ate) return resp(null, 416, { "Content-Range": `bytes */${e.size}` });
    const fx = faixa(de, ate, e.size);
    const r = await drive.media(e.id, { range: [fx.cDe, fx.cAte], signal: init.signal });
    stats.media++;
    if (!r.ok) return resp(null, r.status === 404 ? 404 : 502);
    let c = new Uint8Array(await r.arrayBuffer());
    if (r.status === 200 && c.length > fx.cAte - fx.cDe + 1) c = c.subarray(fx.cDe, fx.cAte + 1);   // Range ignorado
    let t;
    try { t = await decifrarIntervalo(k, c, de, ate, e.size); }
    catch (err) { console.warn("[io] bloco não confere", vpath, err); return resp(null, 502); }
    stats.bytes += c.length;
    return m ? resp(t, 206, { "Content-Length": String(t.length), "Content-Range": `bytes ${de}-${ate}/${e.size}` })
             : resp(t, 200, { "Content-Length": String(t.length) });
```

  - `indexFile(ref)` recebe o objeto `{id, v}` do índice: chave do cache `.../index/${ref.id}/${ref.v}`, guarda o
    **cifrado** e devolve `resp(await decifrarArquivo(keys.catalogo, buf), 200)` (falha da tag → status 502, apagando a
    entrada do cache). `driveManifest`/`driveEager` passam `library.index.manifest` / `library.index.eager`; a rota de
    `data/library.json.gz` passa `library.index.library`.
  - `image(ref)` no Drive: o `cached(...)` continua baixando e guardando o **cifrado**; depois
    `URL.createObjectURL(new Blob([await decifrarArquivo(keys.catalogo, new Uint8Array(await r.arrayBuffer()))]))`.
    Mudar o `blobUrl` para aceitar a decifra: `const blobDe = async (r, decifra, type) => URL.createObjectURL(new Blob([await decifra(new Uint8Array(await r.arrayBuffer()))], { type }))`.
  - `thumb(pack, off, len)` no Drive: igual a hoje (Range, `exact(len)` no registro cifrado, cache do cifrado); no fim
    `decifrarRegistro(keys.catalogo, ...)` com type `image/webp`.
  - Novo `io.canOpen(systemId)`: `backend !== "drive" || !!(keys && keys["sistema:" + systemId])`.
  - Novo `io.readSync(vpath, de, ate)` (o `lazyFile` do player; XHR síncrono como o de hoje):

```js
    // leitura síncrona [de, ate] de um arquivo do cartão (lazyFile do player, dentro do fread do núcleo): blocos
    // cifrados por XHR síncrono + AES-GCM síncrono. Só no Drive.
    readSync(vpath, de, ate) {
      const e = entryOf(vpath), k = keyOf(vpath);
      if (!e || !e.id || !k) throw Object.assign(new Error(`sem acesso a ${vpath}`), { status: 403 });
      ate = Math.min(ate, e.size - 1);
      const fx = faixa(de, ate, e.size);
      const x = new XMLHttpRequest();
      x.open("GET", drive.mediaUrl(e.id), false);
      x.setRequestHeader("Range", `bytes=${fx.cDe}-${fx.cAte}`);
      x.setRequestHeader("Authorization", drive.authHeader());
      x.overrideMimeType("text/plain; charset=x-user-defined");
      x.send();
      if (x.status !== 206 && x.status !== 200) throw Object.assign(new Error(`HTTP ${x.status}`), { status: x.status });
      const s = x.responseText;
      let c = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) c[i] = s.charCodeAt(i) & 0xff;
      if (x.status === 200 && c.length > fx.cAte - fx.cDe + 1) c = c.subarray(fx.cDe, fx.cAte + 1);
      stats.media++; stats.bytes += c.length;
      return decifrarIntervaloSync(k, c, de, ate, e.size);
    },
```

  - `xhrFrom`: sai o ramo que apontava `fs/` do Drive direto para `drive.mediaUrl` (o `_r36sAuth` some junto); o
    `lazyFile` usa `readSync`.
  - Novo `io.lerPedacos(vpath, { signal, passo = 8 << 20 })` (async generator para o ⬇ ROM): `await loadIndex()`, pega a
    entrada (`manifest.files` ou `manifest.extra`), e para cada `[de, de + passo - 1]` chama `driveFile` com `Range` e o
    `signal`, `yield` dos bytes; status ≠ 206/200 lança `Error` com `status`.
  - `pruneThumbs`: sem mudança de lógica (as chaves de cache não mudaram de formato).

- [ ] **Passo 3:** `node tests/test_app.mjs` — Esperado: passa (incluindo hub/demo). Commit:
`io.js: biblioteca cifrada no backend drive (decifra por bloco, readSync, canOpen)`.

---

### Tarefa 7: player, ⬇ ROM e sistemas sem acesso (r36s)

**Files:** Modify `web/retroarch/play.js`, `web/app/download.js`, `web/app/main.js`, `tests/download.mjs`

- [ ] **Passo 1: `play.js` `lazyFile`** — o pedaço vem do `io.readSync` quando o arquivo é do cartão e o backend é o
Drive. Dentro de `lazyFile`, antes de `const chunks`:

```js
  // Drive (biblioteca cifrada): o io decifra o pedaço (XHR síncrono + AES-GCM síncrono); hub/demo/assets: XHR direto
  const vp = io && io.backend === "drive" && io.readSync && url.startsWith("../fs/")
    ? url.slice(5).split("/").map(decodeURIComponent).join("/") : null;
```

e no início do `get` (depois do `if (c) return c;` e do cálculo de `from`/`to`):

```js
    if (vp) {
      try { c = io.readSync(vp, from, to); }
      catch (e) { console.warn("[play] leitura falhou", vp, e.status || e.message); throw new FS.ErrnoError(29); }
      chunks.set(i, c);
      lazyStats.requests++; lazyStats.bytes += c.length;
      return c;
    }
```

Atualizar o comentário do `lazyFile` (uma linha: "no Drive, o pedaço vem decifrado pelo io.readSync").

- [ ] **Passo 2: `download.js`** — reescrever o ramo `drive` (hub/demo iguais):

```js
// ⬇ ROM: salva o arquivo da ROM (para outro emulador ou para o R36S de verdade). Hub/demo: link direto. Drive
// (biblioteca cifrada): o io baixa e decifra em pedaços de 8 MB; até BLOB_MAX junta num blob; acima, grava direto no
// disco onde o navegador deixa escolher o arquivo (showSaveFilePicker, PC); no celular, acima disso, não dá.
const BLOB_MAX = 100 << 20;
// ...
// -> "link" | "blob" | "arquivo"
export async function downloadRom(io, g, onProgress, signal) {
  const name = g.rom.slice(g.rom.lastIndexOf("/") + 1);
  if (io.backend !== "drive") { save(io.romUrl(g.rom), name); return "link"; }
  if (g.size > BLOB_MAX && !window.showSaveFilePicker)
    throw new Error("arquivo grande demais para baixar pelo navegador do celular (mais de 100 MB)");
  let got = 0;
  if (g.size > BLOB_MAX) {
    const h = await window.showSaveFilePicker({ suggestedName: name });
    const w = await h.createWritable();
    try {
      for await (const p of io.lerPedacos(g.rom, { signal })) { await w.write(p); got += p.length; onProgress(got, g.size); }
      await w.close();
    } catch (e) { await w.abort().catch(() => {}); throw e; }
    return "arquivo";
  }
  const parts = [];
  for await (const p of io.lerPedacos(g.rom, { signal })) { parts.push(p); got += p.length; onProgress(got, g.size); }
  const url = URL.createObjectURL(new Blob(parts, { type: "application/octet-stream" }));
  save(url, name);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return "blob";
}
```

Ajustar quem trata o retorno `"drive"` (a ficha: `web/app/sheet.js` ou `main.js`, `grep -n '"drive"' web/app`) para
`"arquivo"` (mensagem "Salvo.") e mostrar a mensagem do erro do celular na ficha. Atualizar `tests/download.mjs` para
o Drive simulado cifrado (Tarefa 8 monta o ambiente; aqui, trocar as asserções de "abre a página do Drive" pelas novas).

- [ ] **Passo 3: `main.js`** — depois de `lib = createLibrary(JSON.parse(text))` (linha ~45), antes de desenhar:

```js
  // biblioteca cifrada com acesso parcial: sistema sem chave aparece apagado, com o motivo na ficha
  if (io.canOpen) for (const s of lib.systems || []) if (!io.canOpen(s.id)) { s.playable = false; s.note = "Sem acesso a este sistema"; }
```

(Se `createLibrary` copiar os sistemas, aplicar nos objetos que as telas usam — conferir em `web/app/library.js`.)

- [ ] **Passo 4:** `node tests/test_app.mjs` passa. Commit: `player, ⬇ ROM e seletor com a biblioteca cifrada`.

---

### Tarefa 8: ponta a ponta com Drive simulado cifrado (r36s)

**Files:** Create `tests/cifrado_fixture.mjs`; Modify `tests/e2e_site.mjs`, `tests/download.mjs`, `tests/drive_boot.mjs` (cabeçalho), `tests/mock_drive.py` se preciso

- [ ] **Passo 1: `tests/cifrado_fixture.mjs`** — função exportada `montar(work, card)`:
`mkmanifest.py card claro --thumbs`, `cifrar.mjs mestra/cifrar` (mestra em `work/mestra`, mapa em `work/mapa.json`,
saída `work/dados`), `mock_drive.py --lsjson work/dados`, `cifrar.mjs indice`, lsjson de novo, `cifrar.mjs ponteiro >
work/indice.json`. Devolve `{ dados, mestra, indice }`.
- [ ] **Passo 2: `e2e_site.mjs`** — onde hoje monta a biblioteca em claro para o `mock_drive.py` (linhas ~41-44 e
~341-344), usar `montar(...)` e subir o `mock_drive.py <porta> --library work/dados` (sem `--index`: o índice vem do
backend) e o `node tests/mock_chaves.mjs <porta2> --mestra ... --indice ...`; `R36S_CONFIG` ganha
`funcoes: "http://127.0.0.1:<porta2>"`. Se o `mock_drive.py` restringir `alt=media` por usuário/biblioteca, liberar
os arquivos da pasta `--library` para todos os tokens `tok-*` (a pasta é compartilhada por link).
  Cenários (os que já existem continuam, adaptados):
  1. `tok-shared`: seletor, capas e miniaturas aparecem; jogar um jogo pequeno (ROM inteira) e voltar; ⬇ ROM de um
     jogo pequeno (blob, md5 do arquivo salvo = md5 da ROM no cartão falso).
  2. Jogo grande sob demanda: o mesmo cenário PSP na aba isolada que já existe (ROM acima do `EAGER_MAX`, lida pelo
     `lazyFile` → `readSync`), até `r36s-started`.
  3. `tok-own`: o sistema que não é `snes` aparece apagado com "Sem acesso a este sistema".
  4. `tok-none`: tela "Sem acesso à biblioteca", envia o pedido, `/_mock/pedidos` mostra `pendente`.
  5. Varredura: nenhum nome de jogo/sistema do cartão falso (só textos de 5+ letras) nos nomes nem no conteúdo de
     `work/dados`.
- [ ] **Passo 3:** rodar com `systemd-run --user --scope -q -p MemoryMax=12G env E2E_TIMEOUT=600 node tests/e2e_site.mjs`
e `... node tests/download.mjs`, `nav_pad.mjs`, `perf_home.mjs` (mesmos números de antes, ± ruído; anotar). Conferir o
save do DK3 (regra do topo).
- [ ] **Passo 4:** `drive_boot.mjs` mede a biblioteca **real**: atualizar o cabeçalho dizendo que agora precisa do
backend real e do índice publicado (Tarefa 10) e que o token do rclone dá 403 de cota — não rodar aqui.
- [ ] **Passo 5:** commit `testes: e2e com a biblioteca cifrada (Drive simulado + backend local)`.

---

### Tarefa 9: subida e documentação (r36s)

**Files:** Modify `build/upload/sobe.sh` (gitignored, não entra no commit), `docs/deploy.md`

- [ ] **Passo 1: `sobe.sh`** reescrito para a pasta cifrada (o controlador revisa; **não rodar**):

```bash
#!/bin/bash
# Sobe a biblioteca CIFRADA (spec 2026-10-20-acesso-cifrado) para gdrive:R36S-dados e grava o ponteiro do índice no
# backend. Cartão só leitura. Escreve no Drive e no Supabase: rodar só com o ok do andre.
set -u
cd "$(dirname "$0")/../.."
W=build/upload
D=gdrive:R36S-dados
R=(--transfers 6 --checkers 8 --drive-chunk-size 64M --tpslimit 8 --stats 60s --stats-one-line --log-level INFO)
BIB=/home/andre/Workspace/web-ports/biblioteca

echo "== 1 índice em claro (local) $(date +%H:%M)"
rm -rf $W/claro && python3 data/mkmanifest.py card $W/claro --thumbs $W/capas-cache 2>&1 | tail -3 || exit 1
echo "== 2 cifrar $(date +%H:%M)"
node data/cifrar.mjs cifrar --card card --claro $W/claro --out $W/dados --mapa $W/mapa.json || exit 1
echo "== 3 subir $(date +%H:%M)"
rclone sync $W/dados $D "${R[@]}" --log-file $W/r-dados.log; echo exit=$?
rclone lsjson --hash --files-only $D > $W/ls.json 2>/dev/null || exit 1
echo "== 4 índice cifrado $(date +%H:%M)"
node data/cifrar.mjs indice --claro $W/claro --out $W/dados --mapa $W/mapa.json --lsjson $W/ls.json || exit 1
rclone copy $W/dados $D "${R[@]}" --log-file $W/r-indice.log
rclone lsjson --hash --files-only $D > $W/ls.json 2>/dev/null || exit 1
node data/cifrar.mjs ponteiro --claro $W/claro --mapa $W/mapa.json --lsjson $W/ls.json > $W/indice.json || exit 1
echo "== 5 ponteiro no backend $(date +%H:%M)"
"$BIB/tools/publicar.sh" r36s-indice "$PWD/$W/indice.json"
echo "== fim $(date +%H:%M)"
```

Notas: `rclone sync` (e não `copy`) para que arquivo removido do cartão saia do Drive — **só na pasta
`R36S-dados`**. O `mapa.json` tem os nomes reais e fica só no disco (`build/upload` é gitignored).

- [ ] **Passo 2: `docs/deploy.md`** — trocar o desenho "Google Drive do andre: R36S/ (= cartão)…" pelo novo:
`R36S-dados/` (arquivos opacos, link "qualquer pessoa com o link: leitor"), backend da biblioteca (função `r36s`,
`r36s_indice`, Vault `r36s:mestra`), aprovação no `admin.html` da biblioteca, `sobe.sh`, e a seção de pedido de
acesso (no lugar do `requestAccessUrl`). Remover o passo de compartilhar a pasta por e-mail.
- [ ] **Passo 3:** commit `deploy: biblioteca cifrada (R36S-dados + backend da biblioteca)`.

---

### Tarefa 10: colocar no ar (SÓ o controlador; cada item com ok explícito do andre)

- [ ] 1. Biblioteca: `tools/publicar.sh r36s-migrar` e `tools/publicar.sh funcoes` (deploy de `chave jogadas conta r36s`).
      Conferir `curl -s -o /dev/null -w '%{http_code}' -X POST .../functions/v1/r36s` = 401.
- [ ] 2. `node data/cifrar.mjs mestra` (local) e `tools/publicar.sh r36s-chave`. Fazer cópia da mestra (onde o andre
      guardar segredos); sem ela, a biblioteca no Drive não abre mais.
- [ ] 3. `tools/publicar.sh acesso mr.andre.rt0@gmail.com r36s:*` (o andre também é admin; a linha é para o teste
      de não-admin ficar fácil depois).
- [ ] 4. `bash build/upload/sobe.sh` (~38,6 GiB, horas). Depois: `rclone link gdrive:R36S-dados` (link de leitor).
- [ ] 5. Site: `bash build/site-dist.sh` + `netlify-deploy.py` + md5 com curl (fluxo de sempre). O site novo só lê
      a pasta cifrada; a `R36S/` antiga continua lá, intocada.
- [ ] 6. A54: login, seletor com capas, rolar, busca, ficha, jogar (pequeno e PSP), voltar, ⬇ ROM pequena; conta sem
      acesso pede acesso; aprovar no `admin.html` e entrar de novo.
- [ ] 7. GitHub: sincronizar os commits do r36s pelo fluxo de sempre (sed do `From:`, `grep -ci <empresa>` = 0).
      Conferir que nada de `build/upload` (mapa, mestra) entrou.
- [ ] 8. Só depois do A54 ok e com ok separado: apagar `gdrive:R36S` (em claro).
