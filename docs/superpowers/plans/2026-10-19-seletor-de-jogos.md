# Seletor de jogos — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** trocar o EmulationStation (WASM) por um seletor próprio em HTML/JS, com prateleiras de capas, ficha do jogo, busca, navegação por controle e botão para baixar a ROM, mantendo o emulador (`retroarch/play.html`) como está.

**Architecture:** `data/mkmanifest.py` gera um `library.json` (sistemas + jogos + metadados dos `gamelist.xml` + IDs das imagens no Drive) e um manifest enxuto (só o que o emulador usa). A página `web/index.html` vira o seletor: módulos em `web/app/` leem o `library.json` pelo `io.js` (hub, demo ou Drive), desenham as telas e chamam `launch.js` (o antigo `webLaunch` do `bridge.js`) para abrir o jogo no iframe de sempre.

**Tech Stack:** JavaScript ES modules sem build, CSS puro, Python 3 (gerador e testes `unittest`), Playwright (`/home/andre/Workspace/web-ports/tools/pw`) com Chromium do sistema.

**Spec:** `docs/superpowers/specs/2026-10-19-seletor-de-jogos-design.md`

## Regras do projeto (valem para todas as tarefas)

- Diretório: `/home/andre/Workspace/web-ports/r36s`, branch `etapa1`. Commits locais (este repo usa o e-mail de trabalho: **não dar push daqui**; a publicação no GitHub é feita no fim, pelo `r36s-publish`, com o autor trocado).
- Testes de navegador e builds: sempre dentro de `systemd-run --user --scope -q -p MemoryMax=12G <comando>`.
- O hub (`webports-hub`, porta 8770) serve `web/` em `http://localhost:8770/r36s/`. Se não estiver ativo: `systemd-run --user --unit webports-hub --working-directory=/home/andre/Workspace/web-ports /usr/bin/python3 /home/andre/Workspace/web-ports/hub.py 8770`.
- O cartão fica montado só leitura em `/run/media/andre/EASYROMS` (`card/` aponta para ele). Se não estiver: `udisksctl loop-setup -r -f /run/media/andre/external/handhelds/r36s-64gb-darkosre/r36s-64gb-darkosre-20261002.img`. **Nunca escrever no cartão.**
- Save semeado do DK3 (`saves/snes/Donkey Kong Country 3 - Dixie Kong's Double Trouble! (USA) (PT-BR).srm`, md5 `42a492ce4260a522416a75be0ebd353e`): conferir depois dos testes de navegador; se mudou, restaurar do cartão. Apagar outros saves criados por teste.
- Estilo do código: o mesmo dos arquivos vizinhos (comentários em português, curtos, explicando o porquê; nomes curtos; `el(...)`/`h(...)` para criar DOM).
- Nada de ROM, BIOS ou save no repositório.

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `data/mkmanifest.py` | modificar | manifest enxuto + `library.json` |
| `tests/test_library.py` | criar | gerador do `library.json` |
| `tests/test_mkmanifest.py`, `tests/test_drive_manifest.py` | reescrever | manifest enxuto (hub e Drive) |
| `web/drive.js` | modificar | `libraryIndex` devolve também o `library.json` |
| `web/io.js` | modificar | backend `hub`, rota `data/library.json`, `image()`, `romUrl()`, `loadIndex()`; sai a pré-busca do ES |
| `tests/mock_drive.py` | modificar | publica `library.json` em `R36S/.web` |
| `web/app/library.js` | criar | índice, busca, ordens (puro) |
| `web/app/prefs.js` | criar | favoritos e recentes (localStorage) |
| `tests/test_app.mjs` | criar | testes de `library.js` e `prefs.js` |
| `web/app/launch.js` | criar | abrir o jogo (vem do `web/bridge.js`) |
| `web/app/media.js` | criar | imagens sob demanda |
| `web/app/views.js` | criar | Início, Sistema, Busca, barra lateral |
| `web/app/sheet.js` | criar | ficha do jogo |
| `web/app/download.js` | criar | ⬇ ROM |
| `web/app/nav.js` | criar | foco por controle/teclado |
| `web/app/main.js` | criar | inicialização e rotas |
| `web/app/app.css` | criar | visual "moderno e limpo" |
| `web/index.html` | reescrever | página do seletor |
| `web/controls.js`, `web/controls.css` | modificar | sem ES: toque só no jogo, sem painel automático |
| `web/retroarch/play.js` | modificar | manifest vem de `parent.r36s.io` |
| `web/site/site.js` | modificar | título do iframe, texto do demo |
| `data/mkdemo.py` | modificar | demo sem recursos do ES |
| `build/site-dist.sh` | modificar | sem `emulationstation.*`, com `app/` |
| `build/upload/sobe.sh` | modificar | sem a etapa do tema |
| `web/emulationstation.{js,wasm}`, `web/fsboot.js`, `web/bridge.js`, `build/build-es.sh`, `build/es-out/`, `patches/es/`, `tests/flicker.mjs`, `tests/eslist.mjs`, `web/site/demo/fs/{usr,etc,home/ark/.emulationstation,roms/themes}` | apagar | ES |
| `tests/e2e_site.mjs`, `tests/e2e_systems.mjs`, `tests/quit_loading.mjs`, `tests/touch_game.mjs`, `tests/touch_sticks.mjs`, `tests/controls_config.mjs`, `tests/mobile_demo.mjs`, `tests/play_mobile.mjs`, `tests/drive_boot.mjs` | adaptar | sem ES |
| `tests/nav_pad.mjs`, `tests/perf_home.mjs`, `tests/download.mjs` | criar | novos testes de navegador |

---

### Task 1: `library.json` no gerador

**Files:**
- Modify: `data/mkmanifest.py`
- Create: `tests/test_library.py`

- [ ] **Step 1: Escrever o teste que falha**

`tests/test_library.py`:

```python
# tests/test_library.py — library.json do seletor (data/mkmanifest.py build_library)
# python3 -m unittest tests.test_library
import json, os, subprocess, sys, tempfile, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "data"))
import mkmanifest

ROOT = os.path.join(os.path.dirname(__file__), "..")
SYSTEMS = """<systemList>
<system><name>snes</name><fullname>Super Nintendo</fullname><path>/roms/snes/</path><extension>.sfc .7z</extension></system>
<system><name>psx</name><fullname>PlayStation</fullname><path>/roms/psx</path><extension>.cue .bin .m3u</extension></system>
<system><name>vazio</name><fullname>Sem jogos</fullname><path>/roms/vazio/</path><extension>.zip</extension></system>
<system><name>ports</name><fullname>Ports</fullname><path>/roms/ports/</path><extension>.sh</extension></system>
</systemList>"""
GAMELIST = """<gameList>
<game><path>./Donkey Kong Country 3 (USA).sfc</path><name>Donkey Kong Country 3</name><desc>Dixie e Kiddy.</desc>
<releasedate>19961122T000000</releasedate><players>1-2</players><genre>Plataforma</genre>
<image>./images/DKC3-image.png</image><thumbnail>./images/DKC3-thumb.png</thumbnail><marquee>./images/DKC3-marquee.png</marquee></game>
<game><path>./Apagado.sfc</path><name>Não existe mais</name></game>
</gameList>"""
CORES = {"systems": {"snes": {"core": "snes9x", "fullname": "Super NES", "note": "", "order": 2},
                     "psx": {"core": "pcsx_rearmed", "fullname": "PlayStation", "note": "", "order": 1},
                     "ports": {"core": None, "fullname": "Ports", "note": "sem núcleo libretro no dArkOS", "order": 9}}}

def touch(root, rel, data=b""):
    p = os.path.join(root, rel.lstrip("/"))
    os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, "wb").write(data)

class Library(unittest.TestCase):
    def make(self, drive=False):
        src, out = tempfile.mkdtemp(), tempfile.mkdtemp()
        touch(src, "/etc/emulationstation/es_systems.cfg", SYSTEMS.encode())
        touch(src, "/roms/snes/gamelist.xml", GAMELIST.encode())
        touch(src, "/roms/snes/Donkey Kong Country 3 (USA).sfc", b"R" * 10)
        touch(src, "/roms/snes/Ação Total.7z", b"Z" * 5)
        touch(src, "/roms/snes/images/DKC3-image.png", b"PNG")
        touch(src, "/roms/snes/images/DKC3-thumb.png", b"PNG")
        touch(src, "/roms/psx/Disco (USA).cue", b'FILE "Disco (USA).bin" BINARY\n')
        touch(src, "/roms/psx/Disco (USA).bin", b"BIN")
        touch(src, "/roms/ports/Jogo.sh", b"#!/bin/sh")
        cores = os.path.join(out, "cores.json")
        json.dump(CORES, open(cores, "w"))
        ids = None
        if drive:
            ls = subprocess.check_output([sys.executable, "-I", os.path.join(ROOT, "tests", "mock_drive.py"), "--lsjson", os.path.join(src, "roms")])
            lsj = os.path.join(out, "ls.json"); open(lsj, "wb").write(ls)
            ids = mkmanifest.read_lsjson(lsj)
        mkmanifest.build(src, out, ids, cores)
        return json.load(open(os.path.join(out, "library.json"), encoding="utf-8")), ids

    def test_systems_in_cores_order_without_empty(self):
        lib, _ = self.make()
        self.assertEqual([s["id"] for s in lib["systems"]], ["psx", "snes", "ports"])
        snes = lib["systems"][1]
        self.assertEqual((snes["name"], snes["count"], snes["playable"]), ("Super Nintendo", 2, True))
        ports = lib["systems"][2]
        self.assertEqual((ports["playable"], ports["note"]), (False, "sem núcleo libretro no dArkOS"))

    def test_gamelist_metadata_and_fallback_name(self):
        lib, _ = self.make()
        games = {g["rom"]: g for g in lib["games"]}
        dk = games["/roms/snes/Donkey Kong Country 3 (USA).sfc"]
        self.assertEqual((dk["name"], dk["year"], dk["players"], dk["genre"], dk["desc"]),
                         ("Donkey Kong Country 3", 1996, "1-2", "Plataforma", "Dixie e Kiddy."))
        self.assertEqual(dk["box"], "/roms/snes/images/DKC3-thumb.png")
        self.assertEqual(dk["shot"], "/roms/snes/images/DKC3-image.png")
        self.assertNotIn("logo", dk)   # marquee citado mas o arquivo não existe
        self.assertEqual(dk["size"], 10)
        acao = games["/roms/snes/Ação Total.7z"]
        self.assertEqual(acao["name"], "Ação Total")
        self.assertNotIn("/roms/snes/Apagado.sfc", games)   # no gamelist, mas sem arquivo

    def test_cue_hides_cited_bin(self):
        lib, _ = self.make()
        roms = [g["rom"] for g in lib["games"] if g["s"] == "psx"]
        self.assertEqual(roms, ["/roms/psx/Disco (USA).cue"])

    def test_drive_refs_are_ids(self):
        lib, ids = self.make(drive=True)
        dk = next(g for g in lib["games"] if g["name"] == "Donkey Kong Country 3")
        self.assertEqual(dk["box"], {"id": ids["snes/images/DKC3-thumb.png"]["id"], "v": ids["snes/images/DKC3-thumb.png"]["v"]})
        self.assertEqual(dk["id"], ids["snes/Donkey Kong Country 3 (USA).sfc"]["id"])

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /home/andre/Workspace/web-ports/r36s && python3 -m unittest tests.test_library -v`
Expected: FAIL/ERROR (`build()` não aceita o 4º argumento `cores`; não existe `library.json`).

- [ ] **Step 3: Implementar em `data/mkmanifest.py`**

Adicionar depois de `read_lsjson`:

