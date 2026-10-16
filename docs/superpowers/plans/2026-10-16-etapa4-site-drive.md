# Etapa 4 — Site (home animada + login Google + biblioteca no Drive + controles)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development ou executing-plans.

**Goal:** Um site estático (vai pro Netlify depois, com o ok do andre) que abre numa home retrô animada, faz login com Google, encontra a biblioteca R36S no Google Drive (própria ou compartilhada), abre o ES/RetroArch lendo tudo do Drive e grava saves no Drive de cada usuário; com painel de comandos, joystick de toque no celular, controle USB/Bluetooth e 2 jogadores.

**Design aprovado (fonte da verdade visual):** canvas Claude Design https://claude.ai/artifact/LE7G6bjbxxHk2qTp2TrXWm — telas Main (home), Login, Biblioteca, Comandos, Celular. Ler o HTML das telas com a ferramenta Artifact (`action: read`, `path: project/<Tela>.dc.html`) e reproduzir em HTML/CSS puro (sem o runtime do canvas): mesma paleta (#1b1446, #ff2e88, #ffd23f, #2de2e6, #2ee6a6), fontes Press Start 2P + Space Mono, mesmas animações CSS (estrelas, título, anéis, moedas, flutuação, 1UP, invader, CRT) com `prefers-reduced-motion`. Imagens: baixar os assets do canvas (`read` com `path` = id do asset) para `web/site/img/`. As fotos do R36S são provisórias (techtactician.com) — manter crédito no rodapé.

## Arquitetura

- `web/site/` (novo): `index.html` (home), `login`/biblioteca/comandos como estados de uma SPA leve em JS puro (`site.js`), `site.css`.
- O ES atual (`web/index.html` + `fsboot.js` + `bridge.js` + `retroarch/`) passa a ter **dois backends de arquivos**, escolhidos por `config`: `hub` (atual, `fs/...` e `saves/...` do hub local — dev e testes continuam funcionando) e `drive`.
- Backend `drive`:
  - **Auth:** Google Identity Services (token client), Client ID em `config/google.json` (`744452506858-bc5ddj07lucb2kqgpcr8t7svfdmrfu1s.apps.googleusercontent.com`), escopos `https://www.googleapis.com/auth/drive.readonly` + `https://www.googleapis.com/auth/drive.file`. Token só em memória (renovação silenciosa); nunca em localStorage.
  - **Biblioteca:** pasta chamada `R36S` — busca `name='R36S' and mimeType=folder and trashed=false` em `'me' in owners` e `sharedWithMe`. Estados: compartilhada / própria / as duas (escolher; lembrar a escolha em localStorage) / nenhuma (modo demonstração + tutorial + "Pedir acesso" = abrir o link da pasta do andre no Drive, onde o Google oferece "Solicitar acesso" e manda e-mail ao dono).
  - **Índice:** dentro da pasta, `R36S/.web/manifest.json` + `eager.bin` gerados por um script local que já conhece os **IDs dos arquivos no Drive** (ver Task 3). `fsboot.js` com backend drive baixa esses dois e resolve cada arquivo lazy pelo ID.
  - **Leitura:** `GET https://www.googleapis.com/drive/v3/files/<id>?alt=media` com `Authorization: Bearer` e `Range` (play.js já lê em blocos de 4 MB). Cache das capas/tema em IndexedDB (ou Cache API) por ID+modifiedTime. Pré-busca das capas vizinhas na lista.
  - **Saves:** pasta `R36S Web — saves` criada pelo app no Drive **do usuário** (escopo drive.file), `<sistema>/<arquivo>`; mesmo contrato do hub (GET 404 = sem save; PUT = upload multipart/update; manter versão anterior: o Drive guarda revisões — usar isso em vez de `.bak`). Retry + IndexedDB pendente como hoje.
- **Demonstração:** 3–5 homebrews de licença livre (ex.: jogos de NES/GB homebrew com licença explícita de redistribuição — documentar a licença de cada um em `web/site/demo/LICENSES.md`), servidos junto com o site, num manifesto próprio.

