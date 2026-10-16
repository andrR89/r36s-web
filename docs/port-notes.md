# Notas do port (correções fora do plano)

Uma linha por correção: arquivo — problema — correção. Patches do ES em `patches/es/` (branch `web` de `src/es`).

## Build
- `src/es/CMakeLists.txt` — `cmake_minimum_required(2.8)` recusado pelo CMake novo — `build-es.sh` passa `-DCMAKE_POLICY_VERSION_MINIMUM=3.5`.
- `src/es/external/pugixml` — submódulo git vazio no clone — `git submodule update --init` (já feito; necessário num clone novo).
- RapidJSON — não existe em `/usr/include`; v1.1.0 não compila com clang novo — `build-es.sh` baixa o `master` para `build/rapidjson/` (ignorado no git).
- `CMakeLists.txt` — sob emscripten o compilador não é GNUCXX, então o `-std=c++11 -O2` original não entra — flags próprias no bloco `WEB`: `-std=gnu++17 -O2 -Wno-register -Wno-c++11-narrowing`.
- `CMakeLists.txt` — `EXECUTABLE_OUTPUT_PATH` apontava para a árvore de fontes — com `WEB` vai para `build/es-out/`.
- `CMakeLists.txt` — linker: adicionados `-sEXPORT_ES6=1` (página importa como módulo), `ENV` em `EXPORTED_RUNTIME_METHODS`, `-sEXIT_RUNTIME=0`.
- `build-es.sh` — `ES_LDFLAGS="--profiling-funcs -sASSERTIONS=1"` gera build de depuração com nomes nas pilhas.

## Dependências / stubs
- Renderer — o fcamod do ArkOS **não usa janela SDL**: display, contexto GLES, apresentação, barra de título, áudio e brilho vêm do **libgo2** — shim `es-core/src/web/go2/*.h` + `go2_web.cpp` (SDL2 + WebGL, 640x480; a barra de título RGB565 do ArkOS é desenhada como textura GL; sysfs falso em `/sys/class/...` com bateria 100%, AC off, wifi down, brilho 100%).
- `VideoVlcComponent.cpp` — referenciado por ThemeData, GridTileComponent, main e SystemScreenSaver, não dá para tirar da lista — mantido; `es-core/src/web/vlc/vlc.h` é um stub (`libvlc_new` → NULL, sem vídeo; cai no snapshot).
- `CECInput.cpp` — compila sem `HAVE_LIBCEC` — mantido (o plano mandava remover).
- `drm/drm_fourcc.h` — header do kernel usado pelo Renderer_GLES10 — stub com `DRM_FORMAT_RGB565`.
- `VolumeControl.cpp` — o emscripten não define `__linux__`, então o ramo ALSA some sozinho e o volume fica em memória — sem patch.
- Scrapers — referenciados fora de `scrapers/` (main, GuiMenu, GuiScraperStart…) — mantidos sobre o stub de HttpReq; `Scraper.cpp` `resizeImage` (FreeImage) retorna `true` sob `_WEB_`.
- `ScraperCmdLine.cpp` — `sleep` sem declaração (`unistd.h` só com `__linux__`) — include também com `_WEB_`.
- `TextListComponent.h`, `ImageGridComponent.h` — clang: "dependent using declaration resolved to type without 'typename'" — `using typename IList<...>::Entry` sob `_WEB_`.
- `ImageIO.cpp` — a API real é `loadFromMemoryRGBA32` (vector) + `loadFromMemoryRGBA32Ex` (com maxSize) — as duas reimplementadas com stb_image; saída invertida verticalmente (linha 0 = base, como o FreeImage entregava); redução por média de área no lugar de `FreeImage_Rescale` (não foi ignorada).

