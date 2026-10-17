#!/usr/bin/env python3
"""Monta o modo demonstração do site: web/site/demo/fs/ (versionado: homebrews livres, tema próprio, configs) +
usr/ (recursos do ES, copiados da árvore do cartão — não versionado) -> web/site/demo/data/{manifest.json,eager.bin}.

  python3 data/mkdemo.py [--resources card/usr]

Licenças dos jogos: web/site/demo/LICENSES.md.
"""
import argparse, os, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import mkmanifest

ROOT = os.path.dirname(HERE)
DEMO = os.path.join(ROOT, "web", "site", "demo")

def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--resources", default=os.path.join(ROOT, "web", "fs", "usr"),
                    help="pasta usr/ com bin/emulationstation/resources (padrão: web/fs/usr, do cartão)")
    a = ap.parse_args()
    src = os.path.join(a.resources, "bin", "emulationstation")
    if not os.path.isdir(os.path.join(src, "resources")):
        sys.exit(f"recursos do ES não encontrados em {src}/resources")
    dst = os.path.join(DEMO, "fs", "usr", "bin", "emulationstation")
    shutil.rmtree(os.path.join(DEMO, "fs", "usr"), ignore_errors=True)
    shutil.copytree(src, dst)
    n, size = mkmanifest.build(os.path.join(DEMO, "fs"), os.path.join(DEMO, "data"))
    print(f"demo: {n} arquivos, eager.bin {size / 1e6:.1f} MB")

if __name__ == "__main__":
    main()
