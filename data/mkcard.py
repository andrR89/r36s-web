#!/usr/bin/env python3
"""Monta card/ (fonte do FS virtual da Etapa 3) a partir do cartão real montado SÓ LEITURA, sem copiar ROMs:

  card/roms -> /run/media/andre/EASYROMS            (symlink: ROMs, tema, gamelists, BIOS servidos direto do cartão)
  card/etc/emulationstation/es_systems.cfg          (cópia do ROOTFS: 126 sistemas, comandos reais)
  card/etc/emulationstation/es_input.cfg            (nosso: teclado WASD+JKUI, ver mksample.py)
  card/home/ark/.emulationstation/es_settings.cfg   (cópia: ThemeSet = es-theme-farfenkugell_EPICMAX ...)
  card/home/ark/.emulationstation/collections/      (cópia)
  card/home/ark/.config/retroarch/                  (cópia: retroarch.cfg, retroarch-core-options.cfg, config/)
  card/usr/bin/emulationstation/                    (nosso resources/ + o que só o do cartão tem: battery/, fontawesome)

Uso: python3 -I data/mkcard.py ; depois python3 -I data/mkmanifest.py card web/data
"""
import os, shutil, sys

R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(R, "data"))
import mksample

ROOTFS = "/run/media/andre/ROOTFS"
EASYROMS = "/run/media/andre/EASYROMS"
OUT = os.path.join(R, "card")
COPY = [  # (origem no ROOTFS, destino em card/)
    ("etc/emulationstation/es_systems.cfg", "etc/emulationstation/es_systems.cfg"),
    ("home/ark/.emulationstation/es_settings.cfg", "home/ark/.emulationstation/es_settings.cfg"),
    ("home/ark/.emulationstation/collections", "home/ark/.emulationstation/collections"),
    ("home/ark/.config/retroarch/retroarch.cfg", "home/ark/.config/retroarch/retroarch.cfg"),
    ("home/ark/.config/retroarch/retroarch-core-options.cfg", "home/ark/.config/retroarch/retroarch-core-options.cfg"),
    ("home/ark/.config/retroarch/config", "home/ark/.config/retroarch/config"),
]

def main():
    for d in (ROOTFS, EASYROMS):
        if not os.path.isdir(d) or not os.listdir(d):
            sys.exit(f"cartão não montado: {d}")
    if os.path.lexists(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT)
    os.symlink(EASYROMS, os.path.join(OUT, "roms"))
    for src, dst in COPY:
        s, d = os.path.join(ROOTFS, src), os.path.join(OUT, dst)
        os.makedirs(os.path.dirname(d), exist_ok=True)
        if os.path.isdir(s):
            shutil.copytree(s, d, symlinks=True)
        else:
            shutil.copyfile(s, d)
    mksample.add_es_files(OUT)
    # resources/ do ES do cartão tem coisas que o do fonte não tem (ícones de bateria do ShowBattery, fontawesome)
    ours = os.path.join(OUT, mksample.ES_BIN, "resources")
    real = os.path.join(ROOTFS, "usr/bin/emulationstation/resources")
    extra = 0
    for root, _, files in os.walk(real):
        for fn in files:
            rel = os.path.relpath(os.path.join(root, fn), real)
            dst = os.path.join(ours, rel)
            if not os.path.exists(dst):
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                shutil.copyfile(os.path.join(root, fn), dst)
                extra += 1
    print(f"card/: roms -> {EASYROMS}, cfgs do ROOTFS, resources do ES (+{extra} do cartão)")

if __name__ == "__main__":
    main()