## Threads, laço e FS
- `AsyncUtil.cpp` — `isCanRunAsync()` usa `hardware_concurrency()`, que no navegador pode ser > 2 — retorna `false` sob `_WEB_`.
- Laço principal — em vez de `emscripten_sleep(0)` depois do `swapBuffers`, o quadro é apresentado em `go2_presenter_post` (chamado dentro do `swapBuffers`), que espera o próximo `requestAnimationFrame` (com `setTimeout` de 100 ms como rede). Ritmo de vsync e telas de "carregando" também aparecem. `emscripten_sleep(0)` fica no `playVideo` e no ramo `isSleeping`.
- `Renderer_GLES10.cpp` — o GL1 emulado amostra texturas `GL_ALPHA` como (0,0,0,a): todo texto saía preto — texturas ALPHA viram RGBA branco + alfa sob `_WEB_`; `glTexSubImage2D` com glifo vazio (sem pixels) é pulado.
- `ImageIO::getImageSize` — lê o arquivo direto com `fopen` (não passa pelo ResourceManager) e guardaria "tamanho inválido" para as capas lazy — também chama `web_fetch_lazy`.
- `ResourceManager::getFileData` — mede o tamanho antes de abrir; placeholder lazy tem 0 bytes — o fetch vai no início da função, antes do `getFileSize`.
- `fsboot.js` — o ES abre o tema por `/etc/emulationstation/themes/...` (symlink) — `fetchLazy` normaliza o caminho com `FS.lookupPath` antes de procurar no manifesto.
- Busca lazy no meio de um quadro cede ao navegador (ASYNCIFY): pode aparecer um quadro incompleto na primeira vez que uma imagem é vista. Pré-busca fica para depois.
- Threads não convertidas: `ApiSystem` (ThreadedUpdater), `ContentInstaller`, `ThreadedScraper` — só disparam por menu (atualizar/instalar/scrapear); vão falhar se usadas.

## Dados e página
- `InputManager::getConfigPath` — no fcamod do ArkOS é `/etc/emulationstation/es_input.cfg` (não `~/.emulationstation`); sem ele abre o "NO GAMEPADS DETECTED" — `mksample.py` grava lá o mapeamento de teclado do `loadDefaultKBConfig` (setas, Enter=A, Esc=B, F1=Start, F2=Select, `]`/`[`=PageUp/Down); `mkmanifest.py` trata `/etc/` como eager.
- `resources/` do ES (fontes, ícones, mamenames…) — necessários e não estavam no FS — `mksample.py --es-only` copia para `/usr/bin/emulationstation/resources` (caminho do dArkOS) + executável vazio `/usr/bin/emulationstation/emulationstation` (o `setExePath` só usa o diretório se `argv[0]` for arquivo regular); `Module.thisProgram` aponta para ele; `mkmanifest.py`: `/usr/` eager, menos fontes ≥ 1 MB (fallback CJK) que ficam lazy.
- `index.html` — o port SDL2 registra os handlers em `#canvas` — o canvas se chama `canvas` (não `screen`).
- `index.html` — sem `--resolution`: o tamanho 640x480 vem do shim de display, como no aparelho; só `--home /home/ark`.
- `tests/smoke.mjs` — `preserveDrawingBuffer` forçado por `addInitScript` (só no teste); 4ª screenshot numa posição com capa; mede `readyMs`/`visibleMs`; grava `tests/out/console.log`; playwright-core 1.48.2 instalado em `tools/pw` (o do scratchpad antigo está em /tmp).
- Lançamento — o `%ROM%` chega escapado para shell (`/roms/snes/2020\ Super\ Baseball\ \(USA\).7z`): a ponte da Etapa 3 precisa desfazer o escape. Depois do lançamento o ES recria janela/contexto GL (funciona).

