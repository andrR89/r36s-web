#!/usr/bin/env python3
"""Gera manifest.json + eager.bin + library.json.gz (seletor de jogos: sistemas, jogos, metadados dos gamelist.xml) a partir de uma árvore de cartão (card/ ou card-sample/).

Modo cartão (há um es_systems.cfg em /etc/emulationstation ou ~/.emulationstation): só entra o que o ES usa —
ROMs (extensões do sistema, como arquivos vazios), gamelist.xml (eager), mídia citada nos gamelists ou em images/
(LocalArt, sob demanda), BIOS (sob demanda, para o player), o tema ativo (xml/fontes/svg eager, o resto sob demanda).
O resto do cartão (dados de ports, lixeira, música, ocultos) fica de fora. Sem es_systems.cfg: regra antiga por extensão.
Os symlinks da árvore são seguidos (card/roms -> cartão montado).

Modo Drive (--drive-ids <lsjson>): a listagem `rclone lsjson -R --hash gdrive:R36S` (a pasta R36S do Drive = raiz do
cartão de ROMs, ou seja, /roms) dá o ID de cada arquivo; cada entrada de /roms ganha "id" (e "v", versão para o cache:
md5 ou data). Fora de /roms tudo vira eager (não está no Drive: vai no eager.bin). "extra" lista arquivos do Drive nas
pastas de sistema que o ES não lista mas o player pode pedir (faixas .bin de .cue, saves .srm/.dsv do cartão...).
Grava também info.json (sistemas, jogos) para a tela da biblioteca. Os quatro (manifest.json, eager.bin, info.json, library.json.gz) vão para R36S/.web/ no Drive.
"""
import argparse, datetime, gzip, json, os, re, sys, urllib.parse
import xml.etree.ElementTree as ET

ROM_EXT = {".7z", ".zip", ".sfc", ".smc", ".nes", ".gb", ".gbc", ".gba", ".md", ".gen", ".bin",
           ".cue", ".chd", ".iso", ".pbp", ".n64", ".z64", ".v64", ".nds", ".pce", ".sms", ".gg",
           ".a26", ".a78", ".lnx", ".32x", ".cdi", ".gdi", ".p8", ".png8"}
SYMLINKS = {"/etc/emulationstation/themes": "/roms/themes"}
# do tema só vai no pacote inicial o que o ES lê ao carregar (xml, fontes, svg); imagens e áudio (~200 MB) são sob demanda
THEME_EAGER_EXT = {".xml", ".ttf", ".otf", ".svg"}
# resources/ do ES: tudo eager (pugixml/ifstream leem direto), menos as fontes de fallback CJK grandes (lidas via ResourceManager)
ES_LAZY_FONT_MIN = 1024 * 1024
# Modo Drive: cada arquivo lazy é um pedido ao Drive (centenas de ms, em série no ES). As imagens do tema ativo que o ES
# lê ao abrir e ao trocar de tela vão no pacote (eager.bin); das pastas por sistema, só as dos sistemas do cartão.
DRIVE_THEME_EAGER_EXT = {".png", ".jpg", ".jpeg", ".svg", ".ttf", ".otf"}
DRIVE_THEME_PER_SYSTEM = {"posters", "controllers", "sounds"}
MEDIA_TAGS = {"image", "thumbnail", "marquee", "video", "fanart", "boxart", "wheel", "titleshot", "map", "manual", "cartridge", "mix"}

def read_systems(src):
    """{'/roms/snes': {'.7z', ...}} do es_systems.cfg da árvore, ou None."""
    for rel in ("home/ark/.emulationstation/es_systems.cfg", "etc/emulationstation/es_systems.cfg"):
        p = os.path.join(src, rel)
        if os.path.isfile(p):
            txt = open(p, encoding="utf-8", errors="replace").read()
            out = {}
            for block in re.findall(r"<system>.*?</system>", txt, re.S):
                path = re.search(r"<path>(.*?)</path>", block, re.S)
                ext = re.search(r"<extension>(.*?)</extension>", block, re.S)
                if not path:
                    continue
                vp = "/" + path.group(1).strip().strip("/")
                out.setdefault(vp, set()).update((ext.group(1).split() if ext else []))
            return out
    return None

def active_theme(src):
    p = os.path.join(src, "home/ark/.emulationstation/es_settings.cfg")
    if os.path.isfile(p):
        m = re.search(r'name="ThemeSet"\s+value="([^"]*)"', open(p, encoding="utf-8", errors="replace").read())
        if m:
            return m.group(1)
    return None