```python
def read_systems_full(src):
    """[{'name', 'fullname', 'dir', 'exts'}] na ordem do es_systems.cfg (uma pasta só uma vez)."""
    for rel in ("home/ark/.emulationstation/es_systems.cfg", "etc/emulationstation/es_systems.cfg"):
        p = os.path.join(src, rel)
        if not os.path.isfile(p):
            continue
        txt = open(p, encoding="utf-8", errors="replace").read()
        out, seen = [], set()
        for block in re.findall(r"<system>.*?</system>", txt, re.S):
            tag = lambda t: (re.search(f"<{t}>(.*?)</{t}>", block, re.S) or [None, ""])[1].strip()
            d = "/" + tag("path").strip("/")
            if d == "/" or d in seen:
                continue
            seen.add(d)
            out.append({"name": tag("name"), "fullname": tag("fullname") or tag("name"), "dir": d, "exts": tag("extension").split()})
        return out
    return []

def read_gamelist(real, vdir):
    """{vpath da ROM: metadados} de um gamelist.xml; caminhos de mídia como vpath."""
    try:
        root = ET.parse(real).getroot()
    except (ET.ParseError, OSError):
        return {}
    def vp(t):
        t = (t or "").strip()
        if not t:
            return None
        return os.path.normpath(t if t.startswith("/") else vdir + "/" + (t[2:] if t.startswith("./") else t))
    out = {}
    for g in root.iter("game"):
        rom = vp(g.findtext("path"))
        if not rom:
            continue
        txt = lambda tag: (g.findtext(tag) or "").strip()
        year = txt("releasedate")[:4]
        meta = {"name": txt("name"), "desc": txt("desc")[:600], "year": int(year) if year.isdigit() else None,
                "players": txt("players"), "genre": txt("genre"),
                "box": vp(g.findtext("thumbnail")), "shot": vp(g.findtext("image")), "logo": vp(g.findtext("marquee"))}
        out[rom] = {k: v for k, v in meta.items() if v}
    return out

SHEET_EXT = (".cue", ".m3u", ".gdi")
SKIP_DIRS = ("/images/", "/media/", "/videos/", "/manuals/", "/snap/")

def cited_by_sheet(real, vdir):
    """Arquivos que um .cue/.m3u/.gdi cita (mesma regra do companionsOf do play.js)."""
    txt = open(real, encoding="utf-8", errors="replace").read()
    ext = os.path.splitext(real)[1].lower()
    if ext == ".cue":
        names = [a or b for a, b in re.findall(r'^\s*FILE\s+(?:"([^"]+)"|(\S+))', txt, re.M | re.I)]
    elif ext == ".m3u":
        names = [l.strip() for l in txt.splitlines() if l.strip() and not l.startswith("#")]
    else:
        names = [m.group(1) or m.group(2) for l in txt.splitlines()[1:]
                 if (m := re.match(r'^\s*\d+\s+\d+\s+\d+\s+\d+\s+(?:"([^"]+)"|(\S+))', l))]
    return {os.path.normpath(vdir + "/" + n) for n in names}

def write_library(out, src, tree, drive_ids, cores_path):
    """library.json: sistemas com jogos (ordem do cores.json, senão do es_systems.cfg) e os jogos com os metadados."""
    systems = read_systems_full(src)
    cores = json.load(open(cores_path, encoding="utf-8"))["systems"] if cores_path and os.path.isfile(cores_path) else {}
    files = {vp: (real, size) for _, entries in tree for vp, real, size in entries}
    def ref(vpath):
        if not vpath or vpath not in files:
            return None
        if drive_ids is None:
            return vpath
        d = drive_ids.get(vpath[len("/roms/"):])
        return {"id": d["id"], "v": d["v"]} if d else None
    out_systems, out_games = [], []
    for pos, s in enumerate(systems):
        folder = os.path.basename(s["dir"])
        prefix = s["dir"] + "/"
        mine = sorted(vp for vp in files if vp.startswith(prefix) and not any(x in vp[len(s["dir"]):] for x in SKIP_DIRS)
                      and any(vp.endswith(e) for e in s["exts"]))
        meta, hidden = {}, set()
        for vroot, entries in tree:
            if vroot == s["dir"] or vroot.startswith(prefix):
                for vp, real, _ in entries:
                    if vp.endswith("/gamelist.xml"):
                        meta.update(read_gamelist(real, vroot))
                    elif vp.lower().endswith(SHEET_EXT) and vp in mine:
                        hidden |= cited_by_sheet(real, vroot)
        games = []
        for vp in mine:
            if vp in hidden:
                continue
            m = meta.get(vp, {})
            name = os.path.basename(vp)
            g = {"s": folder, "rom": vp, "name": m.get("name") or os.path.splitext(name)[0], "size": files[vp][1]}
            for k in ("year", "players", "genre", "desc"):
                if m.get(k):
                    g[k] = m[k]
            for k in ("box", "shot", "logo"):
                r = ref(m.get(k))
                if r:
                    g[k] = r
            if drive_ids is not None:
                d = drive_ids.get(vp[len("/roms/"):])
                if d:
                    g["id"] = d["id"]
            games.append(g)
        if not games:
            continue
        c = cores.get(folder, {})
        out_systems.append({"id": folder, "name": s["fullname"], "count": len(games), "playable": bool(c.get("core")),
                            "note": c.get("note") or "", "order": c.get("order", 1000 + pos)})
        out_games += games
    out_systems.sort(key=lambda s: s["order"])
    for s in out_systems:
        del s["order"]
    lib = {"version": 1, "systems": out_systems, "games": out_games}
    with open(os.path.join(out, "library.json"), "w", encoding="utf-8") as f:
        json.dump(lib, f, ensure_ascii=False, separators=(",", ":"))
    return len(out_games)
```

Mudar a assinatura e o fim de `build`:

```python
def build(src, out, drive_ids=None, cores=None):
    ...
    # (corpo atual; antes do "with open(... manifest.json ...)")
    write_library(out, src, tree, drive_ids, cores)
```

e o `__main__`:

```python
    ap.add_argument("--cores", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web", "data", "cores.json"),
                    help="mapa sistema -> núcleo (data/mkcores.py): playable/nota/ordem no library.json")
    a = ap.parse_args()
    n, size = build(a.src, a.out, read_lsjson(a.drive_ids) if a.drive_ids else None, a.cores)
```

Atualizar a docstring do módulo: "Gera manifest.json + eager.bin + library.json (seletor de jogos: sistemas, jogos, metadados dos gamelist.xml)".

- [ ] **Step 4: Rodar e ver passar**

Run: `python3 -m unittest tests.test_library -v`
Expected: 4 testes OK.

- [ ] **Step 5: Commit**

```bash
git add data/mkmanifest.py tests/test_library.py
git commit -m "mkmanifest: library.json do seletor (sistemas, jogos, metadados do gamelist, IDs das imagens no Drive)"
```

---

### Task 2: manifest enxuto (só o que o emulador usa)

**Files:**
- Modify: `data/mkmanifest.py`
- Rewrite: `tests/test_mkmanifest.py`, `tests/test_drive_manifest.py`

O manifest deixa de ter o que era do ES: tema, `/usr`, `/etc`, `/home/ark/.emulationstation`, `gamelist.xml`, imagens e vídeos. Fica: ROMs (`empty`), arquivos não-mídia das pastas de sistema (`lazy`: BIOS de arcade, faixas `.bin`), `/roms/bios` (`lazy`) e `/home/ark/.config` (`eager`, configs do RetroArch que o `play.js` lê de `../fs/home/ark/.config/retroarch`). Sem `es_systems.cfg` o gerador para com erro (o regime antigo por extensão sai).

- [ ] **Step 1: Reescrever `tests/test_mkmanifest.py` (teste que falha)**

```python
# tests/test_mkmanifest.py — manifest do emulador (hub): só ROMs, BIOS, arquivos de apoio e configs do RetroArch
import json, os, sys, tempfile, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "data"))
import mkmanifest

SYSTEMS = b"<systemList><system><name>snes</name><path>/roms/snes/</path><extension>.7z</extension></system></systemList>"

def touch(root, rel, data=b""):
    p = os.path.join(root, rel.lstrip("/"))
    os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, "wb").write(data)

class T(unittest.TestCase):
    def setUp(self):
        self.src = tempfile.mkdtemp(); self.out = tempfile.mkdtemp()
        touch(self.src, "/etc/emulationstation/es_systems.cfg", SYSTEMS)
        touch(self.src, "/home/ark/.config/retroarch/retroarch-core-options.cfg", b"opt = 1")
        touch(self.src, "/home/ark/.emulationstation/es_settings.cfg", b"<config/>")
        touch(self.src, "/usr/bin/emulationstation/resources/arrow.svg", b"<svg/>")
        touch(self.src, "/roms/themes/t/theme.xml", b"<theme/>")
        touch(self.src, "/roms/snes/gamelist.xml", b"<gameList/>")
        touch(self.src, "/roms/snes/Jogo (USA).7z", b"ROMDATA")
        touch(self.src, "/roms/snes/Jogo (USA).srm", b"SRM")
        touch(self.src, "/roms/snes/images/Jogo (USA).png", b"PNG")
        touch(self.src, "/roms/bios/scph1001.bin", b"BIOS")
        mkmanifest.build(self.src, self.out)
        self.m = json.load(open(os.path.join(self.out, "manifest.json")))
        self.blob = open(os.path.join(self.out, "eager.bin"), "rb").read()

    def test_only_player_files(self):
        self.assertEqual(sorted(self.m["files"]), sorted([
            "/home/ark/.config/retroarch/retroarch-core-options.cfg", "/roms/bios/scph1001.bin",
            "/roms/snes/Jogo (USA).7z", "/roms/snes/Jogo (USA).srm"]))

    def test_retroarch_cfg_is_eager(self):
        f = self.m["files"]["/home/ark/.config/retroarch/retroarch-core-options.cfg"]
        self.assertEqual(f["kind"], "eager")
        self.assertEqual(self.blob[f["off"]:f["off"] + f["size"]], b"opt = 1")
        self.assertEqual(len(self.blob), 7)

    def test_rom_empty_bios_and_support_lazy(self):
        self.assertEqual(self.m["files"]["/roms/snes/Jogo (USA).7z"]["kind"], "empty")
        self.assertEqual(self.m["files"]["/roms/bios/scph1001.bin"], {"size": 4, "kind": "lazy", "url": "fs/roms/bios/scph1001.bin"})
        self.assertEqual(self.m["files"]["/roms/snes/Jogo (USA).srm"]["kind"], "lazy")

    def test_without_es_systems_fails(self):
        src = tempfile.mkdtemp()
        touch(src, "/roms/snes/Jogo.7z", b"R")
        with self.assertRaises(SystemExit):
            mkmanifest.build(src, tempfile.mkdtemp())

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Reescrever `tests/test_drive_manifest.py`**

Manter o `setUp` atual (a árvore de exemplo e a listagem pelo mock), trocando a última linha por `mkmanifest.build(self.src, self.out, mkmanifest.read_lsjson(lsj))` e `self.m = json.load(open(os.path.join(self.out, "manifest.json")))`, e substituir os testes por:

```python
    def test_roms_have_ids(self):
        f = self.m["files"]["/roms/snes/Jogo.7z"]
        self.assertEqual((f["kind"], f["id"]), ("empty", self.ids["snes/Jogo.7z"]))

    def test_no_es_files(self):
        for p in self.m["files"]:
            self.assertFalse(p.startswith(("/usr/", "/etc/", "/roms/themes/", "/home/ark/.emulationstation")), p)
            self.assertFalse(p.endswith("gamelist.xml") or "/images/" in p, p)
        self.assertEqual(os.path.getsize(os.path.join(self.out, "eager.bin")), 0)

    def test_extra_keeps_sheet_tracks_and_saves(self):
        self.assertIn("/roms/snes/Disco.bin", self.m["extra"] | self.m["files"])

    def test_info_and_library_written(self):
        info = json.load(open(os.path.join(self.out, "info.json")))
        self.assertEqual((info["systems"], info["games"]), (1, 2))
        self.assertTrue(os.path.isfile(os.path.join(self.out, "library.json.gz")))
```

(`Jogo.7z` e `Disco.cue` são os 2 jogos do snes; o n64 não tem jogos.)

- [ ] **Step 3: Rodar e ver falhar**

Run: `python3 -m unittest tests.test_mkmanifest tests.test_drive_manifest -v`
Expected: FAIL (o manifest ainda tem tema, `/usr`, `gamelist.xml`; sem `es_systems.cfg` não dá `SystemExit`).

- [ ] **Step 4: Implementar**

Em `data/mkmanifest.py`:
1. Apagar `THEME_EAGER_EXT`, `ES_LAZY_FONT_MIN`, `DRIVE_THEME_EAGER_EXT`, `DRIVE_THEME_PER_SYSTEM`, `MEDIA_TAGS`, `active_theme`, `gamelist_refs`, `legacy_classify` e a constante `SYMLINKS`.
2. Trocar `CardRules` por:

```python
MEDIA_DIRS = ("/images/", "/media/", "/videos/", "/manuals/", "/snap/")

class CardRules:
    """Só o que o emulador (retroarch/play.js) usa: ROMs, arquivos de apoio das pastas de sistema, BIOS e as configs
    do RetroArch do cartão. Capas e metadados vão pelo library.json.gz."""
    def __init__(self, systems):
        self.systems = sorted(systems.items(), key=lambda kv: -len(kv[0]))   # prefixo mais longo primeiro

    def classify(self, vpath, size):
        """'eager' | 'lazy' | 'empty' | None (fica de fora)."""
        name = os.path.basename(vpath)
        if not vpath.startswith("/roms/"):
            return ("eager" if size else "empty") if vpath.startswith("/home/ark/.config/") else None
        if vpath.startswith("/roms/bios/"):
            return "lazy" if size else "empty"
        for prefix, exts in self.systems:
            if vpath.startswith(prefix + "/"):
                rest = vpath[len(prefix):]
                if name == "gamelist.xml" or any(d in rest for d in MEDIA_DIRS):
                    return None
                if any(name.endswith(e) for e in exts):
                    return "empty"
                return "lazy" if size else "empty"
        return None
