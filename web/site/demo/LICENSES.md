# Modo demonstração — licenças

Jogos homebrew servidos junto com o site (sem login, ou para quem ainda não tem biblioteca).
Só entram jogos com licença explícita que permite redistribuir; cada um com a fonte da licença conferida em 2026-10-16.

| jogo | arquivo | sistema | autor | licença | fonte / ROM | sha256 |
|---|---|---|---|---|---|---|
| Thwaite | `fs/roms/nes/Thwaite.nes` | NES | Damian Yerrick (2011, 2012, 2018) | GNU GPL 3 ou posterior (README: "This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License ... version 3 ... or any later version"; alguns arquivos genéricos sob licença tipo zlib) | código: https://github.com/pinobatch/thwaite-nes · ROM: release v0.04 (`thwaite.nes`) | `a2df24d9c9f72e56c2fdc4c703becc47a5700ad0158da8208247635ebeb3779c` |
| Concentration Room | `fs/roms/nes/Concentration Room.nes` | NES | Damian Yerrick (2010) | GNU GPL 3 ou posterior, com exceção explícita: "you may copy and distribute exact copies of the program, as published by Damian Yerrick, in iNES or UNIF executable form without source code" | código: https://github.com/pinobatch/croom-nes · ROM: release v0.02a (`croom.nes`) | `2ce17df1ad66a8a0533c0a8739f5b5ebe275c264924bbe350c42c5ac0394f20e` |
| µCity | `fs/roms/gbc/uCity.gbc` | Game Boy Color | Antonio Niño Díaz (2017) | código GPL 3 ou posterior (README: "This game is licensed under the GPLv3+ license"; GBT Player: BSD 2 cláusulas); gráficos e música CC BY-SA 4.0 | código: https://github.com/AntonioND/ucity · ROM: release v1.3 (`ucity.gbc`) | `9422ee2ca7b7ea1d46b58b2a429fff3f354dfd3e732dee1e7ae6220f148ce6e0` |

As ROMs são as dos releases oficiais, sem modificação. Para os jogos GPL, o código-fonte correspondente está nos
repositórios acima (oferta de fonte da GPL 3, seção 6d: a fonte fica acessível no mesmo lugar de onde vem o binário,
por link).

Vaga para mais jogos: **sem candidato confirmado**. Tobu Tobu Girl (MIT + CC BY 4.0) e Super Tilt Bro. (WTFPL) têm
licença livre, mas a ROM só sai pelo itch.io (sem download direto conferível daqui) — ficam de fora até alguém baixar
e conferir.

## Demais arquivos do modo demonstração

- Tema `fs/roms/themes/r36s-demo/`: autoria própria deste projeto (XML + PNGs de cor sólida).
- Fonte Press Start 2P (tema e site): SIL Open Font License 1.1 — `fs/roms/themes/r36s-demo/_art/OFL-PressStart2P.txt`
  e `../fonts/OFL-PressStart2P.txt`. Space Mono (site): SIL OFL 1.1 — `../fonts/OFL-SpaceMono.txt`.
- `fs/usr/bin/emulationstation/resources/` (gerado por `data/mkdemo.py`, não versionado): recursos do
  EmulationStation (MIT) e as fontes que ele traz (Open Sans/Apache 2.0, DejaVu, Droid Sans Fallback/Apache 2.0,
  Nanum Myeongjo/OFL, Font Awesome/OFL).
- O tema EPICMAX do cartão (CC BY-NC-SA 4.0) **não** vai no demo: fica só na biblioteca de cada um, no Drive.
