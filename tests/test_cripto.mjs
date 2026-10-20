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