```

3. Em `build`: `systems = read_systems(src)`; se `None`: `sys.exit(f"{src}: sem es_systems.cfg (etc/emulationstation ou home/ark/.emulationstation)")`. `classify = CardRules(systems).classify`. Apagar o cálculo de `present`, `theme` e `drive_theme_eager`. No laço, trocar a linha do "fora do Drive" por: `if drive_ids is not None and kind == "lazy" and not vpath.startswith("/roms/"): kind = "eager"`. `dirs` passa a ser só os diretórios dos arquivos que entraram (apagar o `dirs.add(vroot)` de fora de `/roms`). O manifest grava `{"dirs": sorted(dirs), "files": files}` (sem `symlinks`).
4. Docstring do módulo: reescrever o 2º parágrafo para descrever as regras novas (as da `CardRules`).

- [ ] **Step 5: Rodar todos os testes Python**

Run: `python3 -m unittest tests.test_mkmanifest tests.test_drive_manifest tests.test_library -v`
Expected: tudo OK.

- [ ] **Step 6: Regerar o índice do hub e medir**

Run: `python3 data/mkmanifest.py card web/data`
Expected: algo como `7xxx arquivos, eager.bin 0.1 MB, manifest.json 1.x MB`, e `web/data/library.json.gz` criado. Medir: `python3 -c "import os,gzip;b=open('web/data/library.json.gz','rb').read();print(len(b)//1024,'KB',len(gzip.compress(b))//1024,'KB gz')"` — anotar no commit.

- [ ] **Step 7: Commit**

```bash
git add data/mkmanifest.py tests/test_mkmanifest.py tests/test_drive_manifest.py
git commit -m "mkmanifest: manifest só com o que o emulador usa (sem tema, /usr, /etc, gamelist e imagens); eager.bin só com as configs do RetroArch"
```

---

### Task 3: `io.js` para o seletor (hub, `library.json.gz`, imagens) e Drive

**Files:**
- Modify: `web/io.js`, `web/drive.js`, `tests/mock_drive.py`

- [ ] **Step 1: `drive.js` — índice com o `library.json.gz`**

Em `libraryIndex`, exigir também `library.json.gz` e devolver o ID e a data:

```js
    if (!by["manifest.json"] || !by["eager.bin"] || !by["library.json.gz"]) return null;
    ...
    return { manifest: by["manifest.json"].id, eager: by["eager.bin"].id, library: by["library.json.gz"].id, info,
      modifiedTime: by["manifest.json"].modifiedTime, eagerTime: by["eager.bin"].modifiedTime, libraryTime: by["library.json.gz"].modifiedTime };
```

- [ ] **Step 2: `mock_drive.py` publica o `library.json.gz`**

Na lista de arquivos do índice (linha com `for n in ("manifest.json", "eager.bin", "info.json")`), acrescentar `"library.json.gz"`. Atualizar a docstring (`--index <pasta com manifest.json/eager.bin/info.json/library.json.gz>`).

- [ ] **Step 3: `io.js` — backend `hub`, rota do `library.json.gz`, imagens, ROM e índice**

1. Cabeçalho: trocar a descrição para "E/S do seletor e do player" e listar `hub` como 3º backend ("hub — fs/, saves/ e data/ do hub local: fetch/XHR normais").
2. Apagar `PREFETCH`, `PREFETCH_BACK`, `SOUNDS_AFTER_MS`, `prefetchAfter`, `prefetchSounds`, `byDir`, a fila `enqueue`/`pump` e as chamadas a elas em `driveFile` e na rota do manifest. Manter `PARALLEL = 4` com o comentário "downloads de imagens do Drive ao mesmo tempo".
3. Em `route`, logo depois de `if (rel === null) return fetch(url, init);`:

```js
    if (backend === "hub") return fetch(url, init);
```

e, no ramo `demo`, incluir `rel === "data/library.json.gz"` na lista que vai para `demoRoot`. No ramo `drive`, antes de `if (rel.startsWith("fs/"))`:

```js
    if (rel === "data/library.json.gz") {
      const r = await indexFile(library.index.library, library.index.libraryTime);
      return r.ok ? r : resp(null, r.status);
    }
```

4. Fila de imagens do Drive e as funções novas, antes de `const io = {`:

```js
  // imagens do Drive: no máximo PARALLEL downloads ao mesmo tempo, o mais recente primeiro (a tela rolou: vale mais)
  const waiting = [];
  let active = 0;
  const slot = () => new Promise(res => { waiting.unshift(res); next(); });
  const next = () => { while (active < PARALLEL && waiting.length) { active++; waiting.shift()(); } };
  const done = () => { active--; next(); };
  const enc = p => p.split("/").map(encodeURIComponent).join("/");
  // índice completo para o emulador (o seletor só precisa do library.json.gz): pedido em segundo plano
  let indexPromise = null;
  function loadIndex() {
    if (manifest && eager) return Promise.resolve({ manifest, eager });
    const get = rel => route(new URL(rel, ROOT).href);
    return indexPromise || (indexPromise = Promise.all([
      get("data/manifest.json").then(r => { if (!r.ok) throw new Error(`manifest HTTP ${r.status}`); return r.json(); }),
      get("data/eager.bin").then(r => r.ok ? r.arrayBuffer() : new ArrayBuffer(0)),
    ]).then(([m, e]) => { manifest = m; eager = new Uint8Array(e); return { manifest, eager }; })
      .catch(e => { indexPromise = null; throw e; }));
  }
```

5. Em `io`, acrescentar:

```js
    get drive() { return drive; },
    loadIndex,
    // URL de uma imagem do library.json.gz: caminho do cartão (hub/demo: URL direta, cache HTTP) ou {id, v} (Drive: blob)
    async image(ref) {
      if (typeof ref === "string") return new URL("fs" + enc(ref), backend === "demo" ? demoRoot : ROOT).href;
      const c = await cache(), key = cacheKey(ref);
      let r = c && await c.match(key).catch(() => null);
      if (r) stats.cached++;
      else {
        await slot();
        try {
          r = await drive.media(ref.id);
          stats.media++;
          if (!r.ok) throw new Error(`imagem HTTP ${r.status}`);
          const buf = await r.arrayBuffer();
          stats.bytes += buf.byteLength;
          if (c) c.put(key, resp(buf.slice(0), 200)).catch(() => {});
          r = resp(buf, 200);
        } finally { done(); }
      }
      return URL.createObjectURL(await r.blob());
    },
    // ROM para salvar (hub/demo): link direto
    romUrl(vpath) { return new URL("fs" + enc(vpath), backend === "demo" ? demoRoot : ROOT).href; },
```

6. Em `xhrFrom`: no começo do `open`, `if (backend === "hub") return super.open(method, url, async);`.

7. No `web/retroarch/isolated.js` nada muda (ele cria o próprio `io` com `preload`).

- [ ] **Step 4: Teste rápido no navegador (hub)**

Criar `/tmp/claude-1000/-home-andre-Workspace/b51375b0-c435-4115-9cf3-05c21deb9623/scratchpad/io_hub.mjs` (descartável):

```js
import { chromium } from "/home/andre/Workspace/web-ports/tools/pw/node_modules/playwright-core/index.mjs";
const b = await chromium.launch({ executablePath: "/usr/bin/chromium" });
const p = await b.newPage();
await p.goto("http://localhost:8770/r36s/data/cores.json");
const r = await p.evaluate(async () => {
  const { createIO } = await import("/r36s/io.js");
  const io = createIO({ backend: "hub" });
  const r0 = await io.fetchFrom(location.href)("library.json.gz");
  const lib = await new Response(r0.body.pipeThrough(new DecompressionStream("gzip"))).json();
  const { manifest, eager } = await io.loadIndex();
  const g = lib.games.find(g => g.box);
  return { systems: lib.systems.length, games: lib.games.length, files: Object.keys(manifest.files).length, eager: eager.length,
    img: (await fetch(await io.image(g.box))).status };
});
console.log(JSON.stringify(r)); await b.close();
```

Run: `systemd-run --user --scope -q -p MemoryMax=12G node <arquivo acima>`
Expected: `{"systems": ~20+, "games": ~6000+, "files": ..., "eager": ~140000, "img": 200}`.

- [ ] **Step 5: Commit**

```bash
git add web/io.js web/drive.js tests/mock_drive.py
git commit -m "io: backend hub, library.json.gz pelo índice do Drive, imagens sob demanda (image) e índice do emulador em segundo plano (loadIndex); sai a pré-busca do ES"
```

---

### Task 4: `library.js` e `prefs.js` (lógica pura)

**Files:**
- Create: `web/app/library.js`, `web/app/prefs.js`, `tests/test_app.mjs`

- [ ] **Step 1: Escrever o teste que falha**

`tests/test_app.mjs`:

```js
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
```

(`"d"` só aparece em "Donkey…" e "Doom", os dois no começo do nome; empate desfeito em A–Z.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `node tests/test_app.mjs`
Expected: erro `Cannot find module .../web/app/library.js`.

- [ ] **Step 3: Implementar**

`web/app/library.js`:

```js
// Biblioteca do seletor: data/library.json.gz (gerado por data/mkmanifest.py) com índice por sistema, busca sem acento e
// ordens. Puro (testes em tests/test_app.mjs).
export const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const byName = (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
export function sortGames(list, order = "az") {
  const l = list.slice();
  if (order === "ano") l.sort((a, b) => (a.year || 9999) - (b.year || 9999) || byName(a, b));
  else l.sort(byName);
  return l;
}

export function createLibrary(data) {
  const systems = data.systems.filter(s => s.count > 0);
  const byId = new Map(systems.map(s => [s.id, s]));
  const games = data.games.map(g => ({ ...g, key: norm(g.name) }));
  const bySystem = new Map(systems.map(s => [s.id, []]));
  for (const g of games) if (bySystem.has(g.s)) bySystem.get(g.s).push(g);
  for (const [id, l] of bySystem) bySystem.set(id, sortGames(l));
  const byRom = new Map(games.map(g => [g.rom, g]));
  return {
    systems,
    total: games.length,
    system: id => byId.get(id) || null,
    byRom: rom => byRom.get(rom) || null,
    games: (id, order = "az") => (order === "az" ? bySystem.get(id) || [] : sortGames(bySystem.get(id) || [], order)),
    // todas as palavras em qualquer parte do nome; quem começa com a primeira palavra vem antes
    search(q, limit = 200) {
      const words = norm(q).split(/\s+/).filter(Boolean);
      if (!words.length) return [];
      const hit = games.filter(g => words.every(w => g.key.includes(w)));
      const starts = g => (g.key.startsWith(words[0]) ? 0 : 1);
      return hit.sort((a, b) => starts(a) - starts(b) || byName(a, b)).slice(0, limit);
    },
  };
}
```

`web/app/prefs.js`:

```js
// Favoritos e jogados recentemente, só neste aparelho (localStorage; sem ele, nada é lembrado mas nada quebra)
const KEY = "r36s-prefs-v1", MAX_RECENT = 20;
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };
const write = p => { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) {} };

