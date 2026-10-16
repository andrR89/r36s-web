# Sistemas do cartão x núcleos web

Gerado por `data/mkcores.py` (não editar à mão). Jogos = ROMs que o ES lista (extensões do `es_systems.cfg`).
Núcleos web: RetroArch emscripten do buildbot (98 núcleos, `data/web-cores.txt`).

**22 de 30 sistemas jogáveis no navegador — 6769 de 7421 jogos.**

| Sistema | Pasta | Jogos | dArkOS (emulador/núcleo) | Núcleo web | Observação |
|---|---|---:|---|---|---|
| Game Boy Advance | gba | 1124 | retroarch/mgba_rumble | mgba | mgba_rumble não existe na web |
| Megadrive | megadrive | 1005 | retroarch/genesis_plus_gx | genesis_plus_gx |  |
| Super NES | snes | 989 | retroarch/snes9x | snes9x |  |
| Game Boy Color | gbc | 564 | retroarch/gambatte | gambatte |  |
| Game Boy | gb | 533 | retroarch/gambatte | gambatte |  |
| NES | nes | 500 | retroarch/nestopia | nestopia |  |
| MAME2010 | mame | 442 | retroarch/mame2010 | mame2003_plus | mame2010 não existe na web; romset 0.139 x 0.78 do MAME 2003-Plus: parte dos jogos não abre; BIOS mame2003-plus/hiscore.dat: presente |
| Master System | mastersystem | 349 | retroarch/genesis_plus_gx | genesis_plus_gx |  |
| PC Engine | pcengine | 348 | retroarch/mednafen_pce_fast | mednafen_pce_fast |  |
| Atari 2600 | atari2600 | 255 | retroarch/stella2014 | tia | stella/stella2014 não existem na web; Tia é o núcleo 2600 do pacote |
| Game Gear | gamegear | 241 | retroarch/genesis_plus_gx | genesis_plus_gx |  |
| Neo Geo | neogeo | 161 | retroarch/fbneo | fbneo | BIOS neogeo.7z na pasta dos jogos (lida sob demanda) |
| Atari Lynx | atarilynx | 88 | retroarch32/handy | handy |  |
| PlayStation | psx | 52 | retroarch32/pcsx_rearmed_rumble | pcsx_rearmed | pcsx_rearmed_rumble não existe na web; BIOS scph1001.bin: do cartão (scph10011.bin) |
| Capcom System II | cps2 | 36 | retroarch/fbneo | fbneo |  |
| Sega 32X | sega32x | 33 | retroarch/picodrive | picodrive |  |
| Capcom System I | cps1 | 28 | retroarch/fbneo | fbneo |  |
| PICO-8 | pico-8 | 7 | float-scaled | retro8 | o dArkOS usa o PICO-8 oficial/fake08 (fora do RetroArch); Retro8 é compatibilidade parcial |
| Capcom System III | cps3 | 6 | retroarch/fbneo | fbneo |  |
| Super Grafx | supergrafx | 5 | retroarch/mednafen_supergrafx | geargrafx | mednafen_supergrafx não existe na web; Geargrafx roda SuperGrafx |
| SCUMM Virtual Machine | scummvm | 2 | standalone | scummvm | oculto no ES (HiddenSystems do es_settings.cfg) |
| Wolfenstein | wolf | 1 | standalone | ecwolf | oculto no ES (HiddenSystems do es_settings.cfg) |
| N64 | n64 | 411 | retroarch32/parallel_n64 | — sem núcleo web | nenhum dos núcleos (parallel_n64, mupen64plus_next, mupen64plus) existe na web |
| NDS | nds | 126 | advanceddrastic | — sem núcleo web | sem núcleo libretro no dArkOS |
| Atari 7800 | atari7800 | 67 | retroarch/prosystem | — sem núcleo web | prosystem não existe no pacote web |
| Ports | ports | 17 | comando próprio | — sem núcleo web | sem núcleo libretro no dArkOS |
| EasyRPG | easyrpg | 15 | comando próprio | — sem núcleo web | sem núcleo libretro no dArkOS |
| PlayStation Portable | psp | 9 | standalone | — sem núcleo web | sem núcleo libretro no dArkOS |
| Dreamcast | dreamcast | 6 | retroarch32/flycast32_rumble | — sem núcleo web | nenhum dos núcleos (flycast32_rumble, flycast_xtreme, reicast_xtreme, flycast_rumble, flycast) existe na web |
| American Laser Games | alg | 1 | comando próprio | — sem núcleo web | oculto no ES (HiddenSystems do es_settings.cfg); sem núcleo libretro no dArkOS |
