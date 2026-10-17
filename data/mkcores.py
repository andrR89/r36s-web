#!/usr/bin/env python3
"""Mapa sistema -> núcleo web: lê o es_systems.cfg real e o manifesto (jogos que o ES vê), cruza com os núcleos do
RetroArch emscripten (data/web-cores.txt, lista do pacote do buildbot) e gera web/data/cores.json + docs/cores-report.md.

Escolha por sistema (pasta /roms/<pasta>/, que é o que a ponte recebe):
  1. núcleos do comando/emuladores na ordem do es_systems.cfg (emulador padrão = o primeiro, como o ES faz);
     nome do dArkOS com sufixo de variante (_rumble, _EX, 32...) cai no núcleo base se ele existir na web;
  2. sem nenhum: núcleo web conhecido para o sistema (WEB_ALT), com observação;
  3. senão: sem núcleo web (a ponte mostra o aviso e volta para a lista).
Uso: python3 -I data/mkcores.py card/etc/emulationstation/es_systems.cfg web/data/manifest.json
"""
import json, os, re, sys

R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BIOS_DIR = "/run/media/andre/EASYROMS/bios"
VARIANT = [r"_rumble$", r"_EX$", r"_xtreme(_amped)?$", r"32$", r"_wide$"]

# núcleos que o buildbot não publica para a web e que build/build-core.sh compila aqui (mesmo commit do RetroArch do
# nightly, mesmo formato <núcleo>_libretro.{js,wasm}); entram como núcleos web, com a observação na tabela
OWN_CORES = {
    "mupen64plus_next": "compilado aqui (build/build-core.sh: mupen64plus-libretro-nx + GLideN64, WebGL2, ASYNCIFY)",
    "prosystem": "compilado aqui (build/build-core.sh)",
    "picodrive": "compilado aqui (build/build-core.sh): o do buildbot aborta em todo jogo de 32X (mmap com assinatura errada no emscripten), corrigido",
    "ppsspp": "compilado aqui (build/build-core.sh: fork EmulatorJS/ppsspp, pthreads + WebGL2; exige COOP/COEP); saves do memory stick sincronizados num blob por jogo",
    "easyrpg": "compilado aqui (build/build-core.sh: EasyRPG Player libretro; sem ICU: só textos windows-1252; sem MP3/OGG, MIDI pelo FmMidi interno)",
    "melonds": "compilado aqui (build/build-core.sh: melonDS libretro, renderizador por software; BIOS/firmware livres embutidos)",
    "flycast": "compilado aqui (build/build-core.sh: flycast + port wasm/JIT SH4->wasm do nasomers/flycast-wasm, WebGL2); sem BIOS no cartão: boot HLE",
}
# núcleos que gravam o save como arquivo próprio (não o .srm da SRAM do RetroArch) no savefile_directory
SAVE_EXT = {"melonds": ".sav", "flycast": ".A1.bin"}   # flycast: VMU A1 por jogo (reicast_per_content_vmus)
# save em árvore (o play.js empacota num blob <rom>.savedata): memory stick do PPSSPP fica em savefile_directory
SAVE_TREE = {"ppsspp": "PSP/SAVEDATA", "easyrpg": "{rom}.save"}   # EasyRPG: zip só leitura -> grava em <rom>.save/
# núcleos que quebram no quit do RetroArch: o play.js sai direto (Select+Start) sem descarregar o jogo
DIRECT_EXIT = {"ppsspp", "easyrpg"}   # easyrpg: atexit com assinatura errada no fim
# núcleos com pthreads (SharedArrayBuffer -> crossOriginIsolated): no site (sem COEP) a ponte abre o player numa aba
# isolada (retroarch/isolated.html); no hub o iframe já é isolado
THREADS = {"ppsspp"}
# arquivos de apoio servidos de web/retroarch/<url>/ (build/build-core.sh grava index.json) e montados sob demanda
ASSETS = {"ppsspp": {"url": "assets/ppsspp", "mount": "/roms/bios/PPSSPP"}}
# save inicial do cartão fora do padrão <rom>.srm ao lado da ROM (emulador do dArkOS fora do RetroArch)
CARD_SAVE = {"nds": {"dir": "backup", "ext": ".dsv", "footer": "desmume"}}   # DraStic
# sistemas cujo(s) núcleo(s) do dArkOS não existem na web, mas há outro núcleo web que roda o sistema
WEB_ALT = {
    "atari2600": ("tia", "stella/stella2014 não existem na web; Tia é o núcleo 2600 do pacote"),
    "mame": ("mame2003_plus", "mame2010 não existe na web; romset 0.139 x 0.78 do MAME 2003-Plus: parte dos jogos não abre"),
    "supergrafx": ("geargrafx", "mednafen_supergrafx não existe na web; Geargrafx roda SuperGrafx"),
    "pico-8": ("retro8", "o dArkOS usa o PICO-8 oficial/fake08 (fora do RetroArch); Retro8 é compatibilidade parcial"),
    "easyrpg": ("easyrpg", "o dArkOS usa o EasyRPG standalone; aqui o núcleo libretro"),
    "psp": ("ppsspp", "o dArkOS usa o PPSSPP standalone; aqui o núcleo libretro"),
    "nds": ("melonds", "o dArkOS usa o DraStic (fora do RetroArch); melonDS no navegador"),
}
# sistemas cujo núcleo web existe mas não roda o conteúdo (testado): ficam como "sem núcleo web"
WEB_BROKEN = {}
# BIOS que cada núcleo procura no system_directory (/roms/bios no dArkOS). required = não abre sem.
BIOS = {
    "pcsx_rearmed": [("scph1001.bin", False), ("scph5501.bin", False), ("scph7001.bin", False), ("scph101.bin", False)],
    "mednafen_pce_fast": [("syscard3.pce", False)],   # só para CD
    "geargrafx": [("syscard3.pce", False)],
    "handy": [("lynxboot.img", False)],
    "mgba": [("gba_bios.bin", False)],
    "prosystem": [("7800 BIOS (U).rom", False)],
    "gambatte": [("gb_bios.bin", False), ("gbc_bios.bin", False)],
    "nestopia": [("disksys.rom", False)],              # só FDS
    "mame2003_plus": [("mame2003-plus/hiscore.dat", False)],
    "flycast": [("dc/dc_boot.bin", False), ("dc/dc_flash.bin", False)],   # sem elas: BIOS HLE (reios)
}
# BIOS do cartão com nome que o núcleo web não reconhece: md5 conhecido -> nome esperado
BIOS_ALIAS_MD5 = {"924e392ed05558ffdb115408c263dccf": "scph1001.bin"}   # SCPH-1001 (v2.2 NA)
# library_name dos núcleos (pasta de overrides config/<nome>/ do RetroArch)
LIBRARY = {
    "snes9x": "Snes9x", "snes9x2010": "Snes9x 2010", "snes9x2005": "Snes9x 2005", "nestopia": "Nestopia", "fceumm": "FCEUmm",
    "quicknes": "QuickNES", "gambatte": "Gambatte", "tgbdual": "TGB Dual", "mgba": "mGBA", "vba_next": "VBA Next",
    "genesis_plus_gx": "Genesis Plus GX", "genesis_plus_gx_wide": "Genesis Plus GX Wide", "picodrive": "PicoDrive",
    "gearsystem": "Gearsystem", "mednafen_pce_fast": "Beetle PCE Fast", "geargrafx": "Geargrafx", "fbneo": "FinalBurn Neo",
    "fbalpha2012": "FB Alpha 2012", "mame2003_plus": "MAME 2003-Plus", "handy": "Handy", "mednafen_lynx": "Beetle Lynx",
    "pcsx_rearmed": "PCSX-ReARMed", "tia": "Tia", "retro8": "retro8", "ecwolf": "ecwolf", "scummvm": "scummvm",
    "mupen64plus_next": "Mupen64Plus-Next", "parallel_n64": "ParaLLEl N64", "melonds": "melonDS", "prosystem": "ProSystem", "ppsspp": "PPSSPP", "easyrpg": "EasyRPG Player", "flycast": "Flycast",
    "mednafen_ngp": "Beetle NeoPop", "mednafen_wswan": "Beetle WonderSwan", "mednafen_vb": "Beetle VB",
}