export function load() {
  const p = read();
  return { fav: Array.isArray(p.fav) ? p.fav : [], recent: Array.isArray(p.recent) ? p.recent : [] };
}
export const isFav = rom => load().fav.includes(rom);
// liga/desliga; devolve se ficou favorito
export function toggleFav(rom) {
  const p = load(), i = p.fav.indexOf(rom);
  if (i < 0) p.fav.unshift(rom); else p.fav.splice(i, 1);
  write(p);
  return i < 0;
}
export function played(rom) {
  const p = load();
  p.recent = [rom, ...p.recent.filter(r => r !== rom)].slice(0, MAX_RECENT);
  write(p);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node tests/test_app.mjs`
Expected: `11 testes ok`.

- [ ] **Step 5: Commit**

```bash
git add web/app/library.js web/app/prefs.js tests/test_app.mjs
git commit -m "seletor: biblioteca (busca sem acento, ordens) e favoritos/recentes no aparelho"
```

---

### Task 5: `launch.js` (abrir o jogo, vindo do `bridge.js`)

**Files:**
- Create: `web/app/launch.js`

- [ ] **Step 1: Criar `web/app/launch.js`**

Copiar de `web/bridge.js` as funções `isolatedGame`, `isolatedNotice` e `notice` **sem mudança de lógica**, e transformar `installBridge` em `createLauncher`. Diferenças, nesta ordem:

```js
// Abre o jogo escolhido no seletor: o RetroArch roda em retroarch/play.html num iframe por cima do seletor e avisa a
// volta com postMessage({type:"r36s-exit"}). Núcleo: data/cores.json (data/mkcores.py) diz qual núcleo web roda cada
// sistema (pasta /roms/<sistema>/); sistema sem núcleo web: aviso por 3 s (código 1). Núcleos com threads (PSP) no site
// sem crossOriginIsolated: aba própria (isolatedGame). Sem WebGL: explica em vez de abrir uma tela preta.
// launch({system, core, rom}) -> Promise<código de saída>; window.r36s.game = jogo aberto (controls.js e testes leem).
export async function createLauncher({ io, site, focusBack }) {
  const r36s = window.r36s;
  r36s.game = null;
  let cores = { systems: {} };
  try { cores = await fetch(new URL("../data/cores.json", import.meta.url)).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }); }
  catch (e) { console.warn("[r36s] data/cores.json indisponível", e); }
  r36s.cores = cores;
  const webgl = () => { const c = document.createElement("canvas").getContext("webgl"); const l = c && c.getExtension("WEBGL_lose_context"); if (l) l.loseContext(); return !!c; };

  return ({ system, core, rom }) => new Promise(async resolve => {
    console.log("[r36s] lançando", system, core, rom);
    const sys = cores.systems[system];
    if (!sys || !sys.core) {
      const name = sys ? sys.fullname || system : system || "este sistema";
      notice("Sistema sem emulador no navegador", sys && sys.note ? `${name}: ${sys.note}` : name);
      r36s.lastGame = { system, core, rom, code: 1, why: "sem núcleo web", started: false };
      return resolve(1);
    }
    if (!webgl()) {
      notice("O navegador não liberou o 3D (WebGL)", "Feche o navegador por completo e abra de novo. No Chrome: chrome://gpu deve mostrar WebGL \"Hardware accelerated\".", 8000);
      r36s.lastGame = { system, core, rom, code: 1, why: "sem WebGL", started: false };
      return resolve(1);
    }
    if (!core || !sys.cores.includes(core)) core = sys.core;
    try { await io.loadIndex(); } catch (e) {   // o player acha a ROM, a BIOS e as irmãs pelo manifest
      notice("Não deu para ler o índice da biblioteca", e.message, 6000);
      r36s.lastGame = { system, core, rom, code: 1, why: "sem índice", started: false };
      return resolve(1);
    }
    if (sys.threads && !self.crossOriginIsolated) return isolatedGame(r36s, focusBack, { system, core, rom }).then(resolve);
    // (daqui para baixo: o corpo atual do Module.webLaunch a partir de "const f = document.createElement("iframe")",
    //  com "canvas.focus()" trocado por "focusBack()")
  });
}
```

Em `isolatedGame(r36s, focusBack, …)`: trocar o parâmetro `canvas` por `focusBack` e `canvas.focus()` por `focusBack()`; na resposta ao `hello`, `manifest: io.manifest, eager: io.eager` vira `manifest: r36s.io.manifest, eager: r36s.io.eager` (sem `r36s.fs`). Textos: "Voltar para a lista" continua; `box.onBack` com o motivo `"voltou pela aba do seletor"` (o teste `e2e_site` passa a esperar esse texto). CSS dos avisos `#notice` e `#isolated`: mover do `<style>` do `web/index.html` antigo para `web/app/app.css` (Task 6), com as mesmas regras.

- [ ] **Step 2: Conferir sintaxe**

Run: `node --check web/app/launch.js`
Expected: sem saída.

- [ ] **Step 3: Commit**

```bash
git add web/app/launch.js
git commit -m "seletor: launch.js (antigo webLaunch do bridge.js), com aviso de WebGL e índice antes do jogo"
```

---

### Task 6: página do seletor (telas, ficha, imagens, estilo)

**Files:**
- Rewrite: `web/index.html`
- Create: `web/app/main.js`, `web/app/views.js`, `web/app/sheet.js`, `web/app/media.js`, `web/app/app.css`

- [ ] **Step 1: `web/index.html`**

```html
<!doctype html>
<html lang="pt-BR">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="dark">
<title>R36S</title>
<link rel="icon" href="data:,">
<link rel="stylesheet" href="app/app.css">
<link rel="stylesheet" href="controls.css">
<div id="app" tabindex="-1">
  <header class="top">
    <button type="button" class="brand" data-nav>R36S</button>
    <label class="search"><span aria-hidden="true">🔍</span><input id="q" type="search" data-nav placeholder="Buscar" autocomplete="off" enterkeyhint="search" aria-label="Buscar jogos"></label>
    <button type="button" id="menu" data-nav aria-label="Menu" aria-haspopup="menu">≡</button>
  </header>
  <nav id="side" aria-label="Sistemas"></nav>
  <main id="view" aria-live="polite"></main>
</div>
<div id="status" role="status">carregando…</div>
<script type="module" src="app/main.js"></script>
</html>
```

- [ ] **Step 2: `web/app/media.js`**

```js
// Capas e prints sob demanda: a imagem só é pedida quando o elemento chega perto da tela (400 px). Hub/demo: URL
// direta (cache HTTP); Drive: blob com o token (io.image), uma vez por imagem.
export function createMedia(io) {
  const urls = new Map();   // ref -> Promise<url>
  const urlOf = ref => {
    const k = typeof ref === "string" ? ref : ref.id;
    if (!urls.has(k)) urls.set(k, io.image(ref).catch(e => { urls.delete(k); throw e; }));
    return urls.get(k);
  };
  const obs = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) { obs.unobserve(e.target); show(e.target); }
  }, { rootMargin: "400px" });
  async function show(img) {
    try { img.src = await urlOf(img._ref); } catch (e) { img.classList.add("fail"); }
  }
  return {
    // <img> que carrega ao aparecer; sem imagem (ou se falhar) fica invisível e aparece o nome atrás
    img(ref, cls = "") {
      const i = document.createElement("img");
      i.className = cls; i.alt = ""; i.decoding = "async"; i.draggable = false;
      i.addEventListener("error", () => i.classList.add("fail"));
      if (ref) { i._ref = ref; obs.observe(i); } else i.classList.add("fail");
      return i;
    },
  };
}
```

- [ ] **Step 3: `web/app/views.js`**

```js
// Telas do seletor: Início (destaque + prateleiras), Sistema (grade) e Busca (lista); barra lateral no PC.
// Cada capa é um botão com data-nav (foco por controle: web/app/nav.js) que abre a ficha.
import * as P from "./prefs.js";

export const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v; else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids) if (c != null) e.append(c);
  return e;
};
const ROW_MAX = 20;
const fmt = n => Number(n).toLocaleString("pt-BR");

// ctx: { lib, media, openSheet(game), go(hash) }
export function cover(ctx, g) {
  const sys = ctx.lib.system(g.s);
  return el("button", { type: "button", class: `cover${sys && !sys.playable ? " off" : ""}`, "data-nav": true, "data-rom": g.rom,
    "aria-label": `${g.name} (${sys ? sys.name : g.s})`, onclick: () => ctx.openSheet(g) },
    el("span", { class: "art" }, el("span", { class: "ph", text: g.name }), ctx.media.img(g.box || g.shot)),
    el("span", { class: "label", text: g.name }));
}

function row(ctx, title, games, more) {
  if (!games.length) return null;
  return el("section", { class: "row", "data-sys": more ? more.id : null },
    el("h2", {}, el("span", { text: title }), more ? el("a", { href: `#/s/${more.id}`, "data-nav": true, class: "more", text: `ver todos ${fmt(more.count)} ›` }) : null),
    el("div", { class: "shelf" }, ...games.map(g => cover(ctx, g))));
}

function hero(ctx, g) {
  const sys = ctx.lib.system(g.s);
  return el("section", { class: "hero" },
    ctx.media.img(g.shot || g.box, "bg"),
    el("div", { class: "txt" },
      el("span", { class: "kicker", text: `Continuar · ${sys ? sys.name : g.s}` }),
      el("b", { text: g.name }),
      el("button", { type: "button", class: "play", "data-nav": true, text: "▶ Jogar", onclick: () => ctx.openSheet(g, { play: true }) })));
}

export function renderHome(ctx) {
  const { lib } = ctx, prefs = P.load();
  const recent = prefs.recent.map(lib.byRom).filter(Boolean), fav = prefs.fav.map(lib.byRom).filter(Boolean);
  return el("div", { class: "home" },
    recent[0] ? hero(ctx, recent[0]) : null,
    row(ctx, "Recentes", recent.slice(0, ROW_MAX)),
    row(ctx, "Favoritos", fav.slice(0, ROW_MAX)),
    ...lib.systems.map(s => row(ctx, s.name, lib.games(s.id).slice(0, ROW_MAX), s)));
}

export function renderSystem(ctx, id, order) {
  const s = ctx.lib.system(id);
  if (!s) return el("p", { class: "empty", text: "Sistema não encontrado." });
  const seg = (v, label) => el("button", { type: "button", "data-nav": true, class: v === order ? "on" : "", "aria-pressed": String(v === order), text: label,
    onclick: () => ctx.go(`#/s/${id}${v === "ano" ? "?ordem=ano" : ""}`, true) });
  return el("div", { class: "system" },
    el("div", { class: "sys-head" }, el("h1", { text: s.name }), el("span", { class: "count", text: `${fmt(s.count)} jogos` }),
      el("div", { class: "seg", role: "group", "aria-label": "Ordem" }, seg("az", "A–Z"), seg("ano", "Ano"))),
    s.playable ? null : el("p", { class: "note", text: `Sem emulador no navegador${s.note ? `: ${s.note}` : ""}.` }),
    el("div", { class: "grid" }, ...ctx.lib.games(id, order).map(g => cover(ctx, g))));
}

export function renderSearch(ctx, q) {
  const hits = ctx.lib.search(q);
  return el("div", { class: "results" },
    el("p", { class: "count", text: q.trim() ? `${fmt(hits.length)} ${hits.length === 1 ? "jogo" : "jogos"}` : "Digite o nome de um jogo" }),
    ...hits.map(g => { const s = ctx.lib.system(g.s);
      return el("button", { type: "button", class: "hit", "data-nav": true, "data-rom": g.rom, onclick: () => ctx.openSheet(g) },
        el("span", { class: "art" }, el("span", { class: "ph", text: "" }), ctx.media.img(g.box || g.shot)),
        el("span", { class: "t" }, el("b", { text: g.name }), el("small", { text: [s ? s.name : g.s, g.year].filter(Boolean).join(" · ") }))); }));
}

export function renderSide(ctx, current) {
  const link = (hash, text, on) => el("a", { href: hash, "data-nav": true, class: on ? "on" : "", text });
  return [link("#/", "Início", current === "home"), ...ctx.lib.systems.map(s => link(`#/s/${s.id}`, s.name, current === s.id))];
}
```

- [ ] **Step 4: `web/app/sheet.js`**

```js
// Ficha do jogo: print, nome, etiquetas, descrição e os botões Jogar, Favoritar e ⬇ ROM. No celular é um painel que
// sobe de baixo; no PC, um painel no meio. Fica aberta durante o jogo: ao voltar, o foco volta para "Jogar".
import { el } from "./views.js";
import * as P from "./prefs.js";
import { downloadRom } from "./download.js";

