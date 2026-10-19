# Seletor de jogos (substitui o EmulationStation) — design

Data: 2026-10-19 · Status: aprovado no brainstorm, aguardando revisão da spec

## Objetivo

Trocar o EmulationStation compilado para WASM por um seletor próprio em HTML/JS: escolher sistema e jogo com
facilidade no celular e no PC, visual moderno, abrir o emulador certo com a ROM e baixar o arquivo da ROM quando
quiser. O ES sai de vez nesta entrega (sem modo alternativo).

Fora de escopo: multiplayer pela internet (netplay), guardar ROMs no aparelho para jogar sem internet, sincronizar
favoritos entre aparelhos, remapear controle por sistema.

## Decisões do brainstorm

| Tema | Decisão |
|---|---|
| Layout | **Prateleiras** (Netflix/Steam): destaque "continuar jogando", fileiras Recentes, Favoritos e uma por sistema |
| Estilo | **Moderno e limpo**: fundo quase preto, cantos arredondados, capas em destaque, fonte do sistema |
| Toque na capa | Abre a **ficha**; jogar é o botão ▶ da ficha |
| Favoritos e recentes | **Só no aparelho** (localStorage) |
| "Baixar a ROM" | Botão que **salva o arquivo** da ROM (para outro emulador ou o R36S de verdade) |
| "Jogar online" | Jogar pelo site de qualquer lugar (o que já existe); netplay fora |
| ES | **Sai de vez** |
| Dados | Índice próprio `library.json` gerado ao publicar |

Mockups aprovados: `.superpowers/brainstorm/53315-1792431094/content/telas.html` (início, ficha, busca, PC).

## Telas

- **Início**: busca no topo; destaque com o último jogo jogado (print de fundo, nome, sistema, ▶ Jogar); fileiras
  horizontais Recentes, Favoritos (somem se vazias) e uma por sistema com jogos, na ordem do `es_systems.cfg`, cada
  uma com "ver todos N ›". Fileira mostra até 20 capas.
- **Sistema** ("ver todos"): grade de capas de todos os jogos do sistema; ordem A–Z (padrão) ou por ano.
- **Busca**: todos os sistemas, filtra enquanto digita, sem diferenciar acento nem maiúsculas; resultado em lista
  (capa pequena, nome, sistema · ano).
- **Ficha** (painel de baixo no celular, painel lateral/modal no PC): print, nome, etiquetas (sistema, ano,
  jogadores, gênero), descrição, botões **▶ Jogar**, **☆ Favoritar**, **⬇ ROM**. Sistema sem emulador web: ficha
  com o motivo (`cores.json` note) e sem ▶; na fileira a capa aparece apagada.
- **PC (largura ≥ 900 px)**: barra lateral com Início, Favoritos e os sistemas (clicar rola até a fileira ou abre a
  grade); as mesmas fileiras no centro.
- **Jogo**: abre em tela cheia por cima, como hoje (`retroarch/play.html` + controles de toque + aba Configurar).
  Ao sair, o seletor volta com a mesma posição e foco.
- Cabeçalho: menu com Configurar (painel atual de comandos), Tela cheia, Sair (volta para a biblioteca do site).

## Dados

`data/mkmanifest.py` passa a gerar, além do `manifest.json`:

`library.json`
```json
{ "version": 1,
  "systems": [ { "id": "snes", "name": "Super Nintendo", "count": 812, "playable": true, "note": "" } ],
  "games": [ { "s": "snes", "rom": "/roms/snes/Donkey Kong Country 3 (USA).sfc", "name": "Donkey Kong Country 3",
               "year": 1996, "players": "1-2", "genre": "Plataforma", "desc": "…",
               "box": "<ref>", "shot": "<ref>", "logo": "<ref>" } ] }
```
- Fontes: `gamelist.xml` de cada sistema (`name`, `desc`, `releasedate`, `players`, `genre`, `thumbnail`,
  `image`, `marquee`), `/etc/emulationstation/es_systems.cfg` (nome, pastas, extensões, ordem) e
  `data/cores.json` (`playable`, `note`).
- ROM sem entrada no `gamelist`: nome = arquivo sem extensão, sem descrição nem imagens. Entradas do `gamelist`
  cujo arquivo não existe são ignoradas. Arquivos auxiliares (`.bin` citados por `.cue`, BIOS) não viram jogo:
  vale a lista de extensões do `es_systems.cfg`, e `.cue/.m3u/.gdi` escondem os arquivos que citam.
- `<ref>` de imagem: com `--drive-ids`, `{"id": "<ID no Drive>", "v": "<modifiedTime>"}` (o seletor busca direto,
  sem esperar o manifest); sem, o caminho virtual do cartão (`/roms/snes/images/…-thumb.png`), servido por `fs/` no
  hub e por `site/demo/` no demo. Campos vazios são omitidos.
- `manifest.json` continua (o emulador acha ROM, BIOS, irmãs da pasta e configs do cartão por ele). O seletor
  carrega o manifest em segundo plano depois da primeira tela.
