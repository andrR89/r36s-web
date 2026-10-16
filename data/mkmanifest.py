#!/usr/bin/env python3
"""Gera manifest.json + eager.bin a partir de uma árvore de cartão (card-sample/ ou card/)."""
import json, os, sys, urllib.parse

ROM_EXT = {".7z", ".zip", ".sfc", ".smc", ".nes", ".gb", ".gbc", ".gba", ".md", ".gen", ".bin",
           ".cue", ".chd", ".iso", ".pbp", ".n64", ".z64", ".v64", ".nds", ".pce", ".sms", ".gg",
           ".a26", ".a78", ".lnx", ".32x", ".cdi", ".gdi", ".p8", ".png8"}
SYMLINKS = {"/etc/emulationstation/themes": "/roms/themes"}
# do tema só vai no pacote inicial o que o ES lê ao carregar (xml, fontes, svg); imagens e áudio (~200 MB) são sob demanda
THEME_EAGER_EXT = {".xml", ".ttf", ".otf", ".svg"}

def classify(vpath, size):
    name = os.path.basename(vpath)
    if size == 0:
        return "empty"
    if vpath.startswith("/roms/themes/"):
        return "eager" if os.path.splitext(name)[1].lower() in THEME_EAGER_EXT else "lazy"
    if vpath.startswith("/home/") or name == "gamelist.xml":
        return "eager"
    if os.path.splitext(name)[1].lower() in ROM_EXT:
        return "empty"
    return "lazy"

def build(src, out):
    os.makedirs(out, exist_ok=True)
    dirs, files, off = [], {}, 0
    with open(os.path.join(out, "eager.bin"), "wb") as blob:
        for root, dnames, fnames in os.walk(src):
            dnames.sort(); fnames.sort()
            vroot = "/" + os.path.relpath(root, src).replace(os.sep, "/").lstrip(".").lstrip("/")
            if vroot != "/":
                dirs.append(vroot)
            for fn in fnames:
                real = os.path.join(root, fn)
                vpath = (vroot.rstrip("/") + "/" + fn)
                size = os.path.getsize(real)
                kind = classify(vpath, size)
                entry = {"size": size, "kind": kind}
                if kind == "eager":
                    entry["off"] = off
                    with open(real, "rb") as f:
                        blob.write(f.read())
                    off += size
                elif kind == "lazy":
                    entry["url"] = "fs" + urllib.parse.quote(vpath)
                files[vpath] = entry
    with open(os.path.join(out, "manifest.json"), "w") as f:
        json.dump({"dirs": dirs, "files": files, "symlinks": SYMLINKS}, f, ensure_ascii=False)
    return len(files), off

if __name__ == "__main__":
    n, size = build(sys.argv[1], sys.argv[2])
    print(f"{n} arquivos, eager.bin {size/1e6:.1f} MB")