// ctx: { lib, media, io, launch(game) -> Promise<código>, onClose(game) }
export function openSheet(ctx, g, { play = false } = {}) {
  document.getElementById("sheet")?.remove();
  const sys = ctx.lib.system(g.s);
  const playable = !!(sys && sys.playable);
  const msg = el("p", { class: "msg", role: "status" });
  const playBtn = el("button", { type: "button", class: "play", "data-nav": true, disabled: !playable, text: "▶ Jogar" });
  const favBtn = el("button", { type: "button", class: "fav", "data-nav": true, "aria-pressed": String(P.isFav(g.rom)) });
  const favText = () => { const on = P.isFav(g.rom); favBtn.textContent = on ? "★ Favorito" : "☆ Favoritar"; favBtn.setAttribute("aria-pressed", String(on)); };
  favText();
  favBtn.addEventListener("click", () => { P.toggleFav(g.rom); favText(); });
  const romBtn = el("button", { type: "button", class: "rom", "data-nav": true, text: "⬇ ROM" });
  let abort = null;
  romBtn.addEventListener("click", async () => {
    if (abort) { abort.abort(); return; }
    abort = new AbortController(); romBtn.textContent = "Cancelar";
    try {
      const how = await downloadRom(ctx.io, g, (got, total) => { msg.textContent = `Baixando ${Math.round(got / 1e6)} / ${Math.round(total / 1e6)} MB…`; }, abort.signal);
      msg.textContent = how === "drive" ? "Abri o arquivo no Google Drive numa aba nova: baixe por lá." : "Download iniciado.";
    } catch (e) { msg.textContent = e.name === "AbortError" ? "Download cancelado." : `Não deu para baixar: ${e.message}`; }
    finally { abort = null; romBtn.textContent = "⬇ ROM"; }
  });
  playBtn.addEventListener("click", async () => {
    if (playBtn.disabled) return;
    playBtn.disabled = true; playBtn.textContent = "preparando…"; msg.textContent = "";
    const code = await ctx.launch(g);
    playBtn.disabled = false; playBtn.textContent = "▶ Jogar";
    if (code !== 0 && window.r36s.lastGame && window.r36s.lastGame.why && !/cancelado|voltou/.test(window.r36s.lastGame.why)) msg.textContent = `O jogo fechou: ${window.r36s.lastGame.why}`;
    playBtn.focus();
  });
  const tags = [sys ? sys.name : g.s, g.year, g.players && `${g.players} jogador${g.players === "1" ? "" : "es"}`, g.genre].filter(Boolean);
  const close = () => { box.remove(); removeEventListener("popstate", onPop); ctx.onClose(g); };
  const onPop = () => { if (document.getElementById("sheet") === box) close(); };
  const box = el("div", { id: "sheet", role: "dialog", "aria-modal": "true", "aria-label": g.name, onclick: e => { if (e.target === box) history.back(); } },
    el("div", { class: "panel" },
      el("button", { type: "button", class: "x", "data-nav": true, "aria-label": "Fechar", text: "✕", onclick: () => history.back() }),
      el("div", { class: "shot" }, ctx.media.img(g.shot || g.box)),
      el("h2", { text: g.name }),
      el("div", { class: "tags" }, ...tags.map(t => el("span", { text: String(t) }))),
      g.desc ? el("p", { class: "desc", text: g.desc }) : null,
      playable ? null : el("p", { class: "note", text: `Sem emulador no navegador${sys && sys.note ? `: ${sys.note}` : ""}.` }),
      el("div", { class: "btns" }, playBtn, favBtn, romBtn),
      msg));
  history.pushState({ sheet: true }, "");
  addEventListener("popstate", onPop);
  document.body.append(box);
  (playable ? playBtn : favBtn).focus();
  if (play && playable) playBtn.click();
  return box;
}
```

- [ ] **Step 5: `web/app/main.js`**

```js
// Seletor de jogos (substitui o EmulationStation): lê data/library.json.gz pelo io.js (hub, demo ou Drive), desenha as
// telas e abre o jogo com launch.js. Rotas no hash: #/ (Início), #/s/<sistema>[?ordem=ano], #/busca?q=…
import { createIO } from "../io.js";
import { installControls } from "../controls.js";
import { createLibrary } from "./library.js";
import { createMedia } from "./media.js";
import { createLauncher } from "./launch.js";
import { renderHome, renderSystem, renderSearch, renderSide, el } from "./views.js";
import { openSheet } from "./sheet.js";
import { installNav } from "./nav.js";
import * as P from "./prefs.js";

const t0 = performance.now();
const $ = s => document.querySelector(s);
const status = $("#status");
const showFatal = (what, e) => {
  if (window.r36s && window.r36s.error) return;
  const msg = String(e && (e.message || e) || e).slice(0, 300);
  status.className = "err";
  status.textContent = `Erro: ${what}. ${msg} — ${navigator.userAgent.replace(/^Mozilla\/5.0 /, "").slice(0, 120)}`;
  if (window.r36s) window.r36s.error = msg;
};
addEventListener("error", e => { if (!(window.r36s && window.r36s.ready)) showFatal("erro ao iniciar", e.error || e.message); });
addEventListener("unhandledrejection", e => { if (!(window.r36s && window.r36s.ready)) showFatal("erro ao iniciar", e.reason); });

const backend = new URLSearchParams(location.search).get("backend") || "hub";
const site = (() => { try { return parent !== window ? parent.r36sSite : null; } catch (e) { return null; } })();
if (backend !== "hub" && !site) { status.textContent = "abra pelo site (site/) para usar o Google Drive"; status.className = "err"; throw new Error("backend " + backend + " sem o site"); }
const io = createIO({ backend, site });
window.r36s = { ready: false, t0, backend, io };
const app = $("#app"), view = $("#view"), side = $("#side"), q = $("#q");
const controls = installControls({ canvas: app, siteMode: !!site, site });

let lib;
try {
  const r = await io.fetchFrom(location.href)("data/library.json.gz");
  if (r.status === 404) throw Object.assign(new Error("biblioteca sem library.json.gz"), { old: true });
  if (!r.ok) throw new Error(`library.json.gz HTTP ${r.status}`);
  // gzip feito pelo gerador (o hub e o Drive podem mandar sem compressão): descompacta aqui
  lib = createLibrary(await new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).json());
} catch (e) {
  status.className = "err";
  status.textContent = e.old ? "Esta biblioteca precisa ser atualizada: rode data/mkmanifest.py --drive-ids e build/upload/sobe.sh (docs/deploy.md)." : `Não deu para abrir a biblioteca: ${e.message}`;
  window.r36s.error = e.message;
  throw e;
}
const media = createMedia(io);
const launch = await createLauncher({ io, site, focusBack: () => (document.querySelector("#sheet .play") || app).focus() });
window.r36s.launch = launch;
q.placeholder = `Buscar em ${lib.total.toLocaleString("pt-BR")} jogos`;

const ctx = {
  lib, media, io,
  go: (hash, replace) => { replace ? history.replaceState(null, "", hash) : history.pushState(null, "", hash); route(); },
  openSheet: (g, opts) => openSheet(sheetCtx, g, opts),
};
const sheetCtx = {
  lib, media, io,
  launch: async g => { const code = await launch({ system: g.s, core: "", rom: g.rom }); if (window.r36s.lastGame && window.r36s.lastGame.started) P.played(g.rom); return code; },
  // fecha a ficha: volta o foco para a mesma capa (o Início é refeito: recentes/favoritos podem ter mudado)
  onClose: g => {
    const rom = last && last.dataset.rom || g.rom;
    if (current === "home") refreshHome();
    const back = last && document.contains(last) ? last : view.querySelector(`[data-rom="${CSS.escape(rom)}"]`);
    (back || app).focus({ preventScroll: true });
  },
};
let current = null, last = null;
document.addEventListener("focusin", e => { if (e.target.closest && e.target.closest("#view")) last = e.target; });
// Início refeito ao fechar a ficha (recentes/favoritos mudaram), mantendo a rolagem
function refreshHome() { const y = scrollY; view.replaceChildren(renderHome(ctx)); scrollTo(0, y); }

function route() {
  const h = location.hash || "#/";
  const [path, query] = h.slice(1).split("?");
  const params = new URLSearchParams(query || "");
  let node;
  if (path.startsWith("/s/")) { current = decodeURIComponent(path.slice(3)); node = renderSystem(ctx, current, params.get("ordem") === "ano" ? "ano" : "az"); }
  else if (path === "/busca") { current = "busca"; const v = params.get("q") || ""; if (q.value !== v) q.value = v; node = renderSearch(ctx, v); }
  else { current = "home"; node = renderHome(ctx); }
  view.replaceChildren(node);
  side.replaceChildren(...renderSide(ctx, current));
  if (current !== "busca") scrollTo(0, 0);
}
addEventListener("hashchange", route);
let typing = 0;
q.addEventListener("input", () => {
  clearTimeout(typing);
  typing = setTimeout(() => ctx.go(`#/busca?q=${encodeURIComponent(q.value)}`, location.hash.startsWith("#/busca")), 120);
});
$(".brand").addEventListener("click", () => ctx.go("#/"));

// menu ≡: Comandos (painel de controles), tela cheia, voltar ao site
const menu = el("div", { id: "menu-pop", role: "menu", hidden: true });
const item = (label, fn) => el("button", { type: "button", role: "menuitem", "data-nav": true, text: label, onclick: () => { menu.hidden = true; fn(); } });
menu.append(item("Comandos", () => controls.open()),
  item("Tela cheia", () => (document.fullscreenElement ? document.exitFullscreen() : (parent !== window ? parent.document.documentElement : document.documentElement).requestFullscreen()).catch(() => {})),
  ...(site && site.exit ? [item("Voltar ao site", () => site.exit())] : []));
document.body.append(menu);
$("#menu").addEventListener("click", () => { menu.hidden = !menu.hidden; if (!menu.hidden) menu.querySelector("button").focus(); });

installNav({ blocked: () => !!window.r36s.game || !!controls.panel,
  back: () => {
    if (!menu.hidden) { menu.hidden = true; return $("#menu").focus(); }
    if (document.getElementById("sheet")) return history.back();
    if (current !== "home") return ctx.go("#/");   // não usa history.back(): no iframe ele pode voltar a página do site
  } });

route();
status.remove();
(view.querySelector("[data-nav]") || app).focus({ preventScroll: true });
window.r36s.ready = true;
window.r36s.readyMs = Math.round(performance.now() - t0);
setTimeout(() => io.loadIndex().catch(e => console.warn("[r36s] índice do emulador", e)), 1500);   // pronto para o ▶
```

- [ ] **Step 5b: `web/app/nav.js`** (testado na Task 7)

```js
// Navegação do seletor por controle, teclado e direcional de toque. O controle chega aqui como as teclas do layout do
// R36S (web/controls.js: WASD, L = A, K = B, Enter = Start, Backspace = Select), como eventos sintéticos; o teclado
// também vale com setas, Enter e Esc. Foco espacial: a seta vai para o [data-nav] visível mais perto naquela direção.
const DIR = { w: "up", ArrowUp: "up", s: "down", ArrowDown: "down", a: "left", ArrowLeft: "left", d: "right", ArrowRight: "right" };

function visible(e) { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.closest("[hidden]"); }
function scope() { return document.getElementById("sheet") || document.querySelector("#menu-pop:not([hidden])") || document; }

export function move(dir) {
  const cur = document.activeElement;
  const items = [...scope().querySelectorAll("[data-nav]")].filter(e => !e.disabled && visible(e));
  if (!items.length) return;
  if (!items.includes(cur)) return items[0].focus();
  const a = cur.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  const horiz = dir === "left" || dir === "right";
  let best = null, bestD = Infinity;
  for (const e of items) {
    if (e === cur) continue;
    const b = e.getBoundingClientRect(), dx = b.left + b.width / 2 - ax, dy = b.top + b.height / 2 - ay;
    const ahead = dir === "right" ? dx > 4 : dir === "left" ? dx < -4 : dir === "down" ? dy > 4 : dy < -4;
    if (!ahead) continue;
    const d = horiz ? Math.abs(dx) + Math.abs(dy) * 3 : Math.abs(dy) + Math.abs(dx) * 3;
    if (d < bestD) { bestD = d; best = e; }
  }
  if (!best) return;
  best.focus({ preventScroll: true });
  best.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
}

// blocked(): jogo aberto ou painel de comandos (as teclas são deles); back(): o B/Esc
export function installNav({ blocked, back }) {
  addEventListener("keydown", e => {
    if (blocked()) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const typing = e.isTrusted && e.target instanceof HTMLInputElement;
    if (typing && (k.length === 1 || k === "Backspace" || k === "ArrowLeft" || k === "ArrowRight")) return;   // texto da busca
    const dir = DIR[k];
    if (dir) { e.preventDefault(); return move(dir); }
    const el = document.activeElement;
    if (k === "l" || (k === "Enter" && !e.isTrusted)) {   // A, ou Start do controle: aperta o que está em foco
      e.preventDefault();
      if (el && el !== document.body && el.click) el.click();
      return;
    }
    if (k === "k" || k === "Escape" || (k === "Backspace" && !typing)) { e.preventDefault(); back(); }
  });
}
```

(Enter de teclado de verdade num botão em foco já dispara `click` sozinho; por isso só o Enter sintético, o Start do controle, é tratado aqui.)

- [ ] **Step 5c: `web/app/download.js`** (testado na Task 8)

```js
// ⬇ ROM: salva o arquivo da ROM (para outro emulador ou para o R36S de verdade). Hub/demo: link direto. Drive: até
// BLOB_MAX baixa aqui (com o token no cabeçalho, progresso e cancelar); acima, abre a página do arquivo no Google
// Drive, que baixa sem passar pela memória do celular. O token nunca vai em URL.
const BLOB_MAX = 100 << 20;

function save(href, name) {
  const a = document.createElement("a");
  a.href = href; a.download = name; a.rel = "noopener"; a.style.display = "none";
  document.body.append(a); a.click(); a.remove();
}

