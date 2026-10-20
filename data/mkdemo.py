#!/usr/bin/env python3
"""Monta o modo demonstração do site: web/site/demo/fs/ (versionado: homebrews livres e configs)
-> web/site/demo/data/{manifest.json,eager.bin,library.json.gz} + miniaturas das capas em web/site/demo/data/capas/.

  python3 data/mkdemo.py

Licenças dos jogos: web/site/demo/LICENSES.md.
"""
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import mkmanifest

ROOT = os.path.dirname(HERE)
DEMO = os.path.join(ROOT, "web", "site", "demo")

def main():
    data = os.path.join(DEMO, "data")
    n, size = mkmanifest.build(os.path.join(DEMO, "fs"), data, cores=os.path.join(ROOT, "web", "data", "cores.json"),
                               thumbs=os.path.join(data, "capas"))
    print(f"demo: {n} arquivos, eager.bin {size / 1e6:.1f} MB")

if __name__ == "__main__":
    main()
