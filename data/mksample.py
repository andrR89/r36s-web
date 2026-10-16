#!/usr/bin/env python3
"""Monta card-sample/ com o mínimo para a prova do ES: tema EPIC-CODY, cfgs e SNES (20 jogos com capa)."""
import os, shutil, sys

X = "/run/media/andre/external/handhelds"
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(R, "card-sample")
N_GAMES = 20

ES_SYSTEMS = """<?xml version="1.0"?>
<systemList>
  <system>
    <name>snes</name>
    <fullname>Super Nintendo</fullname>
    <path>/roms/snes/</path>
    <extension>.7z .7Z .zip .ZIP .sfc .SFC .smc .SMC</extension>
    <command>web-launch snes snes9x %ROM%</command>
    <platform>snes</platform>
    <theme>snes</theme>
  </system>
</systemList>
"""

ES_SETTINGS = """<?xml version="1.0"?>
<config>
  <string name="ThemeSet" value="theme-EPIC-CODY" />
  <bool name="EnableSounds" value="true" />
  <bool name="SplashScreen" value="false" />
  <string name="TransitionStyle" value="slide" />
</config>
"""

def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

def main():
    if os.path.exists(OUT):
        shutil.rmtree(OUT)
    home = os.path.join(OUT, "home/ark/.emulationstation")
    os.makedirs(home)
    open(os.path.join(home, "es_systems.cfg"), "w").write(ES_SYSTEMS)
    open(os.path.join(home, "es_settings.cfg"), "w").write(ES_SETTINGS)

    theme_src = os.path.join(X, "essenciais-r36s/themes/theme-EPIC-CODY")
    if not os.path.isfile(os.path.join(theme_src, "theme.xml")):
        sys.exit(f"tema incompleto: falta {theme_src}/theme.xml")
    shutil.copytree(theme_src, os.path.join(OUT, "roms/themes/theme-EPIC-CODY"))

    snes_src = os.path.join(X, "packs-de-rom/pack-curado/snes")
    snes = os.path.join(OUT, "roms/snes")
    os.makedirs(os.path.join(snes, "images"))
    roms = sorted(f for f in os.listdir(snes_src) if f.lower().endswith((".7z", ".zip", ".sfc", ".smc")))[:N_GAMES]
    # capas: snap/ so tem .mp4 neste pack; as imagens estao em media/images/
    snap = os.path.join(snes_src, "media/images")
    entries = []
    for rom in roms:
        # ROM vira arquivo vazio: o ES só lista, não lê
        open(os.path.join(snes, rom), "wb").close()
        stem = os.path.splitext(rom)[0]
        img = next((f for f in (os.listdir(snap) if os.path.isdir(snap) else []) if os.path.splitext(f)[0] == stem), None)
        line = f"\t<game>\n\t\t<path>./{esc(rom)}</path>\n\t\t<name>{esc(stem)}</name>\n"
        if img:
            shutil.copy(os.path.join(snap, img), os.path.join(snes, "images", img))
            line += f"\t\t<image>./images/{esc(img)}</image>\n"
        entries.append(line + "\t</game>\n")
    open(os.path.join(snes, "gamelist.xml"), "w").write('<?xml version="1.0"?>\n<gameList>\n' + "".join(entries) + "</gameList>\n")
    print(f"card-sample: {len(roms)} jogos snes, {sum(1 for e in entries if '<image>' in e)} com capa")

if __name__ == "__main__":
    main()
