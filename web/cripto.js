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