def parse_systems(path):
    txt = open(path, encoding="utf-8", errors="replace").read()
    out = []
    for b in re.findall(r"<system>.*?</system>", txt, re.S):
        g = lambda k: (re.search(f"<{k}>(.*?)</{k}>", b, re.S).group(1).strip() if re.search(f"<{k}>(.*?)</{k}>", b, re.S) else "")
        emus = [(n, re.findall(r"<core>(.*?)</core>", c)) for n, c in re.findall(r'<emulator name="([^"]+)"[^>]*>(.*?)</emulator>', b, re.S)]
        out.append({"name": g("name"), "fullname": g("fullname"), "path": "/" + g("path").strip("/"),
                    "command": g("command"), "emulators": emus})
    return out

def candidates(s):
    """(emulador padrão, núcleo padrão, [núcleos libretro na ordem]) como o ES escolheria."""
    cmd = s["command"]
    fixed = re.findall(r"/cores/([A-Za-z0-9_\-]+)_libretro\.so", cmd)
    if fixed:   # núcleo fixo no comando (sem %CORE%)
        return "retroarch", fixed[0], fixed
    if not s["emulators"]:
        return None, None, []
    emu, cores = s["emulators"][0]
    # só núcleos de emuladores RetroArch (os "cores" do mednafen/standalone são opções do script, não libretro)
    ra = [(e, cs) for e, cs in s["emulators"] if e.startswith("retroarch") or e.startswith("retrorun")]
    order = list(dict.fromkeys(c for e, cs in sorted(ra, key=lambda x: x[0] != emu) for c in cs))
    return emu, (cores[0] if cores else None), order

