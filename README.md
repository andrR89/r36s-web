# R36S Web

Os jogos do **R36S com dArkOS no navegador**: um seletor próprio (capas por sistema, busca, ficha do jogo com Jogar,
Favoritar e baixar a ROM) que abre os jogos no RetroArch web com os núcleos que o aparelho usa. Funciona no PC (teclado
ou controle) e no celular (joystick de toque, com os dois analógicos nos jogos que usam).

Site: **https://r36s-web.netlify.app** — o *modo demonstração* roda sem login, com três homebrews livres.

> **Traga suas ROMs.** Este repositório não tem ROMs, BIOS nem saves de jogos comerciais. Cada pessoa usa a própria
> biblioteca, numa pasta `R36S` no **próprio** Google Drive (a cópia do cartão `EASYROMS` do aparelho). Os saves ficam
> numa pasta `R36S Web — saves` no Drive de quem joga.

## Como funciona

```
navegador
 ├─ site (web/site/)          home, login Google (GIS, token só em memória), biblioteca no Drive, comandos
 ├─ seletor (web/index.html, web/app/)   prateleiras de capas, busca, ficha; foco por controle/teclado; capas sob
 │                            demanda (web/io.js: hub local, demonstração ou Drive)
 └─ jogo (web/retroarch/)     RetroArch emscripten + núcleo do sistema, num iframe (PSP: aba isolada, COOP/COEP)
Google Drive
 ├─ R36S/            = cartão EASYROMS (rclone copy)
 ├─ R36S/.web/       índice: library.json.gz (sistemas, jogos e metadados dos gamelist.xml) + manifest.json (caminho →
 │                   ID do arquivo no Drive) + eager.bin (configs do RetroArch do cartão)
 └─ R36S Web — saves/<sistema>/<arquivo>   no Drive de cada jogador (escopo drive.file)
```

- **Seletor:** `web/app/` (sem build). A primeira versão usava o EmulationStation-fcamod compilado para WebAssembly;
  ele saiu em 2026-10 por pesar dezenas de MB antes da primeira tela (o histórico do git guarda os patches).
- **Núcleos:** os do buildbot emscripten do RetroArch, mais os compilados aqui por `build/build-core.sh` com os patches de
  `patches/cores/` (mupen64plus_next, melonDS, ProSystem, PicoDrive, PPSSPP, EasyRPG, Flycast via
  [nasomers/flycast-wasm](https://github.com/nasomers/flycast-wasm)). Situação de cada sistema: `docs/cores-report.md`.
- **Controles:** `web/controls.js` — layout de teclado do R36S (WASD direcional, L/K/J/I = A/B/Y/X, Enter/Backspace =
  Start/Select, setas e T/F/G/H = analógicos), controle físico pela posição dos botões, 2 jogadores, joystick de toque.

## Montar

Precisa de Linux, Python 3, Node e o emsdk 3.1.74 (núcleos próprios). Os caminhos estão em
`build/env.sh` e no início de cada script — ajuste para a sua máquina.

```bash
bash build/get-retroarch.sh            # RetroArch e núcleos do buildbot
bash build/build-core.sh mupen64plus_next   # (e os outros de docs/cores-report.md)
python3 data/mkcores.py                # -> web/data/cores.json (sistema -> núcleo)
bash build/site-dist.sh                # -> dist/ (site estático, sem ROMs), com _headers do Netlify
```

Índice da biblioteca no Drive (depois de `rclone copy <EASYROMS> gdrive:R36S`):

```bash
rclone lsjson -R --hash --files-only gdrive:R36S > lsjson.json
python3 data/mkmanifest.py card web-index --drive-ids lsjson.json   # card/ = ROOTFS + EASYROMS; -> library.json.gz, manifest.json…
rclone copy web-index gdrive:R36S/.web
```

O login usa um Client ID OAuth do Google (`config/google.json`, público por natureza); para outra origem, crie o seu e
troque em `web/site/config.js`. Passo a passo de publicação: `docs/deploy.md`.

## Testes

Playwright (`playwright-core`) com Chromium em swiftshader: `tests/e2e_systems.mjs` (abre um jogo de cada sistema pelo
seletor), `tests/e2e_site.mjs` (site com um Drive simulado, `tests/mock_drive.py`), `tests/nav_pad.mjs` (só no controle),
`tests/perf_home.mjs` (primeira tela e rolagem), `tests/download.mjs`, `tests/e2e_snes.mjs`, `tests/touch_sticks.mjs`;
`node tests/test_app.mjs` e `python3 -m unittest discover -s tests`.

## Créditos

RetroArch e núcleos libretro (GPL e outras) · flycast-wasm (nasomers)
· dArkOS · homebrews da demonstração: *Thwaite* e *Concentration Room* (Damian Yerrick), *µCity* (Antonio Niño Díaz) —
licenças em `web/site/demo/LICENSES.md` · fontes Press Start 2P e Space Mono (OFL) · fotos do R36S no site:
techtactician.com (provisórias) · capturas de jogos: só ilustração, dos respectivos donos.

## Licença

GPL-3.0 (`LICENSE`). Os componentes de terceiros mantêm as licenças deles.