def gamelist_refs(real, vdir):
    """Caminhos virtuais da mídia citada num gamelist.xml."""
    refs = set()
    try:
        root = ET.parse(real).getroot()
        texts = [(el.tag, (el.text or "").strip()) for el in root.iter()]
    except ET.ParseError:
        txt = open(real, encoding="utf-8", errors="replace").read()
        texts = re.findall(r"<(\w+)>([^<]*)</\1>", txt)
    for tag, t in texts:
        if tag not in MEDIA_TAGS or not t:
            continue
        t = t.replace("&amp;", "&")
        if t.startswith("./"):
            refs.add(os.path.normpath(vdir + "/" + t[2:]))
        elif t.startswith("/"):
            refs.add(os.path.normpath(t))
    return refs

def legacy_classify(vpath, size):
    name = os.path.basename(vpath)
    if size == 0:
        return "empty"
    if vpath.startswith("/roms/themes/"):
        return "eager" if os.path.splitext(name)[1].lower() in THEME_EAGER_EXT else "lazy"
    if vpath.startswith("/usr/"):
        big_font = os.path.splitext(name)[1].lower() in (".ttf", ".otf") and size >= ES_LAZY_FONT_MIN
        return "lazy" if big_font else "eager"
    if vpath.startswith("/home/") or vpath.startswith("/etc/") or name == "gamelist.xml":
        return "eager"
    if os.path.splitext(name)[1].lower() in ROM_EXT:
        return "empty"
    return "lazy"

class CardRules:
    def __init__(self, systems, theme, refs):
        self.systems = sorted(systems.items(), key=lambda kv: -len(kv[0]))   # prefixo mais longo primeiro
        self.theme = theme
        self.refs = refs

    def system_of(self, vpath):
        for prefix, exts in self.systems:
            if vpath.startswith(prefix + "/"):
                return prefix, exts
        return None, None

    def classify(self, vpath, size):
        """'eager' | 'lazy' | 'empty' | None (fica de fora)."""
        name = os.path.basename(vpath)
        if not vpath.startswith("/roms/"):
            if vpath.startswith("/usr/"):
                big_font = os.path.splitext(name)[1].lower() in (".ttf", ".otf") and size >= ES_LAZY_FONT_MIN
                return "lazy" if big_font else ("eager" if size else "empty")
            return "eager" if size else "empty"
        if vpath.startswith("/roms/themes/"):
            if self.theme and vpath.startswith(f"/roms/themes/{self.theme}/") and os.path.splitext(name)[1].lower() in THEME_EAGER_EXT:
                return "eager" if size else "empty"
            return "lazy" if size else "empty"
        if vpath.startswith("/roms/bios/"):
            return "lazy" if size else "empty"
        prefix, exts = self.system_of(vpath)
        if prefix is None:
            return None
        if name == "gamelist.xml":
            return "eager"
        if any(name.endswith(e) for e in exts):
            return "empty"
        if vpath in self.refs or vpath[len(prefix):].startswith("/images/"):
            return "lazy" if size else "empty"
        return None

def walk(src):
    """(vdir, [(vpath, real, size)]) de toda a árvore, seguindo symlinks e pulando ocultos."""
    seen = set()
    for root, dnames, fnames in os.walk(src, followlinks=True):
        st = os.stat(root)
        if (st.st_dev, st.st_ino) in seen:
            dnames[:] = []; continue
        seen.add((st.st_dev, st.st_ino))
        vroot = "/" + os.path.relpath(root, src).replace(os.sep, "/").lstrip(".").lstrip("/")
        hide = vroot == "/roms" or vroot.startswith("/roms/")   # ocultos só no cartão (~/.emulationstation entra)
        dnames[:] = sorted(d for d in dnames if not (hide and d.startswith(".")))
        files = []
        for fn in sorted(fnames):
            if hide and fn.startswith("."):
                continue
            real = os.path.join(root, fn)
            try:
                size = os.path.getsize(real)
            except OSError:
                continue   # symlink quebrado
            files.append((vroot.rstrip("/") + "/" + fn, real, size))
        yield vroot, files

MEDIA_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".mkv", ".avi", ".pdf", ".txt", ".xml", ".nfo"}

def read_lsjson(path):
    """{'snes/Jogo.7z': {'id', 'size', 'v'}} de `rclone lsjson -R --hash` (só arquivos)."""
    out = {}
    for e in json.load(open(path, encoding="utf-8")):
        if e.get("IsDir") or not e.get("ID"):
            continue
        h = (e.get("Hashes") or {})
        v = (h.get("md5") or h.get("MD5") or "")[:10] or re.sub(r"\D", "", e.get("ModTime", ""))[:14]
        out[e["Path"].lstrip("/")] = {"id": e["ID"], "size": e.get("Size", 0), "v": v}
    return out