- `eager.bin` deixa de existir: no modo Drive todos os arquivos ficam sob demanda. `io.js` aceita índice sem eager.
- Upload: `build/upload/sobe.sh` envia `library.json` para `R36S/.web` junto com o manifest; `drive.libraryIndex`
  devolve também o ID do `library.json`.

## Componentes

Seletor em `web/index.html` (substitui a página do ES; `web/site/site.js` monta o iframe como hoje). Módulos ES
sem etapa de build, em `web/app/`:

| Módulo | Responsabilidade | Depende de |
|---|---|---|
| `library.js` | carrega `library.json`, índice por sistema, busca normalizada, ordens | `io.js` |
| `media.js` | URL de imagem sob demanda (IntersectionObserver), cache/pré-busca do `io.js`, placeholder com o nome | `io.js` |
| `home.js` · `system.js` · `search.js` · `sheet.js` | as quatro telas | `library.js`, `media.js`, `prefs.js` |
| `nav.js` | foco espacial por controle/teclado: direcional/setas movem, A/Enter abre, B/Esc volta, Start = Jogar na ficha | `settings.js` (mapa do controle) |
| `prefs.js` | favoritos e recentes (localStorage `r36s-prefs-v1`, try/catch) | — |
| `launch.js` | antigo `webLaunch` do `bridge.js`: escolhe o núcleo (`cores.json`), iframe `play.html` ou aba isolada (núcleos com threads), volta com código de saída | `cores.json` |
| `download.js` | botão ⬇ ROM | `io.js`, `drive.js` |

Ficam: `retroarch/play.js` (inalterado, exceto não depender de `eager`), `io.js`, `drive.js`, `site/auth.js`,
`settings.js`, `config-ui.js`, `controls.js`. `controls.js` fora do jogo deixa de mandar teclas para um canvas do
ES; o painel de comandos/Configurar continua abrindo pelo menu do seletor.

Saem: `web/emulationstation.{js,wasm}`, `web/fsboot.js`, a parte de ES do `web/bridge.js`, `src/es`,
`patches/es/0001-0007`, o build do ES, a parte de tema do `mkmanifest.py`, testes `flicker.mjs` e `eslist.mjs`.

## Fluxo

1. Site (login, escolha da biblioteca) monta o seletor com o backend (`drive`/`demo`; hub sem site).
2. Seletor baixa `library.json` (cache por ID + modifiedTime, como o índice hoje), desenha o Início; capas pedidas
   só quando entram na tela; manifest em segundo plano.
3. Ficha → ▶ Jogar (se o manifest ainda não chegou, o botão mostra "preparando…" e espera) → `launch.js` → `play.html?system&core&rom` (lê ROM, BIOS e save pelo `io.js`) → ao sair,
   registra em recentes e devolve o foco.

## Baixar a ROM

- Hub e demo: link direto (`<a download>`) para o arquivo.
- Drive, até 100 MB: `drive.media` com o token no cabeçalho → Blob → download com o nome original, com progresso
  na ficha e cancelar.
- Drive, acima de 100 MB: abre `https://drive.google.com/file/d/<id>/view` numa aba nova (download pelo próprio
  Google, sem segurar o arquivo na memória do celular).
- O token nunca vai em URL.

## Erros

- Biblioteca sem `library.json`: tela "Esta biblioteca precisa ser atualizada" com o comando (`mkmanifest` +
  `sobe.sh`).
- Capa que falha: placeholder com o nome; a fileira segue.
- Login vencido: aviso "Continuar com o Google" (já publicado).
- Falha ao abrir o jogo: mensagem do `play.js`; a volta preserva posição e foco.
- Sem WebGL / erro ao iniciar: mantém o teste de WebGL e o `showFatal` atuais.

## Testes

- `tests/test_library.py`: mini cartão de exemplo → `library.json` (com e sem gamelist, sistema sem núcleo web,
  acentos, `.cue` escondendo `.bin`, entrada de gamelist sem arquivo).
- `tests/test_app.mjs` (node): busca normalizada, ordens, favoritos/recentes.
- Navegador (Playwright, `MemoryMax=12G`):
  - `e2e_site.mjs` adaptado: login mock, Início, ficha, jogar, save PUT/GET no Drive mock, volta com o foco.
  - `e2e_systems.mjs` adaptado: um jogo de cada um dos 23 sistemas pelo `launch.js`.
  - `quit_loading`, `touch_game`, `controls_config`: mesmo comportamento.
  - novo `nav_pad.mjs`: controle simulado navega, A abre a ficha, B volta, Start joga.
  - novo `perf_home.mjs`: celular simulado, bytes e tempo até a primeira tela; rolar fileira/grade de 800 capas.
  - `download.mjs`: ⬇ ROM no hub (arquivo igual ao do cartão) e no Drive mock (pequeno = blob, grande = abre aba).
- Antes de publicar: teste no Drive real e conferência no A54 pelo andre.

## Critérios de sucesso

- Primeira tela no celular com < 1 MB transferido (fora capas) e sem baixar o manifest antes de aparecer.
- Rolagem sem travar numa grade de 800 capas no A54.
- Os 23 sistemas abrem pelo seletor; saves continuam indo e voltando do Drive.
- Nenhum arquivo do ES no `dist/`.