## RetroArch (Etapa 2)
- Fonte: nightly `buildbot.libretro.com/nightly/emscripten/2026-10-15_RetroArch.7z` (772 MB; fica em `build/retroarch-dl/`, ignorado) — `build/get-retroarch.sh [data]` extrai só `snes9x_libretro.{js,wasm}` para `web/retroarch/` (ignorados no git; data em `web/retroarch/NIGHTLY`).
- Como o player oficial inicia (`retroarch/libretro.js` do pacote): o `<núcleo>_libretro.js` é módulo ES6 (`export default` fábrica), sem pthreads, laço por `emscripten_set_main_loop`; `noInitialRun`, `ENV.LIBRARY_PATH` = `/home/web_user/retroarch/cores/<núcleo>_libretro.core` (arquivo vazio: o núcleo é estático), `callMain(["-v", <conteúdo>, "-c", <cfg>])`; ao sair chama `Module.retroArchExit(core, content)` (o oficial relança no menu). O oficial monta /home com BrowserFS (IndexedDB + zip de 130 MB de assets) — **não usado**: `play.js` usa só o MEMFS; sem assets o menu é o `rgui` (fonte embutida).
- `.7z` — o build tem 7zip nativo: o conteúdo vai direto (`Loading content file: ...7z#...smc`); nenhuma extração no navegador.
- SRAM — o RetroArch grava o `.srm` no `savefile_directory` antes de chamar `retroArchExit`; nome = nome do `.7z` sem extensão + `.srm` (igual ao aparelho). `_cmd_savefiles` também é exportado (não precisou).
- Áudio — driver padrão do build é `rwebaudio` (síncrono, 48 kHz). O iframe recebe `allow="autoplay"` para herdar a permissão do clique/tecla no ES.
- `retroarch.cfg` web (em `play.js`): derivado do real — Select = hotkey (`input_enable_hotkey`), Select+Start = sair, Select+B = salvar estado, Select+A = carregar estado (como os `_btn` do dArkOS), `autosave_interval = 10`; teclado igual ao do ES (setas, Enter=A, Esc=B, F1=Start, F2=Select) + X=`s`, Y=`a`, L=`q`, R=`w` (as teclas do cfg real); Select+F3 = menu do RetroArch; `quit_press_twice`/`confirm_quit` desligados (senão o primeiro Select+Start só avisa); demais atalhos padrão (F1 menu, Esc sair, espaço avanço...) em `nul`.
- `platform.cpp` — variável local `system` sombreava `std::system` no ramo não-web — renomeada `sysName`.
- `build/build-es.sh` — copiava o `emulationstation.{js,wasm}` antigo mesmo com o `make` falhando — agora sai com erro e não toca em `web/`.
- `hub.py` — `mkstemp` cria 0600 — `chmod 0644` antes do `os.replace`.
- Ponte — o ES lança pelo comando real (`webParseLaunch`: núcleo de `/cores/<core>_libretro.so`, ROM = argumento seguinte até `;`, sistema = `/roms/<sistema>/`); a forma `web-launch` antiga continua aceita. Na volta: `SDL_PumpEvents` + `SDL_FlushEvents`. O áudio do ES já é fechado/reaberto pelo `launchGame` (`AudioManager::deinit/init`), sem patch extra.
- Foco — `bridge.js keepFocus`: foca o `#canvas` ao carregar, ao clicar, ao voltar à aba; tecla com foco fora do canvas é repassada a ele (a primeira não se perde).
- Save do DK3 — o `.srm` do cartão tem 2 KB e só ~56 bytes não-zero (a tabela de nomes padrão: RARE/CRANK/FUNK/SWANK/WRINK); no jogo, os 3 arquivos aparecem vazios — não há progresso nele (provável: save de outra versão da ROM, a ROM traduzida é de 2024 e o save de 2023). A ROM traduzida declara SRAM de 1024 Kbit: o snes9x web grava 128 KB; os 2 KB iniciais continuam idênticos (o e2e confere) e o `.bak` guarda a versão anterior.

