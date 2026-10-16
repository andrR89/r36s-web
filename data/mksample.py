#!/usr/bin/env python3
"""Monta card-sample/ com o mínimo para a prova do ES: tema EPIC-CODY, cfgs e SNES (20 jogos com capa)."""
import os, shutil, sys

X = "/run/media/andre/external/handhelds"
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(R, "card-sample")
N_GAMES = 20

# es_systems.cfg: o bloco <system> do snes do cartão real (comando completo do dArkOS, extensões reais);
# o ES web reconhece o comando e lança pela ponte (es-core/src/platform.cpp, runSystemCommand sob _WEB_)
REAL_ES_SYSTEMS = "/run/media/andre/ROOTFS/etc/emulationstation/es_systems.cfg"
EASYROMS = "/run/media/andre/EASYROMS"
# jogos reais (copiados do cartão; o resto da amostra são arquivos vazios só para a lista)
REAL_ROMS = ["Donkey Kong Country (USA) (PT-BR).7z",
             "Donkey Kong Country 2 - Diddy's Kong Quest (USA) (PT-BR).7z",
             "Donkey Kong Country 3 - Dixie Kong's Double Trouble! (USA) (PT-BR).7z"]
# save real (copiado, nunca alterado na origem) -> saves/snes/ do projeto (servido pelo hub em /r36s/saves/)
REAL_SAVES = ["Donkey Kong Country 3 - Dixie Kong's Double Trouble! (USA) (PT-BR).srm"]

def real_snes_system():
    import re
    txt = open(REAL_ES_SYSTEMS, encoding="utf-8").read()
    for block in re.findall(r"[ \t]*<system>.*?</system>", txt, re.S):
        if "<path>/roms/snes/</path>" in block:
            return '<?xml version="1.0"?>\n<systemList>\n' + block + "\n</systemList>\n"
    sys.exit("snes (/roms/snes/) não encontrado em " + REAL_ES_SYSTEMS)

ES_SETTINGS = """<?xml version="1.0"?>
<config>
  <string name="ThemeSet" value="theme-EPIC-CODY" />
  <bool name="EnableSounds" value="true" />
  <bool name="SplashScreen" value="false" />
  <string name="TransitionStyle" value="slide" />
</config>
"""

# teclado WASD+JKUI (escolha do andre): WASD direcional, K=A J=B I=X U=Y, Q/E página, Enter=Start, Backspace=Select (sem este arquivo o ES abre o
# GuiDetectDevice "segure um botão para configurar" em vez do carrossel)
ES_INPUT = """<?xml version="1.0"?>
<inputList>
  <inputConfig type="keyboard" deviceName="Keyboard" deviceGUID="-1">
    <input name="up" type="key" id="119" value="1" />
    <input name="down" type="key" id="115" value="1" />
    <input name="left" type="key" id="97" value="1" />
    <input name="right" type="key" id="100" value="1" />
    <input name="a" type="key" id="107" value="1" />
    <input name="b" type="key" id="106" value="1" />
    <input name="x" type="key" id="105" value="1" />
    <input name="y" type="key" id="117" value="1" />
    <input name="start" type="key" id="13" value="1" />
    <input name="select" type="key" id="8" value="1" />
    <input name="pageup" type="key" id="113" value="1" />
    <input name="pagedown" type="key" id="101" value="1" />
  </inputConfig>
</inputList>
"""

ES_RESOURCES = os.path.join(R, "src/es/resources")
ES_BIN = "usr/bin/emulationstation"   # como no dArkOS: /usr/bin/emulationstation/{emulationstation,resources}

def add_es_files(out):
    """Arquivos do próprio ES (não dependem do external): es_input.cfg e resources/."""
    # o fcamod do ArkOS lê o es_input.cfg de /etc/emulationstation (InputManager::getConfigPath)
    etc = os.path.join(out, "etc/emulationstation")
    os.makedirs(etc, exist_ok=True)
    open(os.path.join(etc, "es_input.cfg"), "w").write(ES_INPUT)
    stale = os.path.join(out, "home/ark/.emulationstation/es_input.cfg")
    if os.path.exists(stale):
        os.remove(stale)
    dst = os.path.join(out, ES_BIN, "resources")
    if os.path.exists(dst):
        shutil.rmtree(dst)
    shutil.copytree(ES_RESOURCES, dst)
    # executável fictício: setExePath só usa o diretório de argv[0] se ele for um arquivo regular
    open(os.path.join(out, ES_BIN, "emulationstation"), "wb").close()

def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

def main():
    if os.path.exists(OUT):
        shutil.rmtree(OUT)
    home = os.path.join(OUT, "home/ark/.emulationstation")
    os.makedirs(home)
    open(os.path.join(home, "es_systems.cfg"), "w").write(real_snes_system())
    open(os.path.join(home, "es_settings.cfg"), "w").write(ES_SETTINGS)

    theme_src = os.path.join(X, "essenciais-r36s/themes/theme-EPIC-CODY")
    if not os.path.isfile(os.path.join(theme_src, "theme.xml")):
        sys.exit(f"tema incompleto: falta {theme_src}/theme.xml")
    shutil.copytree(theme_src, os.path.join(OUT, "roms/themes/theme-EPIC-CODY"))

    snes_src = os.path.join(X, "packs-de-rom/pack-curado/snes")
    snes = os.path.join(OUT, "roms/snes")
    os.makedirs(os.path.join(snes, "images"))
    roms = sorted(f for f in os.listdir(snes_src) if f.lower().endswith((".7z", ".zip", ".sfc", ".smc")))[:N_GAMES]
    roms = sorted(set(roms) | set(REAL_ROMS), key=str.lower)
    # capas: snap/ so tem .mp4 neste pack; as imagens estao em media/images/
    snap = os.path.join(snes_src, "media/images")
    entries = []
    for rom in roms:
        if rom in REAL_ROMS:   # cópia real do cartão (a ponte baixa por fs/roms/...)
            shutil.copyfile(os.path.join(EASYROMS, "snes", rom), os.path.join(snes, rom))
        else:                  # ROM vira arquivo vazio: o ES só lista, não lê
            open(os.path.join(snes, rom), "wb").close()
        stem = os.path.splitext(rom)[0]
        img = next((f for f in (os.listdir(snap) if os.path.isdir(snap) else []) if os.path.splitext(f)[0] == stem), None)
        line = f"\t<game>\n\t\t<path>./{esc(rom)}</path>\n\t\t<name>{esc(stem)}</name>\n"
        if img:
            shutil.copy(os.path.join(snap, img), os.path.join(snes, "images", img))
            line += f"\t\t<image>./images/{esc(img)}</image>\n"
        entries.append(line + "\t</game>\n")
    open(os.path.join(snes, "gamelist.xml"), "w").write('<?xml version="1.0"?>\n<gameList>\n' + "".join(entries) + "</gameList>\n")
    add_es_files(OUT)
    saves = os.path.join(R, "saves/snes")
    os.makedirs(saves, exist_ok=True)
    for srm in REAL_SAVES:
        dst = os.path.join(saves, srm)
        if not os.path.exists(dst):   # não pisa no progresso feito no navegador
            shutil.copyfile(os.path.join(EASYROMS, "snes", srm), dst)
    print(f"card-sample: {len(roms)} jogos snes, {sum(1 for e in entries if '<image>' in e)} com capa")

if __name__ == "__main__":
    if "--es-only" in sys.argv:   # só atualiza os arquivos do ES numa amostra existente
        add_es_files(OUT)
        print("card-sample: es_input.cfg e resources/ atualizados")
    else:
        main()
