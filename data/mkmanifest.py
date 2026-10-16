#!/usr/bin/env python3
"""Gera manifest.json + eager.bin a partir de uma árvore de cartão (card/ ou card-sample/).

Modo cartão (há um es_systems.cfg em /etc/emulationstation ou ~/.emulationstation): só entra o que o ES usa —
ROMs (extensões do sistema, como arquivos vazios), gamelist.xml (eager), mídia citada nos gamelists ou em images/
(LocalArt, sob demanda), BIOS (sob demanda, para o player), o tema ativo (xml/fontes/svg eager, o resto sob demanda).
O resto do cartão (dados de ports, lixeira, música, ocultos) fica de fora. Sem es_systems.cfg: regra antiga por extensão.
Os symlinks da árvore são seguidos (card/roms -> cartão montado).
"""
import json, os, re, sys, urllib.parse
import xml.etree.ElementTree as ET

ROM_EXT = {".7z", ".zip", ".sfc", ".smc", ".nes", ".gb", ".gbc", ".gba", ".md", ".gen", ".bin",
           ".cue", ".chd", ".iso", ".pbp", ".n64", ".z64", ".v64", ".nds", ".pce", ".sms", ".gg",
           ".a26", ".a78", ".lnx", ".32x", ".cdi", ".gdi", ".p8", ".png8"}
SYMLINKS = {"/etc/emulationstation/themes": "/roms/themes"}
# do tema só vai no pacote inicial o que o ES lê ao carregar (xml, fontes, svg); imagens e áudio (~200 MB) são sob demanda
THEME_EAGER_EXT = {".xml", ".ttf", ".otf", ".svg"}
# resources/ do ES: tudo eager (pugixml/ifstream leem direto), menos as fontes de fallback CJK grandes (lidas via ResourceManager)
ES_LAZY_FONT_MIN = 1024 * 1024
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

def build(src, out):
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
    dirs, files, off = set(), {}, 0
    with open(os.path.join(out, "eager.bin"), "wb") as blob:
        for vroot, entries in tree:
            if vroot != "/" and (systems is None or not vroot.startswith("/roms")):
                dirs.add(vroot)   # fora de /roms: até diretório vazio conta (collections/)
            for vpath, real, size in entries:
                kind = classify(vpath, size)
                if kind is None:
                    continue
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
                files[vpath] = entry
                d = os.path.dirname(vpath)
                while d not in ("/", "") and d not in dirs:
                    dirs.add(d); d = os.path.dirname(d)
    with open(os.path.join(out, "manifest.json"), "w") as f:
        json.dump({"dirs": sorted(dirs), "files": files, "symlinks": SYMLINKS}, f, ensure_ascii=False, separators=(",", ":"))
    return len(files), off

if __name__ == "__main__":
    n, size = build(sys.argv[1], sys.argv[2])
    msize = os.path.getsize(os.path.join(sys.argv[2], "manifest.json"))
    print(f"{n} arquivos, eager.bin {size/1e6:.1f} MB, manifest.json {msize/1e6:.1f} MB")