## Cartão real (Etapa 3)
- Fonte — `data/mkcard.py` monta `card/` (ignorado no git): `card/roms` é symlink para o EASYROMS montado (nada é copiado; o hub serve direto do cartão, só leitura), `etc/` e `home/` são cópias pequenas do ROOTFS (es_systems.cfg, es_settings.cfg, collections/, retroarch.cfg, retroarch-core-options.cfg, config/), `usr/` é o nosso resources/ do ES + o que só o do cartão tem (`battery/`, `fontawesome-webfont.ttf`). `web/fs -> ../card`. O plano falava em `card-config/`: ficou tudo numa árvore só (`card/`), que é o que o manifesto percorre.
- `mkmanifest.py` — com es_systems.cfg na árvore, entra só o que o ES usa: ROMs pelas extensões de cada sistema (vazias), gamelist.xml (eager), mídia citada nos gamelists ou em `images/` (LocalArt) e BIOS (sob demanda), tema ativo do es_settings (xml/fontes/svg eager); ficam de fora dados de ports, `.Trash-1000`, músicas, ocultos. Segue symlinks. Cartão de 46 GB/45 mil arquivos -> 19,3 mil entradas, `manifest.json` 2,5 MB, `eager.bin` 16,9 MB (sem compressão: abaixo dos 10 MB do plano para o manifesto). `~/.emulationstation` é diretório oculto: o filtro de ocultos vale só dentro de `/roms`.
- Carrossel do EPICMAX é **vertical** (`rgb10.xml`: `<type>vertical</type>`): sistemas mudam com W/S, não A/D. O ES abre na coleção Favoritos (`StartupSystem = favorites`, 13 jogos).
- Capas WebP com extensão `.png` (67 no psx, 88 no psp, 1 em ports): o FreeImage do aparelho lê, o stb_image não — `fsboot.js` converte para PNG no navegador (`createImageBitmap` + `OffscreenCanvas`) ao baixar.
- Vídeos `.mp4` das listas (snap) continuam sem tocar (VLC é stub); o tema cai na imagem.
- Lançamento — no cartão real vários sistemas lançam por script (`n64.sh`, `drastic.sh`, `ppsspp.sh`, `amiga.sh`, ports `%ROM%`): `webParseLaunch` agora pega a ROM no primeiro argumento em `/roms/` quando não há `_libretro.so`; só o `FileData::launchGame` (que passa o nome do jogo) vai para a ponte — scripts de evento/menus (nome vazio) continuam ignorados.
- Núcleo — `data/mkcores.py` gera `web/data/cores.json` + `docs/cores-report.md`; a ponte troca o núcleo do comando pelo mapeado quando ele não existe na web (`pcsx_rearmed_rumble` -> `pcsx_rearmed`, `mgba_rumble` -> `mgba`, `stella2014` -> `tia`...). Sistema sem núcleo web: `bridge.js` mostra `#notice` por 3 s e devolve 1 na hora (o ES volta para a lista). Só o núcleo escolhido de cada sistema é extraído (16 núcleos, ~200 MB em `web/retroarch/`).
- `play.js` — a ROM fica em `/roms/<sistema>/...` no MEMFS (caminho do aparelho). Até 48 MB é baixada inteira; acima (CHD de PS1 de até 490 MB) e todas as irmãs da pasta viram arquivos sob demanda: nó do MEMFS com `stream_ops.read` próprio que lê pedaços de 4 MB por XHR síncrono com Range (`charset=x-user-defined`; o `createLazyFile` do emscripten recusa XHR binário síncrono fora de worker). Isso resolve BIOS/romset pai do arcade (o `neogeo.7z` está na pasta dos jogos) e multidisco. `.cue/.m3u/.gdi/.ccd`: as faixas citadas (as `.bin` não são extensão de jogo, não estão no manifesto) entram por HEAD + sob demanda.
- BIOS — `system_directory = /roms/bios` (como no dArkOS), todos os arquivos de `bios/` sob demanda. `scph10011.bin` do cartão tem o md5 do SCPH-1001 (924e392e…): `cores.json.biosAliases` cria `scph1001.bin`/`SCPH1001.bin` apontando para ele (o pcsx_rearmed só procura nomes fixos; no aparelho o duckstation/swanstation acha por conteúdo).
- Opções de núcleo — `retroarch-core-options.cfg` do cartão vira o `core_options_path` (global); `.opt` de `config/<library_name>/` (núcleo e jogo) por cima; `.cfg` de override filtrados (sem `input_*`, caminhos, drivers). `auto_overrides_enable`/`auto_remaps_enable` desligados: o remap `config/remaps/Nestopia/Nestopia.rmp` do cartão (turbo, troca A/B) **não** é aplicado para manter o layout de teclado. Prova de que as opções entram: o fbneo loga "Applied dipswitches from core options" no 2020bb (há `fbneo-dipswitch-2020bb-*` no cartão).
- `picodrive_drc = "enabled"` do cartão (recompilador ARM) derruba o picodrive web no 32X (`RuntimeError: unreachable`) — `play.js` descarta opções `*_drc`, `*_drc_thread`, `*dynarec*`.
- Save inicial — sem save no servidor (404), `play.js` usa o `.srm` do cartão ao lado da ROM, se houver (o psx tem 29), e só sobe quando muda.
- Teclas extras — L2 = `y` (ao lado do U = L) e R2 = `p` (ao lado do O = R), para PS1 e afins. L3/R3/analógico não mapeados (o pcsx_rearmed usa o controle digital por padrão).
- Cartão desmontado — o hub responde 503 "midia nao montada" para caminhos que passam por symlink quebrado (`web/fs/roms`); `index.html` mostra o aviso no canto e o ES abre com as listas do manifesto.
- 32X — o picodrive web aborta em todo jogo de 32X (`RuntimeError: unreachable` no `retro_load_game`), mesmo sem as opções do cartão e também no nightly 2026-10-03; Mega Drive no mesmo núcleo roda. `mkcores.py` (`WEB_BROKEN`) marca o sega32x como sem núcleo web (aviso + volta), e o picodrive nem é extraído.
