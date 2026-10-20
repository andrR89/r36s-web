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
// PNG de verdade (300x400 RGB, com ruído para não ficar minúsculo): o mkmanifest só gera miniatura de imagem válida
const PNG = execFileSync("python3", ["-I", "-c",
  ["import sys,io,random", "from PIL import Image", "random.seed(1)",
   "im=Image.frombytes('RGB',(300,400),bytes(random.randrange(256) for _ in range(360000)))",
   "b=io.BytesIO(); im.save(b,'PNG'); sys.stdout.buffer.write(b.getvalue())"].join("\n")]);

function cartao() {
  const w = mkdtempSync(join(tmpdir(), "cifrar-")), card = join(w, "card");
  const put = (p, d) => { mkdirSync(dirname(join(card, p)), { recursive: true }); writeFileSync(join(card, p), d); };
  put("etc/emulationstation/es_systems.cfg", SYSTEMS);
  put("roms/snes/gamelist.xml", GAMELIST);
  put("roms/snes/Donkey.sfc", Buffer.alloc(3 * C.BLOCO + 7, 1));
  put("roms/snes/images/dk.png", PNG);
  put("roms/psx/Disco.cue", 'FILE "Disco.bin" BINARY\n');
  put("roms/psx/Disco.bin", Buffer.from("BIN"));
  put("roms/psx/Disco.sbi", Buffer.from("SBI"));                              // fora das extensões: apoio lazy (files) ou extra
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
  assert.ok((manifest.files["/roms/psx/Disco.sbi"] || manifest.extra["/roms/psx/Disco.sbi"])?.id);   // apoio no topo da pasta: lazy em files
  const g = library.games.find(x => x.rom === "/roms/snes/Donkey.sfc");
  assert.match(g.box || g.shot, /^[^/.]+\.[0-9a-f]{6}$/);                       // imagem: "<id>.<v6>"
  const s = library.systems.find(x => x.id === "snes");
  assert.ok(g.thumb && s.capas, "miniatura e pacote de capas existem");
  const pack = new Uint8Array(readFileSync(join(out, byId[s.capas.split(".")[0]])));
  const rec = pack.subarray(g.thumb[0], g.thumb[0] + g.thumb[1]);
  const webp = await C.decifrarRegistro(cat, rec);
  assert.equal(Buffer.from(webp.subarray(0, 4)).toString("latin1"), "RIFF");   // WebP
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
