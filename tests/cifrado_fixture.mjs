// Biblioteca cifrada de teste (e2e_site.mjs, download.mjs): cartão falso -> mkmanifest (claro) -> cifrar.mjs -> pasta
// plana de arquivos opacos servida pelo tests/mock_drive.py + backend de chaves local (tests/mock_chaves.mjs).
// A mestra é sempre a do diretório de trabalho (nunca a ~/.config/r36s/mestra de verdade).
import { mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync, copyFileSync, truncateSync } from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEMO = join(ROOT, "web/site/demo/fs");
export const PSP_CARD = "/run/media/andre/EASYROMS/psp", PSP_GAME = "Circles, Circles, Circles (USA).cso";
// a ROM de PSP é copiada com zeros no fim até passar do EAGER_MAX do player (48 MB): o CSO tem índice próprio e ignora
// o que vem depois, e assim ela é lida sob demanda (lazyFile -> io.readSync), o caminho que só o navegador exercita.
// truncate estende sem gravar (arquivo esparso); só a cópia cifrada ocupa os 52 MB.
const PSP_PAD = 52 << 20;
export const SNES_ROM = "/roms/snes/Sonho Teste (BR).sfc";

// cartão falso: o demo (gbc, nes; com capas) + um snes de mentira (só para o acesso parcial: tok-own = só snes)
// + o PSP do cartão de verdade se estiver montado (psp: true). Devolve os caminhos virtuais criados.
export function cartao(dir, { psp = false } = {}) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "roms/snes"), { recursive: true });
  mkdirSync(join(dir, "etc/emulationstation"), { recursive: true });
  for (const d of ["gbc", "nes"]) symlinkSync(join(DEMO, "roms", d), join(dir, "roms", d));
  writeFileSync(join(dir, SNES_ROM), Buffer.alloc(256 << 10, 0x5a));
  const sys = (name, full, ext, extra = "") => `\t<system>\n\t\t<name>${name}</name>\n\t\t<fullname>${full}</fullname>\n\t\t<path>/roms/${name}/</path>\n` +
    `\t\t<extension>${ext}</extension>\n\t\t<command>/usr/local/bin/retroarch %ROM%</command>\n\t\t<platform>${name}</platform>\n\t\t<theme>${name}</theme>\n${extra}\t</system>\n`;
  let extra = sys("snes", "Super Nintendo", ".sfc .SFC .smc .SMC");
  let pspRom = null;
  if (psp && existsSync(join(PSP_CARD, PSP_GAME))) {
    mkdirSync(join(dir, "roms/psp"), { recursive: true });
    const p = join(dir, "roms/psp", PSP_GAME);
    copyFileSync(join(PSP_CARD, PSP_GAME), p);
    truncateSync(p, PSP_PAD);
    extra += sys("psp", "PSP", ".iso .ISO .cso .CSO");
    pspRom = "/roms/psp/" + PSP_GAME;
  }
  writeFileSync(join(dir, "etc/emulationstation/es_systems.cfg"),
    readFileSync(join(DEMO, "etc/emulationstation/es_systems.cfg"), "utf8").replace("</systemList>", extra + "</systemList>"));
  return { pspRom };
}

// cartão -> work/claro (mkmanifest, modo hub, com miniaturas) -> work/dados (cifrados) -> índice cifrado -> ponteiro
// (work/indice.json, o que o backend entrega). -> { dados, mestra, indice }
export function montar(work, card) {
  const p = n => join(work, n);
  for (const n of ["claro", "dados", "thumbs", "mestra", "mapa.json", "ls.json", "indice.json"]) rmSync(p(n), { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const py = (...a) => execFileSync("python3", ["-I", ...a], { maxBuffer: 64 << 20 });
  const cif = (...a) => execFileSync("node", [join(ROOT, "data/cifrar.mjs"), ...a, ...(a[0] === "ponteiro" ? [] : ["--mestra", p("mestra")])],
    { encoding: "utf8", maxBuffer: 64 << 20 });
  const ls = () => writeFileSync(p("ls.json"), py(join(ROOT, "tests/mock_drive.py"), "--lsjson", p("dados")));
  py(join(ROOT, "data/mkmanifest.py"), card, p("claro"), "--thumbs", p("thumbs"));
  cif("mestra");
  cif("cifrar", "--card", card, "--claro", p("claro"), "--out", p("dados"), "--mapa", p("mapa.json"));
  ls();
  cif("indice", "--claro", p("claro"), "--out", p("dados"), "--mapa", p("mapa.json"), "--lsjson", p("ls.json"));
  ls();
  writeFileSync(p("indice.json"), cif("ponteiro", "--claro", p("claro"), "--mapa", p("mapa.json"), "--lsjson", p("ls.json")));
  return { dados: p("dados"), mestra: p("mestra"), indice: p("indice.json") };
}

const freePort = () => new Promise(r => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const n = s.address().port; s.close(() => r(n)); }); });

// sobe o Drive simulado (pasta plana, sem --index: o índice vem do backend) e o backend de chaves.
// -> { api, funcoes, parar() }
export async function subir(fix) {
  const [pd, pc] = [await freePort(), await freePort()];
  const drive = spawn("python3", ["-I", join(ROOT, "tests/mock_drive.py"), String(pd), "--library", fix.dados], { stdio: ["ignore", "pipe", "inherit"] });
  const chaves = spawn("node", [join(ROOT, "tests/mock_chaves.mjs"), String(pc), "--mestra", fix.mestra, "--indice", fix.indice], { stdio: ["ignore", "pipe", "inherit"] });
  await Promise.all([drive, chaves].map(s => new Promise((r, x) => { s.stdout.once("data", r); s.once("exit", c => x(new Error("mock saiu: " + c))); })));
  return { api: `http://127.0.0.1:${pd}`, funcoes: `http://127.0.0.1:${pc}`, parar() { for (const s of [drive, chaves]) try { s.kill(); } catch {} } };
}