def web_name(core, web):
    if core in web:
        return core
    for v in VARIANT:
        base = re.sub(v, "", core)
        if base != core and base in web:
            return base
    return None

def bios_files():
    found = {}
    if os.path.isdir(BIOS_DIR):
        import hashlib
        for root, _, files in os.walk(BIOS_DIR):
            for fn in files:
                p = os.path.join(root, fn)
                rel = os.path.relpath(p, BIOS_DIR)
                md5 = hashlib.md5(open(p, "rb").read()).hexdigest() if os.path.getsize(p) < 64 << 20 else None
                found[rel] = md5
    return found

def hidden_systems(cfg):
    p = os.path.join(os.path.dirname(cfg), "../../home/ark/.emulationstation/es_settings.cfg")
    m = re.search(r'name="HiddenSystems"\s+value="([^"]*)"', open(p).read()) if os.path.isfile(p) else None
    return set(m.group(1).split(";")) if m else set()

def main(cfg, manifest_path, out_json, out_md):
    bot = set(open(os.path.join(R, "data/web-cores.txt")).read().split())
    web = bot | set(OWN_CORES)
    hidden = hidden_systems(cfg)
    files = json.load(open(manifest_path))["files"]
    games = {}
    for p, f in files.items():
        if f["kind"] == "empty" and p.startswith("/roms/") and not p.startswith("/roms/themes/"):
            games.setdefault(p, None)
    bios = bios_files()
    aliases = {BIOS_ALIAS_MD5[m]: rel for rel, m in bios.items() if m in BIOS_ALIAS_MD5 and BIOS_ALIAS_MD5[m] not in bios}
    systems, rows = {}, []
    for idx, s in enumerate(parse_systems(cfg)):
        n = sum(1 for p in games if p.startswith(s["path"] + "/"))
        if not n:
            continue
        folder = s["path"][len("/roms/"):].split("/")[0]
        emu, dcore, order = candidates(s)
        allowed, chosen, note = [], None, ""
        for c in order:
            w = web_name(c, web)
            if w and w not in allowed:
                allowed.append(w)
        if allowed:
            chosen = allowed[0]
            if dcore and chosen != dcore:
                note = f"{dcore} não existe na web"
        elif folder in WEB_ALT:
            chosen, note = WEB_ALT[folder]
            if chosen:
                allowed = [chosen]
        if chosen in OWN_CORES:
            note = "; ".join(x for x in (note, OWN_CORES[chosen]) if x)
        if folder in WEB_BROKEN:
            chosen, allowed, note = None, [], WEB_BROKEN[folder]
        darkos = f"{emu}/{dcore}" if dcore else (emu or "comando próprio")
        if not chosen and not note:
            note = "sem núcleo libretro no dArkOS" if not order else "nenhum dos núcleos (" + ", ".join(dict.fromkeys(order)) + ") existe na web"
        if s["name"] in hidden:
            note = "oculto no ES (HiddenSystems do es_settings.cfg)" + (f"; {note}" if note else "")
        if any(p.startswith(s["path"] + "/neogeo.") for p in games):
            note = (note + "; " if note else "") + "BIOS neogeo.7z na pasta dos jogos (lida sob demanda)"
        # só o núcleo escolhido vai para a web (os outros listados ficam como informação)
        entry = {"own": chosen in OWN_CORES, "name": s["name"], "fullname": s["fullname"], "games": n, "darkos": darkos, "core": chosen,
                 "fallbackFrom": dcore if chosen and dcore and chosen != dcore else None,
                 "cores": [chosen] if chosen else [], "alternatives": allowed[1:], "note": note,
                 "order": idx, "hidden": s["name"] in hidden}   # order/hidden: posição no carrossel do ES (testes)
        if chosen:
            need = []
            for c in [chosen]:
                for fn, req in BIOS.get(c, []):
                    need.append({"file": fn, "required": req, "present": fn in bios or fn in aliases,
                                 **({"from": aliases[fn]} if fn in aliases else {})})
            entry["bios"] = need
            entry["library"] = LIBRARY.get(chosen)
            if folder in CARD_SAVE:
                entry["cardSave"] = CARD_SAVE[folder]
            if chosen in DIRECT_EXIT:
                entry["directExit"] = True
            if chosen in THREADS:
                entry["threads"] = True
            if chosen in SAVE_TREE:
                entry["saveTree"] = SAVE_TREE[chosen]
            if chosen in ASSETS:
                entry["assets"] = ASSETS[chosen]
            if chosen in SAVE_EXT:
                entry["saveExt"] = SAVE_EXT[chosen]
        systems[folder] = entry
        rows.append((s["fullname"] or s["name"], folder, n, darkos, chosen, note, entry.get("bios", [])))
    os.makedirs(os.path.dirname(out_json), exist_ok=True)
    json.dump({"systems": systems, "biosAliases": aliases}, open(out_json, "w"), ensure_ascii=False, indent=1)
    play = [r for r in rows if r[4]]
    vis = [v for v in systems.values() if not v["hidden"]]
    vplay = [v for v in vis if v["core"]]
    lines = ["# Sistemas do cartão x núcleos web", "",
             "Gerado por `data/mkcores.py` (não editar à mão). Jogos = ROMs que o ES lista (extensões do `es_systems.cfg`).",
             f"Núcleos web: RetroArch emscripten do buildbot ({len(bot)} núcleos, `data/web-cores.txt`) + compilados aqui "
             f"por `build/build-core.sh` ({', '.join(sorted(OWN_CORES))}).", "",
             f"**{len(play)} de {len(rows)} sistemas jogáveis no navegador — {sum(r[2] for r in play)} de {sum(r[2] for r in rows)} jogos.** "
             f"Visíveis no ES (sem os do HiddenSystems): {len(vplay)} de {len(vis)} sistemas, {sum(v['games'] for v in vplay)} de {sum(v['games'] for v in vis)} jogos.", "",
             "| Sistema | Pasta | Jogos | dArkOS (emulador/núcleo) | Núcleo web | Observação |", "|---|---|---:|---|---|---|"]
    for full, folder, n, darkos, chosen, note, b in sorted(rows, key=lambda r: (-(r[4] is not None), -r[2])):
        bnote = "; ".join(f"BIOS {x['file']}: " + (f"do cartão ({x['from']})" if x.get("from") else "presente" if x["present"] else "ausente")
                          for x in b if x["present"] or x["required"])
        lines.append(f"| {full} | {folder} | {n} | {darkos} | {chosen or '— sem núcleo web'} | {'; '.join(x for x in (note, bnote) if x)} |")
    open(out_md, "w").write("\n".join(lines) + "\n")
    print(f"{len(play)}/{len(rows)} sistemas jogáveis, {sum(r[2] for r in play)}/{sum(r[2] for r in rows)} jogos; núcleos: "
          + " ".join(sorted({c for e in systems.values() for c in e["cores"]})))

if __name__ == "__main__":
    a = sys.argv[1:] + [None] * 2
    main(a[0] or os.path.join(R, "card/etc/emulationstation/es_systems.cfg"), a[1] or os.path.join(R, "web/data/manifest.json"),
         os.path.join(R, "web/data/cores.json"), os.path.join(R, "docs/cores-report.md"))