def read_systems_full(src):
    """[{'name', 'fullname', 'dir', 'exts'}] na ordem do es_systems.cfg (uma pasta só uma vez)."""
    for rel in ("home/ark/.emulationstation/es_systems.cfg", "etc/emulationstation/es_systems.cfg"):
        p = os.path.join(src, rel)
        if not os.path.isfile(p):
            continue
        with open(p, encoding="utf-8", errors="replace") as f:
            txt = f.read()
        out, seen = [], set()
        for block in re.findall(r"<system>.*?</system>", txt, re.S):
            tag = lambda t: (re.search(f"<{t}>(.*?)</{t}>", block, re.S) or [None, ""])[1].strip()
            d = "/" + tag("path").strip("/")
            if not d.startswith("/roms/") or d in seen:   # kodi, /opt/cmds etc. não são jogos do cartão
                continue
            seen.add(d)
            out.append({"name": tag("name"), "fullname": tag("fullname") or tag("name"), "dir": d, "exts": tag("extension").split()})
        return out
    return []

def read_gamelist(real, vdir):
    """{vpath da ROM: metadados} de um gamelist.xml; caminhos de mídia como vpath."""
    try:
        root = ET.parse(real).getroot()
    except (ET.ParseError, OSError) as e:
        print(f"aviso: gamelist ilegível ({real}): {e}", file=sys.stderr)
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
    try:
        with open(real, encoding="utf-8", errors="replace") as f:
            txt = f.read()
    except OSError:
        return set()
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
    """library.json.gz: sistemas com jogos (ordem do cores.json, senão do es_systems.cfg) e os jogos com os metadados."""
    systems = read_systems_full(src)
    cores = {}
    if cores_path and os.path.isfile(cores_path):
        with open(cores_path, encoding="utf-8") as f:
            cores = json.load(f)["systems"]
    elif cores_path:
        print(f"aviso: cores.json não encontrado ({cores_path}); sistemas sem núcleo/ordem", file=sys.stderr)
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
        folder = s["dir"].split("/")[2]   # id = pasta logo abaixo de /roms (pico-8/carts -> pico-8)
        prefix = s["dir"] + "/"
        mine = sorted(vp for vp in files if vp.startswith(prefix) and not any(x in vp[len(s["dir"]):] for x in SKIP_DIRS)
                      and any(vp.endswith(e) for e in s["exts"]))
        mine_set = set(mine)
        meta, hidden = {}, set()
        for vroot, entries in tree:
            if vroot == s["dir"] or vroot.startswith(prefix):
                for vp, real, _ in entries:
                    if vp.endswith("/gamelist.xml"):
                        meta.update(read_gamelist(real, vroot))
                    elif vp.lower().endswith(SHEET_EXT) and vp in mine_set:
                        hidden |= cited_by_sheet(real, vroot)
        games = []
        for vp in mine:
            if vp in hidden:
                continue
            m = meta.get(vp, {})
            stem = os.path.basename(vp)
            while (b := os.path.splitext(stem))[1] and b[1] in s["exts"]:   # celeste.p8.png -> celeste
                stem = b[0]
            g = {"s": folder, "rom": vp, "name": m.get("name") or stem, "size": files[vp][1]}
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
    # gzip aqui: o hub e o Drive podem mandar sem compressão (o navegador abre com DecompressionStream)
    raw = json.dumps(lib, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    with open(os.path.join(out, "library.json.gz"), "wb") as f:
        with gzip.GzipFile(filename="", mode="wb", fileobj=f, mtime=0, compresslevel=9) as z:
            z.write(raw)
    return len(out_games)

def build(src, out, drive_ids=None, cores=None):
    os.makedirs(out, exist_ok=True)
    systems = read_systems(src)
    tree = list(walk(src))
    if systems is None:
        classify = legacy_classify
    else:
        refs = set()
        for vroot, files in tree:
            for vpath, real, size in files:
                if vpath.endswith("/gamelist.xml") and vpath.startswith("/roms/"):
                    refs |= gamelist_refs(real, vroot)
        classify = CardRules(systems, active_theme(src), refs).classify
    theme = active_theme(src) if systems is not None else None
    # sistemas com pelo menos um jogo (o es_systems.cfg do dArkOS lista ~100, a maioria vazia)
    present = set()
    for prefix, exts in (systems or {}).items():
        if any(vp.startswith(prefix + "/") and any(vp.endswith(e) for e in exts) for vroot, entries in tree
               if vroot.startswith(prefix) for vp, _, _ in entries):
            present.add(os.path.basename(prefix).lower())

    def drive_theme_eager(vpath):
        if not theme or not vpath.startswith(f"/roms/themes/{theme}/"):
            return False
        stem, ext = os.path.splitext(os.path.basename(vpath))
        if ext.lower() not in DRIVE_THEME_EAGER_EXT:
            return False
        parent = os.path.basename(os.path.dirname(vpath))
        return parent not in DRIVE_THEME_PER_SYSTEM or stem.lower() in present
    dirs, files, off, missing = set(), {}, 0, []
    with open(os.path.join(out, "eager.bin"), "wb") as blob:
        for vroot, entries in tree:
            if vroot != "/" and (systems is None or not vroot.startswith("/roms")):
                dirs.add(vroot)   # fora de /roms: até diretório vazio conta (collections/)
            for vpath, real, size in entries:
                kind = classify(vpath, size)
                if kind is None:
                    continue
                if drive_ids is not None and kind == "lazy" and (not vpath.startswith("/roms/") or drive_theme_eager(vpath)):
                    kind = "eager"   # fora do Drive, ou imagem do tema que o ES lê na hora: vai no pacote
                entry = {"size": size, "kind": kind}
                if kind == "eager":
                    entry["off"] = off
                    with open(real, "rb") as f:
                        data = f.read()
                    blob.write(data)
                    off += len(data)
                    entry["size"] = len(data)
                elif kind == "lazy":
                    entry["url"] = "fs" + urllib.parse.quote(vpath)
                if drive_ids is not None and vpath.startswith("/roms/") and kind != "eager":
                    d = drive_ids.get(vpath[len("/roms/"):])
                    if d:
                        entry["id"] = d["id"]
                        if d["v"]:
                            entry["v"] = d["v"]
                    else:
                        missing.append(vpath)
                files[vpath] = entry
                d = os.path.dirname(vpath)
                while d not in ("/", "") and d not in dirs:
                    dirs.add(d); d = os.path.dirname(d)
    manifest = {"dirs": sorted(dirs), "files": files, "symlinks": SYMLINKS}
    if drive_ids is not None:
        manifest["extra"] = drive_extra(drive_ids, files, systems)
        write_info(out, files, systems)
        if missing:
            print(f"aviso: {len(missing)} arquivos de /roms sem ID no Drive (não subiram?), ex.: {missing[:3]}", file=sys.stderr)
    write_library(out, src, tree, drive_ids, cores)
    with open(os.path.join(out, "manifest.json"), "w") as f:
        json.dump(manifest, f, ensure_ascii=False, separators=(",", ":"))
    return len(files), off

def drive_extra(drive_ids, files, systems):
    """Arquivos do Drive nas pastas de sistema (e bios) fora do manifesto, que o player pode precisar."""
    prefixes = tuple(p + "/" for p in (systems or {})) + ("/roms/bios/",)
    extra = {}
    for rel, d in drive_ids.items():
        vpath = "/roms/" + rel
        if vpath in files or not vpath.startswith(prefixes) or any(part.startswith(".") for part in rel.split("/")):
            continue
        if os.path.splitext(rel)[1].lower() in MEDIA_EXT or "/images/" in vpath or "/videos/" in vpath:
            continue
        extra[vpath] = {"size": d["size"], "id": d["id"]}
    return extra

def write_info(out, files, systems):
    """info.json: contagem de sistemas e jogos (tela da biblioteca no site)."""
    per = {}
    for vpath, e in files.items():
        if e["kind"] == "empty" and vpath.startswith("/roms/") and not vpath.startswith(("/roms/bios/", "/roms/themes/")):
            sysdir = "/".join(vpath.split("/")[:3])
            if systems is None or sysdir in systems:
                per[sysdir] = per.get(sysdir, 0) + 1
    info = {"systems": len(per), "games": sum(per.values()), "perSystem": {k[6:]: v for k, v in sorted(per.items())},
            "built": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
    with open(os.path.join(out, "info.json"), "w") as f:
        json.dump(info, f, ensure_ascii=False, indent=1)

if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="manifest.json + eager.bin do FS do ES")
    ap.add_argument("src"); ap.add_argument("out")
    ap.add_argument("--drive-ids", metavar="LSJSON", help="saída de `rclone lsjson -R --hash gdrive:R36S` (modo Drive)")
    ap.add_argument("--cores", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web", "data", "cores.json"),
                    help="mapa sistema -> núcleo (data/mkcores.py): playable/nota/ordem no library.json")
    a = ap.parse_args()
    n, size = build(a.src, a.out, read_lsjson(a.drive_ids) if a.drive_ids else None, a.cores)
    msize = os.path.getsize(os.path.join(a.out, "manifest.json"))
    print(f"{n} arquivos, eager.bin {size/1e6:.1f} MB, manifest.json {msize/1e6:.1f} MB")