## Tasks

### Task 1: Home + SPA (sem login ainda)
Reproduzir Main/Login/Biblioteca/Comandos/Celular do canvas em `web/site/`. Home fluida (desktop e celular), animações, links para as próximas telas. Servir pelo hub em `/r36s/site/` para teste local. Teste: playwright abre a home em 1440 e 390 de largura, sem erro de console, screenshot.

### Task 2: Login Google + resolução da biblioteca
GIS token client; tela de login com o aviso de app não verificado; após token, buscar pastas R36S (própria/compartilhada) e mostrar o estado certo. Origem local `http://localhost:8770` já está autorizada no Client ID. Não dá para automatizar o login do Google em teste: isolar a camada (`drive.js`) atrás de uma interface e testar com um **mock** do Drive (servidor fake local que imita os endpoints usados) — testes cobrindo os 4 estados e a busca.

### Task 3: Índice com IDs do Drive + backend drive no fsboot/play/bridge
- `data/mkmanifest.py` ganha modo `--drive-ids <lsjson>`: recebe a listagem do `rclone lsjson -R --hash`, com IDs, da pasta R36S no Drive, e grava `fileId` em cada entrada; gera `manifest.json`/`eager.bin` para subir em `R36S/.web/`.
- `fsboot.js`/`play.js`/`bridge.js`: backend plugável (`hub` | `drive`). O caminho `hub` continua idêntico (todos os testes atuais passando). O `drive` usa a camada `drive.js`.
- Testes com o mock do Drive: ES boota a partir do mock, abre um jogo (ROM via Range), save PUT/GET no mock.
- **Não** mexer no mapeamento de teclado nem em `cores.json` (outro agente está mexendo em núcleos/`play.js` em paralelo em outra branch — mantenha suas mudanças em `play.js` mínimas e isoladas numa função de I/O para facilitar o merge).

### Task 4: Controles — painel, toque, controle físico, 2 jogadores
- Painel "Comandos" (design aprovado) sobre o ES na primeira entrada e no botão "?"; aba conforme o aparelho (teclado / controle detectado via Gamepad API com nome / toque).
- Joystick de toque (layout do design Celular) só em telas de toque; gera os mesmos eventos de teclado do layout (W/A/S/D, L/K/J/I, U/O, Y/P, Enter, Backspace) para ES e iframe do RetroArch; multitouch (direcional + botão juntos); retrato e paisagem.
- Controle físico: ES (SDL2 emscripten joystick) e RetroArch (`input_joypad_driver` web) — mapear por posição física do R36S (botão de baixo = B, direita = A, esquerda = Y, cima = X, LB/RB = L/R, LT/RT = L2/R2, View/Back = Select, Menu/Start = Start; Select+Start = sair).
- **2 jogadores:** 2 controles → P1/P2; 1 controle + teclado → teclado P1, controle P2; Start+Select no controle troca; selos P1/P2 no topo como no design. Configurar `input_player2_*` e `input_player1/2_joypad_index` no cfg gerado. Teste com gamepads simulados (playwright: injetar `navigator.getGamepads` fake) — documentar que o teste real é com controles físicos.

### Task 5: Pronto para publicar (sem publicar)
- `build/site-dist.sh` monta `dist/` (site + ES + RetroArch + núcleos, sem ROMs, sem `card/`, sem saves), com headers COOP/COEP e MIME wasm via `_headers` do Netlify, e gzip/brotli.
- `docs/deploy.md`: como subir pro Netlify (só com ok do andre), como adicionar o domínio do Netlify como origem autorizada no Client ID, como subir as ROMs com rclone (`rclone copy` da mídia para `gdrive:R36S`), como gerar e subir o índice.
- Mostrar ao andre: screenshots (home desktop/celular, login, estados de biblioteca, painel, toque, 2 jogadores), resultado dos testes, pendências.
