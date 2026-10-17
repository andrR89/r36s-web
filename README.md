# R36S Web

O **R36S com dArkOS no navegador**: o EmulationStation original (fork *fcamod*) compilado para WebAssembly, abrindo
os jogos no RetroArch web com os núcleos que o aparelho usa. Funciona no PC (teclado ou controle) e no celular
(joystick de toque, com os dois analógicos nos jogos que usam).

Site: **https://r36s-web.netlify.app** — o *modo demonstração* roda sem login, com três homebrews livres.

> **Traga suas ROMs.** Este repositório não tem ROMs, BIOS nem saves de jogos comerciais. Cada pessoa usa a própria
> biblioteca, numa pasta `R36S` no **próprio** Google Drive (a cópia do cartão `EASYROMS` do aparelho). Os saves ficam
> numa pasta `R36S Web — saves` no Drive de quem joga.

## Como funciona

```
navegador
 ├─ site (web/site/)          home, login Google (GIS, token só em memória), biblioteca no Drive, comandos
 ├─ ES  (web/index.html)      EmulationStation-fcamod → WASM (ASYNCIFY, GL1 emulado sobre WebGL), tema e gamelists
 │                            do cartão; arquivos sob demanda (capas, tema) por um FS virtual (web/fsboot.js)
 └─ jogo (web/retroarch/)     RetroArch emscripten + núcleo do sistema, num iframe (PSP: aba isolada, COOP/COEP)
Google Drive
 ├─ R36S/            = cartão EASYROMS (rclone copy)
 ├─ R36S/.web/       índice: manifest.json (caminho → ID do arquivo no Drive) + eager.bin (pacote do que o ES lê ao abrir)
 └─ R36S Web — saves/<sistema>/<arquivo>   no Drive de cada jogador (escopo drive.file)
```

- **ES:** fork de [christianhaitian/EmulationStation-fcamod](https://github.com/christianhaitian/EmulationStation-fcamod)
  com os patches de `patches/es/` (CMake/emscripten, stb_image, laço com asyncify, ponte de lançamento que recebe o
  comando real do dArkOS e abre o jogo no RetroArch, aviso de quadro completo).
- **Núcleos:** os do buildbot emscripten do RetroArch, mais os compilados aqui por `build/build-core.sh` com os patches de
  `patches/cores/` (mupen64plus_next, melonDS, ProSystem, PicoDrive, PPSSPP, EasyRPG, Flycast via
  [nasomers/flycast-wasm](https://github.com/nasomers/flycast-wasm)). Situação de cada sistema: `docs/cores-report.md`.
- **Controles:** `web/controls.js` — layout de teclado do R36S (WASD direcional, L/K/J/I = A/B/Y/X, Enter/Backspace =
  Start/Select, setas e T/F/G/H = analógicos), controle físico pela posição dos botões, 2 jogadores, joystick de toque.

## Montar

Precisa de Linux, Python 3, Node e dois emsdk (o ES usa o 6.0.12; os núcleos próprios, o 3.1.74). Os caminhos estão em
`build/env.sh` e no início de cada script — ajuste para a sua máquina.

```bash
git clone https://github.com/christianhaitian/EmulationStation-fcamod src/es
git -C src/es am ../../patches/es/*.patch
bash build/build-es.sh                 # -> web/emulationstation.{js,wasm}
bash build/get-retroarch.sh            # RetroArch e núcleos do buildbot
bash build/build-core.sh mupen64plus_next   # (e os outros de docs/cores-report.md)
python3 data/mkcores.py                # -> web/data/cores.json (sistema -> núcleo)
bash build/site-dist.sh                # -> dist/ (site estático, sem ROMs), com _headers do Netlify
```

Índice da biblioteca no Drive (depois de `rclone copy <EASYROMS> gdrive:R36S`):

```bash
rclone lsjson -R --hash --files-only gdrive:R36S > lsjson.json
python3 data/mkmanifest.py card web-index --drive-ids lsjson.json   # card/ = ROOTFS + EASYROMS do cartão
rclone copy web-index gdrive:R36S/.web
```

O login usa um Client ID OAuth do Google (`config/google.json`, público por natureza); para outra origem, crie o seu e
troque em `web/site/config.js`. Passo a passo de publicação: `docs/deploy.md`.

## Testes

Playwright (`playwright-core`) com Chromium em swiftshader: `tests/smoke.mjs`, `tests/e2e_snes.mjs`,
`tests/e2e_systems.mjs` (abre um jogo de cada sistema), `tests/e2e_site.mjs` (site com um Drive simulado,
`tests/mock_drive.py`), `tests/touch_sticks.mjs`, `tests/flicker.mjs`; e `python3 -m unittest discover -s tests`.

## Créditos

EmulationStation-fcamod (christianhaitian, MIT) · RetroArch e núcleos libretro (GPL e outras) · flycast-wasm (nasomers)
· dArkOS · homebrews da demonstração: *Thwaite* e *Concentration Room* (Damian Yerrick), *µCity* (Antonio Niño Díaz) —
licenças em `web/site/demo/LICENSES.md` · fontes Press Start 2P e Space Mono (OFL) · fotos do R36S no site:
techtactician.com (provisórias) · capturas de jogos: só ilustração, dos respectivos donos.

## Licença

GPL-3.0 (`LICENSE`). Os componentes de terceiros mantêm as licenças deles.