// -> "link" | "blob" | "drive"
export async function downloadRom(io, g, onProgress, signal) {
  const name = g.rom.slice(g.rom.lastIndexOf("/") + 1);
  if (io.backend !== "drive") { save(io.romUrl(g.rom), name); return "link"; }
  if (!g.id) throw new Error("a biblioteca não tem o ID deste arquivo (gere o índice de novo)");
  if (g.size > BLOB_MAX) { window.open(`https://drive.google.com/file/d/${encodeURIComponent(g.id)}/view`, "_blank", "noopener"); return "drive"; }
  const r = await io.drive.media(g.id, { signal });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const total = Number(r.headers.get("Content-Length")) || g.size;
  const parts = [];
  let got = 0;
  if (r.body && r.body.getReader) {
    const rd = r.body.getReader();
    for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); got += value.length; onProgress(got, total); }
  } else parts.push(new Uint8Array(await r.arrayBuffer()));
  const url = URL.createObjectURL(new Blob(parts, { type: "application/octet-stream" }));
  save(url, name);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return "blob";
}
```

- [ ] **Step 6: `web/app/app.css`**

```css
/* Seletor de jogos — estilo "moderno e limpo" (mockup aprovado: .superpowers/brainstorm/.../telas.html):
   fundo quase preto, cantos arredondados, capas em destaque, fonte do sistema. */
:root { --bg: #0b0b10; --panel: #16161d; --chip: #1c1c24; --line: #26262f; --text: #f2f2f5; --muted: #8a8a99; --accent: #fff; --focus: #fff;
  --cover-w: 112px; color-scheme: dark; }
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
button, input, a { font: inherit; color: inherit; }
a { text-decoration: none; }
button { background: none; border: 0; padding: 0; cursor: pointer; }
:focus { outline: none; }
:focus-visible, [data-nav]:focus { outline: 3px solid var(--focus); outline-offset: 3px; border-radius: 12px; }
#app { min-height: 100vh; display: grid; grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
.top { position: sticky; top: 0; z-index: 5; display: flex; gap: 10px; align-items: center; padding: 12px 16px; background: linear-gradient(var(--bg) 70%, transparent); }
.brand { font-weight: 800; letter-spacing: .5px; }
.search { flex: 1; display: flex; gap: 8px; align-items: center; background: var(--chip); border-radius: 12px; padding: 8px 12px; color: var(--muted); }
.search input { flex: 1; min-width: 0; background: none; border: 0; color: var(--text); }
#menu { width: 40px; height: 40px; border-radius: 12px; background: var(--chip); }
#menu-pop { position: fixed; top: 60px; right: 16px; z-index: 40; display: flex; flex-direction: column; min-width: 200px; padding: 6px; background: var(--panel); border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 10px 40px #000a; }
#menu-pop[hidden] { display: none; }
#menu-pop button { text-align: left; padding: 10px 12px; border-radius: 10px; }
#side { display: none; }
#view { padding: 0 16px 32px; min-width: 0; }

