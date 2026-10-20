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