.hero { position: relative; height: 200px; border-radius: 18px; overflow: hidden; background: var(--panel); margin: 4px 0 18px; }
.hero .bg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.hero::after { content: ""; position: absolute; inset: 0; background: linear-gradient(transparent 30%, #000d); }
.hero .txt { position: absolute; left: 16px; right: 16px; bottom: 14px; z-index: 1; display: flex; flex-direction: column; gap: 4px; }
.hero .kicker { color: #ddd; font-size: 13px; } .hero b { font-size: 20px; }
.play { align-self: flex-start; background: var(--accent); color: #000; font-weight: 700; border-radius: 999px; padding: 8px 18px; }
.play[disabled] { opacity: .5; cursor: default; }

.row { margin: 0 0 18px; content-visibility: auto; contain-intrinsic-size: auto 230px; }
.row h2 { display: flex; justify-content: space-between; align-items: baseline; margin: 0 0 8px; font-size: 17px; }
.row .more { color: var(--muted); font-size: 13px; font-weight: 400; padding: 4px 6px; }
.shelf { display: flex; gap: 10px; overflow-x: auto; scroll-snap-type: x proximity; padding: 4px 4px 8px; margin: 0 -4px; scrollbar-width: none; }
.shelf::-webkit-scrollbar { display: none; }
.cover { flex: 0 0 var(--cover-w); width: var(--cover-w); display: flex; flex-direction: column; gap: 6px; text-align: left; scroll-snap-align: start; }
.cover .art, .hit .art { position: relative; display: block; aspect-ratio: 3 / 4; border-radius: 10px; overflow: hidden; background: var(--chip); }
.cover .art img, .hit .art img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
img:not([src]), img.fail { opacity: 0; }
.ph { position: absolute; inset: 0; display: grid; place-items: center; padding: 8px; text-align: center; font-size: 12px; color: var(--muted); }
.cover .label { font-size: 12px; color: #c8c8d2; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.cover.off .art { filter: grayscale(1) brightness(.6); }

.sys-head { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: baseline; margin: 6px 0 14px; }
.sys-head h1 { margin: 0; font-size: 22px; } .count { color: var(--muted); }
.seg { margin-left: auto; display: flex; background: var(--chip); border-radius: 10px; padding: 3px; }
.seg button { padding: 5px 12px; border-radius: 8px; color: var(--muted); } .seg .on { background: var(--line); color: var(--text); }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(var(--cover-w), 1fr)); gap: 14px 10px; }
.grid .cover { width: auto; content-visibility: auto; contain-intrinsic-size: auto 190px; }
.note { color: #ffcf70; }
.results { display: flex; flex-direction: column; gap: 6px; }
.hit { display: flex; gap: 12px; align-items: center; padding: 6px; border-radius: 12px; text-align: left; }
.hit .art { width: 44px; flex: 0 0 44px; }
.hit .t { display: flex; flex-direction: column; } .hit small { color: var(--muted); }

#sheet { position: fixed; inset: 0; z-index: 20; background: #000a; display: flex; align-items: flex-end; justify-content: center; }
#sheet .panel { position: relative; width: 100%; max-width: 560px; max-height: 92vh; overflow: auto; background: var(--panel); border-radius: 20px 20px 0 0; padding: 14px 16px calc(16px + env(safe-area-inset-bottom)); display: flex; flex-direction: column; gap: 10px; }
#sheet .x { position: absolute; top: 18px; right: 22px; z-index: 1; width: 36px; height: 36px; border-radius: 50%; background: #000a; }
#sheet .shot { position: relative; aspect-ratio: 4 / 3; max-height: 40vh; border-radius: 14px; overflow: hidden; background: var(--chip); }
#sheet .shot img { width: 100%; height: 100%; object-fit: cover; }
#sheet h2 { margin: 0; font-size: 20px; }
#sheet .tags { display: flex; flex-wrap: wrap; gap: 6px; } #sheet .tags span { background: var(--line); border-radius: 6px; padding: 2px 8px; font-size: 13px; color: #c8c8d2; }
#sheet .desc { margin: 0; color: #c8c8d2; font-size: 14px; }
#sheet .btns { display: flex; gap: 8px; } #sheet .btns button { flex: 1; padding: 10px 0; border-radius: 999px; background: var(--line); font-weight: 600; }
#sheet .btns .play { flex: 2; background: var(--accent); color: #000; padding: 10px 0; }
#sheet .msg { margin: 0; color: var(--muted); font-size: 13px; min-height: 1em; }

#status { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); color: var(--muted); }
#status.err { color: #ffcf70; max-width: min(560px, 90vw); padding: 16px 20px; background: var(--panel); border: 1px solid #ffcf70; border-radius: 14px; z-index: 60; }
#game { position: fixed; inset: 0; width: 100%; height: 100%; border: 0; background: #000; z-index: 30; }
/* avisos do launch.js (sistema sem emulador, sem WebGL; PSP na aba isolada): os mesmos do index.html antigo */
#notice { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 50; max-width: 80%; padding: 18px 26px; border-radius: 14px;
  background: rgba(20,20,24,.95); color: #eee; font-size: 17px; text-align: center; box-shadow: 0 4px 30px #000; pointer-events: none; }
#notice small { display: block; margin-top: 6px; color: #aaa; font-size: 13px; }
#isolated { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 50; max-width: 80%; padding: 20px 28px; border-radius: 14px;
  background: rgba(20,20,24,.96); color: #eee; font-size: 17px; text-align: center; box-shadow: 0 4px 30px #000; }
#isolated small { display: block; margin: 8px 0 14px; color: #aaa; font-size: 13px; }
#isolated button { margin: 0 6px; padding: 8px 14px; border-radius: 999px; background: #fff; color: #000; font-weight: 600; }
#isolated button:last-child { background: var(--line); color: #eee; }

@media (min-width: 900px) {
  :root { --cover-w: 136px; }
  #app { grid-template-columns: 200px 1fr; }
  .top { grid-column: 1 / -1; }
  #side { display: flex; flex-direction: column; gap: 2px; padding: 8px 12px; position: sticky; top: 64px; align-self: start; max-height: calc(100vh - 64px); overflow: auto; }
  #side a { padding: 7px 10px; border-radius: 10px; color: #b9b9c6; } #side a.on { background: var(--chip); color: var(--text); }
  .hero { height: 260px; } .hero b { font-size: 26px; }
  #sheet { align-items: center; } #sheet .panel { border-radius: 20px; }
}
```

- [ ] **Step 7: Ver no navegador (hub), celular e PC**

Script descartável no scratchpad (`shots.mjs`): abre `http://localhost:8770/r36s/` em `{width: 412, height: 915, isMobile: true, hasTouch: true}` e em `{width: 1280, height: 800}`, espera `window.r36s.ready`, rola até a 2ª fileira, tira prints em `tests/out/seletor-celular.png` e `tests/out/seletor-pc.png`, clica na 1ª capa do snes (`[data-sys="snes"] .cover`) e tira `tests/out/ficha-celular.png`. Registrar `pageerror` e falhar se houver algum.

Run: `systemd-run --user --scope -q -p MemoryMax=12G node <shots.mjs>`
Expected: sem `pageerror`; olhar os 3 prints com a ferramenta Read e comparar com o mockup aprovado (prateleiras, capas reais, ficha de baixo).

- [ ] **Step 8: Commit**

```bash
git add web/index.html web/app/main.js web/app/views.js web/app/sheet.js web/app/media.js web/app/nav.js web/app/download.js web/app/app.css
git commit -m "seletor: página nova (Início com prateleiras, grade do sistema, busca, ficha, barra lateral no PC) no lugar do ES"
```

---

### Task 7: navegação por controle e teclado; `controls.js` sem ES

**Files:**
- Create: `web/app/nav.js`, `tests/nav_pad.mjs`
- Modify: `web/controls.js`, `web/controls.css`

- [ ] **Step 1: Escrever o teste que falha — `tests/nav_pad.mjs`**

```js
// node tests/nav_pad.mjs
// Seletor só no controle (simulado): o direcional anda entre as capas, A abre a ficha, B fecha e volta para a capa,
// Start na ficha joga, Select+Start sai do jogo e o foco volta para "Jogar".
import { chromium } from "/home/andre/Workspace/web-ports/tools/pw/node_modules/playwright-core/index.mjs";
const b = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const c = await b.newContext({ viewport: { width: 1280, height: 800 } });
await c.addInitScript(() => {
  if (window !== window.top) return;
  const pad = { id: "Xbox 360 Controller (XInput STANDARD GAMEPAD)", index: 0, connected: true, mapping: "standard", timestamp: 1,
    axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
  window.__pad = pad;
  Object.defineProperty(Navigator.prototype, "getGamepads", { configurable: true, writable: true, value: () => [pad, null, null, null] });
});
const p = await c.newPage();
const errs = []; p.on("pageerror", e => errs.push(e.message));
await p.goto("http://localhost:8770/r36s/");
await p.waitForFunction(() => window.r36s && window.r36s.ready, null, { timeout: 60000 });
const press = async (...btns) => {
  await p.evaluate(bs => { for (const i of bs) window.__pad.buttons[i] = { pressed: true, touched: true, value: 1 }; }, btns);
  await p.waitForTimeout(120);
  await p.evaluate(bs => { for (const i of bs) window.__pad.buttons[i] = { pressed: false, touched: false, value: 0 }; }, btns);
  await p.waitForTimeout(180);
};
const focused = () => p.evaluate(() => { const e = document.activeElement; return e && (e.dataset.rom || e.className || e.id); });
const r = {};
// do topo para a primeira capa da 1ª fileira de sistema: baixo algumas vezes até cair numa capa
for (let i = 0; i < 6 && !/^\/roms\//.test(await focused()); i++) await press(13);
r.first = await focused();
await press(15); r.right = await focused();          // direita
await press(1); await p.waitForTimeout(300);          // A (direita do controle = A do R36S) abre a ficha
r.sheet = await p.evaluate(() => !!document.getElementById("sheet") && document.activeElement.className);
await press(0); await p.waitForTimeout(300);          // B fecha
r.back = await focused();
await press(1); await p.waitForTimeout(300);
await press(9);                                       // Start na ficha = Jogar
await p.waitForFunction(() => window.r36s.game && window.r36s.game.started, null, { timeout: 90000 }).catch(() => {});
r.started = await p.evaluate(() => !!(window.r36s.game && window.r36s.game.started));
await p.keyboard.down("Backspace"); await p.waitForTimeout(300); await p.keyboard.down("Enter"); await p.waitForTimeout(400);
await p.keyboard.up("Enter"); await p.keyboard.up("Backspace");
await p.waitForFunction(() => !window.r36s.game, null, { timeout: 20000 }).catch(() => {});
await p.waitForTimeout(300);
r.after = await p.evaluate(() => document.activeElement && document.activeElement.className);
const ok = /^\/roms\//.test(r.first) && r.right !== r.first && /^\/roms\//.test(r.right) && /play/.test(r.sheet) && r.back === r.right && r.started && /play/.test(r.after) && !errs.length;
console.log(JSON.stringify({ ok, ...r, errs }));
await b.close();
process.exit(ok ? 0 : 1);
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `systemd-run --user --scope -q -p MemoryMax=12G node tests/nav_pad.mjs`
Expected: pode já passar no hub (o `nav.js` veio na Task 6 e o painel de comandos só abre sozinho no modo site). Anotar o resultado e seguir: o Step 4 é necessário de qualquer jeito (o toque e o painel automático cobririam o seletor no celular e no site).

- [ ] **Step 3: `web/app/nav.js`**

Já criado na Task 6 (Step 5b). Conferir que o arquivo é igual ao código de lá.

- [ ] **Step 4: `web/controls.js` sem o ES**

1. Comentário do topo: trocar "por cima do ES" por "por cima do seletor (web/index.html)" e "no ES vira teclas do layout (o SDL do ES não vê o controle)" por "no seletor vira as teclas do layout (web/app/nav.js)". Nas outras ocorrências de "ES" em comentários, usar "seletor".
2. Em `poll`, quando `inGame` muda: `document.body.classList.toggle("r36s-ingame", inGame);` (logo depois de `sticks();`).
3. Apagar a linha `if (siteMode && store.get("r36s-comandos-off") !== "1") openPanel();` (o painel abre pelo menu ≡ do seletor ou pelo "?").
4. Em `closePanel`: `(w === window ? canvas : …)` continua; o seletor passa `canvas: #app`.
5. Em `installTouch`, o menu ≡ do toque só existe no jogo: nada a mudar no código (o CSS esconde o toque fora do jogo).

Em `web/controls.css`, no fim:

```css
/* seletor: o joystick de toque e o "?" só aparecem no jogo (fora dele, o toque é na própria tela) */
body:not(.r36s-ingame) #r36s-touch, body:not(.r36s-ingame) #r36s-help, body:not(.r36s-ingame) #r36s-sheet { display: none; }
```

- [ ] **Step 5: Rodar e ver passar**

Run: `systemd-run --user --scope -q -p MemoryMax=12G node tests/nav_pad.mjs`
Expected: `"ok":true`.

- [ ] **Step 6: Commit**

```bash
git add web/app/nav.js web/controls.js web/controls.css tests/nav_pad.mjs
git commit -m "seletor: navegação por controle/teclado (foco espacial; A abre, B volta, Start joga); controles sem o ES, toque só no jogo"
```

---

### Task 8: ⬇ ROM

**Files:**
- Create: `web/app/download.js`, `tests/download.mjs`

- [ ] **Step 1: Escrever o teste que falha — `tests/download.mjs`**

```js
// node tests/download.mjs
// ⬇ ROM no hub: o arquivo baixado é igual ao do cartão. No Drive (mock): ROM pequena vira blob com o nome original;
// acima de 100 MB abre a página do arquivo no Google Drive numa aba nova (sem segurar o arquivo na memória).
import { chromium } from "/home/andre/Workspace/web-ports/tools/pw/node_modules/playwright-core/index.mjs";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
const b = await chromium.launch({ executablePath: "/usr/bin/chromium" });
const c = await b.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 800 } });
const p = await c.newPage();
await p.goto("http://localhost:8770/r36s/#/s/gbc");
await p.waitForFunction(() => window.r36s && window.r36s.ready, null, { timeout: 60000 });
const rom = await p.evaluate(() => document.querySelector(".cover").dataset.rom);
await p.click(".cover");
const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#sheet .rom")]);
const got = createHash("md5").update(readFileSync(await dl.path())).digest("hex");
const want = createHash("md5").update(readFileSync("/home/andre/Workspace/web-ports/r36s/card" + rom)).digest("hex");
// Drive: io falso por cima do download.js (as duas ramificações)
const drive = await p.evaluate(async () => {
  const { downloadRom } = await import("/r36s/app/download.js");
  const opened = []; const origOpen = window.open; window.open = (u) => { opened.push(u); return null; };
  const io = { backend: "drive", drive: { media: async () => new Response(new Uint8Array(1234)) } };
  const small = await downloadRom(io, { rom: "/roms/gbc/x.gbc", size: 1234, id: "ID1" }, () => {});
  const big = await downloadRom(io, { rom: "/roms/psx/y.chd", size: 300 << 20, id: "ID2" }, () => {});
  window.open = origOpen;
  return { small, big, opened };
});
const ok = got === want && drive.small === "blob" && drive.big === "drive" && drive.opened[0] === "https://drive.google.com/file/d/ID2/view";
console.log(JSON.stringify({ ok, rom, name: dl.suggestedFilename(), same: got === want, drive }));
await b.close();
process.exit(ok ? 0 : 1);
```

- [ ] **Step 2: Rodar**

Run: `systemd-run --user --scope -q -p MemoryMax=12G node tests/download.mjs`
Expected: `"ok":true` (o `download.js` foi criado na Task 6; este teste é a verificação dele). Se falhar, corrigir o `download.js`.

- [ ] **Step 3: `web/app/download.js`**

Já criado na Task 6 (Step 5c). Conferir que o arquivo é igual ao código de lá.

- [ ] **Step 4: Rodar e ver passar**

Run: `systemd-run --user --scope -q -p MemoryMax=12G node tests/download.mjs`
Expected: `"ok":true`.

- [ ] **Step 5: Commit**

```bash
git add web/app/download.js tests/download.mjs
git commit -m "seletor: botão ⬇ ROM (link direto no hub/demo; Drive: blob até 100 MB, acima abre o arquivo no Google Drive)"
```

---

### Task 9: tirar o ES do projeto

**Files:**
- Delete: `web/emulationstation.js`, `web/emulationstation.wasm`, `web/fsboot.js`, `web/bridge.js`, `build/build-es.sh`, `build/es-out/`, `patches/es/`, `tests/flicker.mjs`, `tests/eslist.mjs`, `web/site/demo/fs/usr`, `web/site/demo/fs/etc/emulationstation/es_input.cfg`, `web/site/demo/fs/home/ark/.emulationstation`, `web/site/demo/fs/roms/themes`
- Modify: `web/retroarch/play.js`, `web/site/site.js`, `data/mkdemo.py`, `build/site-dist.sh`, `build/upload/sobe.sh`, `.gitignore` (se citar `src/es`)

- [ ] **Step 1: Conferir o que está versionado antes de apagar**

Run: `git ls-files web/emulationstation.js web/emulationstation.wasm web/fsboot.js web/bridge.js build/build-es.sh build/es-out patches/es tests/flicker.mjs tests/eslist.mjs web/site/demo/fs | head -50; ls src 2>/dev/null`
Expected: lista dos arquivos versionados. `src/es` é gitignored e **não é apagado nesta tarefa** (é o fork local; o andre decide depois). Arquivos não versionados (`web/emulationstation.*`, `build/es-out`) são apagados com `rm`.

- [ ] **Step 2: Apagar**

```bash
git rm -r --quiet web/fsboot.js web/bridge.js build/build-es.sh patches/es tests/flicker.mjs tests/eslist.mjs \
  web/site/demo/fs/usr web/site/demo/fs/home/ark/.emulationstation web/site/demo/fs/roms/themes web/site/demo/fs/etc/emulationstation/es_input.cfg 2>&1 | tail -3
rm -rf web/emulationstation.js web/emulationstation.wasm build/es-out
```

(Ajustar a lista ao que o Step 1 mostrou: `git rm` só no que é versionado.)

- [ ] **Step 3: `web/retroarch/play.js` — manifest pelo `io` do seletor**

Em `loadManifest`, trocar a linha `try { if (embedded && parent.r36s && parent.r36s.fs && parent.r36s.fs.manifest) return parent.r36s.fs.manifest; } catch (e) {}` por:

```js
  try { if (embedded && parent.r36s && parent.r36s.io) return (await parent.r36s.io.loadIndex()).manifest; } catch (e) {}
```

e trocar no comentário "manifesto do FS do ES (o pai já tem; sozinho, baixa)" por "manifesto do cartão (o seletor já tem; sozinho, baixa)".

- [ ] **Step 4: `web/site/site.js`**

- `mountES`/`unmountES` → `mountApp`/`unmountApp` (e as chamadas em `route`), `esFrame` → `appFrame`, `title: "EmulationStation"` → `title: "R36S"`.
- Texto do demo em `renderNone`: "Abre o ES com jogos homebrew livres…" → "Abre a biblioteca com jogos homebrew livres que já vêm no site."
- Comentário do topo: "ES em tela cheia" → "seletor de jogos em tela cheia".

- [ ] **Step 5: `data/mkdemo.py` sem recursos do ES**

Substituir `main` por:

```python
def main():
    n, size = mkmanifest.build(os.path.join(DEMO, "fs"), os.path.join(DEMO, "data"),
                               cores=os.path.join(ROOT, "web", "data", "cores.json"))
    print(f"demo: {n} arquivos, eager.bin {size / 1e6:.1f} MB")
```

Docstring: "Monta o modo demonstração do site: web/site/demo/fs/ (versionado: homebrews livres e configs) -> web/site/demo/data/{manifest.json,eager.bin,library.json.gz}." Apagar `argparse`/`shutil`/`--resources`.

Run: `python3 data/mkdemo.py && python3 -c "import json,gzip;l=json.load(gzip.open('web/site/demo/data/library.json.gz'));print([s['id'] for s in l['systems']],len(l['games']))"`
Expected: `['nes', 'gbc'] 3` (ou na ordem do `cores.json`).

- [ ] **Step 6: `build/site-dist.sh`**

- Cabeçalho: "+ seletor (index.html, app/, io.js, drive.js, controls.*, settings.js, config-ui.js)" no lugar de "+ ES (index.html, emulationstation.*)".
- A checagem `for f in emulationstation.js emulationstation.wasm data/cores.json` vira `for f in data/cores.json app/main.js`.
- `cp -L "$WEB"/index.html "$WEB"/*.js "$WEB"/*.css "$WEB"/emulationstation.wasm "$OUT/"` vira:

```bash
cp -L "$WEB"/index.html "$WEB"/*.js "$WEB"/*.css "$OUT/"
mkdir -p "$OUT/app"; cp -L "$WEB"/app/*.js "$WEB"/app/*.css "$OUT/app/"
```

- No `_headers`, o comentário "O ES (/index.html) só abre num iframe do site" → "O seletor (/index.html) só abre num iframe do site". `_redirects`: "o ES fica em /index.html" → "o seletor fica em /index.html".
- Ao final, conferir que não sobrou nada do ES: `! ls "$OUT" | grep -qi emulationstation || { echo "sobrou arquivo do ES no dist" >&2; exit 1; }`.

- [ ] **Step 7: `build/upload/sobe.sh`**

Apagar a etapa `== 1 tema` e a pasta `themes` do envio (acrescentar `--exclude "themes/**"` em `C=(...)`); renumerar as etapas. O índice (`indice()`) já sobe a pasta inteira `web-index` (agora com `library.json.gz`).

- [ ] **Step 8: Conferir que nada mais importa o que saiu**

Run: `grep -rn "fsboot\|bridge.js\|emulationstation\.\(js\|wasm\)\|webLaunch\|r36s\.fs\b\|r36s\.Module" web build tests data docs/deploy.md 2>/dev/null | grep -v "^web/site/demo/LICENSES"`
Expected: só ocorrências em testes ainda não adaptados (Task 10) e em docs; nada em `web/`, `build/` ou `data/`.

- [ ] **Step 9: Commit**

```bash
git add -A web build data tests .gitignore
git commit -m "tira o EmulationStation: wasm, fsboot, bridge, build e patches do ES, tema e recursos do demo; dist e upload sem ele"
```

---

### Task 10: adaptar os testes de navegador

**Files:**
- Modify: `tests/e2e_systems.mjs`, `tests/e2e_site.mjs`, `tests/quit_loading.mjs`, `tests/touch_game.mjs`, `tests/touch_sticks.mjs`, `tests/controls_config.mjs`, `tests/mobile_demo.mjs`, `tests/play_mobile.mjs`, `tests/drive_boot.mjs`

Regra geral para todos: `window.r36s.Module.webLaunch(x)` → `window.r36s.launch(x)`; esperar `window.r36s.ready` continua valendo; o que lia o canvas do ES (`lit(page)`, `#canvas` do topo) sai; teclas mandadas ao ES passam a ser ações no seletor.

- [ ] **Step 1: `tests/quit_loading.mjs`**

Trocar a linha 12 (`launch`) por `window.r36s.launch({ … })` e apagar `window.r36s.controls.close()` (o painel não abre mais sozinho). Rodar:
`systemd-run --user --scope -q -p MemoryMax=12G node tests/quit_loading.mjs` → `"ok":true`.

- [ ] **Step 2: `tests/touch_game.mjs`, `tests/touch_sticks.mjs`, `tests/controls_config.mjs`, `tests/play_mobile.mjs`, `tests/mobile_demo.mjs`, `tests/drive_boot.mjs`**

Aplicar a regra geral. Em `controls_config.mjs`, a parte "no ES: Espaço vira l" passa a ouvir `keydown` sintético no `document` (`document.addEventListener("keydown", e => { if (!e.isTrusted) window.__keys.push(e.key); })`) em vez do `#canvas`, e foca `#app` em vez do canvas. Em `touch_sticks.mjs`, "antes" (fora do jogo) espera `#r36s-touch` invisível (`display: none`). Em `drive_boot.mjs`, trocar a espera do ES desenhando por `window.r36s.ready` + `document.querySelectorAll(".cover img[src]").length > 0` (capas vieram do Drive) e medir `readyMs`. Rodar cada um e ver `"ok":true` (o `drive_boot` precisa do token do rclone; se der 403 de cota, registrar e seguir).

- [ ] **Step 3: `tests/e2e_systems.mjs` pelo seletor**

Substituir o bloco do carrossel/lançamento (do `await page.goto(url)` até `if (!launched) throw…`, e o ramo `if (!r.core)` inteiro) por:

```js
    await page.goto(`${url}#/s/${system}`);
    await page.waitForFunction(() => window.r36s?.ready, null, { timeout: 60000 });
    if (!(await page.$(".grid .cover"))) throw new Error("sem jogos no cartão");
    await page.click(".grid .cover");
    await page.waitForSelector("#sheet");
    await page.screenshot({ path: `${out}/e2e-sys-${system}-0-ficha.png` });
    if (!r.core) {   // sem núcleo web: a ficha explica e o Jogar fica desligado
      r.note = await page.locator("#sheet .note").textContent().catch(() => null);
      r.playDisabled = await page.locator("#sheet .play").isDisabled();
      r.ok = !!r.note && r.playDisabled;
      continue;
    }
    const t0 = Date.now();
    await page.click("#sheet .play");
    const launched = await page.waitForFunction(() => window.r36s.game || window.r36s.lastGame, null, { timeout: 6000 }).then(() => true, () => false);
    if (!launched) throw new Error("nada foi lançado");
    const g = await page.evaluate(() => { const x = window.r36s.game || window.r36s.lastGame; return { rom: x.rom, core: x.core, why: x.why }; });
    Object.assign(r, { rom: g.rom });
    if (!g.rom.startsWith(`/roms/${system}/`)) r.wrongSystem = true;
```

As linhas `const cores …`/`visible` continuam (só `visible` e `idx` saem). Nas verificações finais, `r.esLit = …` vira `r.backFocus = back ? await page.evaluate(() => document.activeElement && document.activeElement.className) : null;` e o `ok` usa `/play/.test(r.backFocus || "")` no lugar de `r.esLit > 0.05`. Cabeçalho do arquivo: descrever o fluxo novo (grade do sistema → ficha → Jogar → Backspace+Enter → foco volta em Jogar; sem núcleo web: ficha com a nota e Jogar desligado).

Run: `systemd-run --user --scope -q -p MemoryMax=12G node tests/e2e_systems.mjs`
Expected: `"ok": 23, "total": 23`.

- [ ] **Step 4: `tests/e2e_site.mjs` pelo seletor**

- `waitES(p)` → `waitApp(p)`: o frame cujo URL termina em `/index.html?backend=…` com `window.r36s.ready`.
- Seção 4 (Drive): apagar as checagens do painel automático e do `esLit`; no lugar: `const covers = await app.evaluate(() => document.querySelectorAll(".cover").length)` e esperar capas com `src` (`.cover img[src]`), `check(covers > 0 && imgs > 0, "seletor mostrou capas vindas do Drive")`. Lançar o µCity com `await app.click('[data-sys="gbc"] .cover')` e `await app.click("#sheet .play")`. A segunda abertura: `await app.click("#sheet .play")` (a ficha continua aberta).
- Seção 5 (demo, 2 jogadores): `es.evaluate(() => window.r36s.controls.close())` sai; o registro de teclas troca o `#canvas` pelo `document` (só eventos não confiáveis); o lançamento do jogo do demo vira: `await app.click(".cover")` + `await app.click("#sheet .play")`.
- PSP (aba isolada): o motivo esperado `"voltou pela aba do ES"` vira `"voltou pela aba do seletor"`.

Run: `systemd-run --user --scope -q -p MemoryMax=12G sh -c 'E2E_TIMEOUT=400 node tests/e2e_site.mjs'`
Expected: `"errors": []`, `"fatal": []`.

- [ ] **Step 5: Commit**

```bash
git add tests
git commit -m "testes sem o ES: sistemas, site, toque, controles e saída durante o carregamento pelo seletor"
```

---

### Task 11: medir desempenho (critérios da spec)

**Files:**
- Create: `tests/perf_home.mjs`

- [ ] **Step 1: Escrever `tests/perf_home.mjs`**

```js
// node tests/perf_home.mjs [url]
// Critérios da spec: primeira tela no celular simulado com < 1 MB transferido fora as imagens e sem pedir o manifest
// antes de aparecer; rolar a grade do maior sistema sem quadros longos (> 100 ms) demais.
import { chromium } from "/home/andre/Workspace/web-ports/tools/pw/node_modules/playwright-core/index.mjs";
const url = process.argv[2] || "http://localhost:8770/r36s/";
const b = await chromium.launch({ executablePath: "/usr/bin/chromium" });
const c = await b.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2.6 });
const p = await c.newPage();
const cdp = await c.newCDPSession(p);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });   // celular médio
const reqs = [];
p.on("requestfinished", async r => { const s = await r.sizes().catch(() => null); reqs.push({ url: r.url(), t: Date.now(), bytes: s ? s.responseBodySize + s.responseHeadersSize : 0 }); });
const t0 = Date.now();
await p.goto(url);
await p.waitForFunction(() => window.r36s && window.r36s.ready, null, { timeout: 60000 });
const tReady = Date.now();
const before = reqs.filter(r => r.t <= tReady);
const nonImg = before.filter(r => !/\.(png|jpe?g|webp|gif)(\?|$)/i.test(r.url) && !r.url.startsWith("blob:"));
const kb = Math.round(nonImg.reduce((a, r) => a + r.bytes, 0) / 1024);
const manifestEarly = before.some(r => /manifest\.json|eager\.bin/.test(r.url));
// maior sistema: rolar a grade inteira
const sys = await p.evaluate(() => [...document.querySelectorAll(".row[data-sys] .more")].map(a => [a.href.split("/s/")[1], +a.textContent.replace(/\D/g, "")]).sort((a, b) => b[1] - a[1])[0][0]);
await p.goto(`${url}#/s/${sys}`); await p.waitForTimeout(1500);
const long = await p.evaluate(async () => {
  let n = 0; const obs = new PerformanceObserver(l => { for (const e of l.getEntries()) if (e.duration > 100) n++; }); obs.observe({ type: "longtask", buffered: false });
  for (let y = 0; y < document.body.scrollHeight; y += 600) { scrollTo(0, y); await new Promise(r => requestAnimationFrame(() => setTimeout(r, 30))); }
  obs.disconnect(); return n;
});
const covers = await p.evaluate(() => document.querySelectorAll(".grid .cover").length);
const ok = kb < 1024 && !manifestEarly && long <= 5;
console.log(JSON.stringify({ ok, readyMs: tReady - t0, kbBeforeReady: kb, manifestEarly, system: sys, covers, longTasks: long }));
await b.close();
process.exit(ok ? 0 : 1);
```

- [ ] **Step 2: Rodar**

Run: `systemd-run --user --scope -q -p MemoryMax=12G node tests/perf_home.mjs`
Expected: `"ok":true`. Se `kbBeforeReady` passar de 1024, o vilão é o `library.json.gz`: medir com `ls -la web/data/library.json.gz` e, se preciso, cortar `desc` em 300 caracteres no `read_gamelist` (o hub não comprime; o Netlify e o Drive mandam gzip — anotar os dois números). Se `longTasks` passar de 5, reduzir o custo da grade (ex.: `content-visibility` já está; checar se `createMedia` observa elementos demais e trocar `rootMargin` para `200px`).

- [ ] **Step 3: Commit**

```bash
git add tests/perf_home.mjs
git commit -m "tests/perf_home.mjs: primeira tela < 1 MB sem o manifest e rolagem da maior grade"
```

---

### Task 12: bateria completa, Drive real, celular e publicação

- [ ] **Step 1: Bateria completa**

```bash
cd /home/andre/Workspace/web-ports/r36s
python3 -m unittest tests.test_library tests.test_mkmanifest tests.test_drive_manifest tests.test_saves -v 2>&1 | tail -3
node tests/test_app.mjs | tail -1; node tests/test_settings.mjs | tail -1; node tests/test_auth.mjs
for t in nav_pad download quit_loading touch_game touch_sticks controls_config perf_home; do systemd-run --user --scope -q -p MemoryMax=12G node tests/$t.mjs | tail -1; done
systemd-run --user --scope -q -p MemoryMax=12G node tests/e2e_systems.mjs | tail -4
systemd-run --user --scope -q -p MemoryMax=12G sh -c 'E2E_TIMEOUT=400 node tests/e2e_site.mjs' | tail -4
md5sum "saves/snes/Donkey Kong Country 3 - Dixie Kong's Double Trouble! (USA) (PT-BR).srm"; ls saves/*
```

Expected: tudo ok; md5 `42a492ce4260a522416a75be0ebd353e`; só o save do DK3 em `saves/` (apagar o resto criado por teste, restaurar o DK3 do cartão se mudou).

- [ ] **Step 2: Índice no Drive real — PEDIR CONFIRMAÇÃO AO ANDRE ANTES**

Escreve no Drive dele (`gdrive:R36S/.web`). Com o ok:

```bash
cd /home/andre/Workspace/web-ports/r36s
rclone lsjson -R --hash --files-only gdrive:R36S > build/upload/lsjson.json
rm -rf build/upload/web-index && python3 data/mkmanifest.py card build/upload/web-index --drive-ids build/upload/lsjson.json
rclone copy build/upload/web-index gdrive:R36S/.web
```

Depois, `tests/drive_boot.mjs` contra o Drive real (seletor aparece, capas do Drive, um jogo abre).

- [ ] **Step 3: Celular — com o andre**

`build/site-dist.sh` e, **com o ok dele**, deploy: `set -a; source ~/.config/claude-creds/secrets.env; set +a; python3 -I build/netlify-deploy.py bf340a01-9fff-4c31-b6b0-ef6f3f131262 dist "seletor de jogos"`; conferir os md5 de `index.html` e `app/main.js` no ar com `curl`. O andre testa no A54: Início, rolar, busca, ficha, jogar, voltar, ⬇ ROM pequena e grande, controle Bluetooth se tiver.

- [ ] **Step 4: GitHub — com o ok dele**

Para cada commit novo desde `fc0c7b6`, no `r36s-publish`: `git -C ../r36s format-patch -1 <c> --stdout | sed 's/^From: .*@<domínio de trabalho>.*$/From: andrR89 <3686269+andrR89@users.noreply.github.com>/I' | git am -q`; conferir `git log -p origin/main..HEAD | grep -ci <empresa>` = 0 e que nenhum arquivo de ROM/BIOS/save entrou (`git diff --stat origin/main..HEAD`); `git push`. Atualizar o README do `r36s-publish` (o ES saiu; o seletor é a tela principal) num commit à parte.

- [ ] **Step 5: Memória e vault**

Atualizar `projeto-web-ports.md` (memória) com: ES removido, seletor em `web/app/`, `library.json.gz` no índice. Oferecer ao andre a nota na knowledge-vault (não gravar sem o ok).
