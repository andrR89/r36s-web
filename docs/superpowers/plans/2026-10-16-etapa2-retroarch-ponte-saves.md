# Etapas 2+3 (SNES) — RetroArch WASM, ponte ES→jogo→ES e saves no servidor

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development ou executing-plans. Checkbox por passo.

**Goal:** No ES do navegador (`http://localhost:8770/r36s/`), escolher **Donkey Kong Country 2** e apertar Enter abre o jogo no RetroArch (núcleo `snes9x`, o mesmo do dArkOS), jogável no teclado; Select+Start sai e volta pra lista do ES; o `.srm` é salvo no servidor e volta na próxima sessão.

**Architecture:** O ES chama `runSystemCommand` → sob `_WEB_` um `EM_ASYNC_JS` aguarda `Module.webLaunch({system, core, rom})`; o ES fica suspenso (asyncify) enquanto o jogo roda. `web/bridge.js` cria um `<iframe src="retroarch/play.html?...">` por cima do canvas do ES; o iframe baixa núcleo + ROM + save, roda o RetroArch e avisa o pai (`postMessage`) ao sair; o pai remove o iframe e resolve a promise. Saves: `GET/PUT /r36s/saves/<sistema>/<arquivo>` no `hub.py`.

**Spec:** `docs/superpowers/specs/2026-10-16-r36s-web-design.md` (seções 2, 3, 5, Erros).

## Fatos já levantados

- Cartão montado (somente leitura): `/run/media/andre/ROOTFS` e `/run/media/andre/EASYROMS`. **Nunca escrever lá.**
- `es_systems.cfg` real do snes (`/run/media/andre/ROOTFS/etc/emulationstation/es_systems.cfg`): comando `sudo perfmax %GOVERNOR% %ROM%; nice -n -19 /usr/local/bin/%EMULATOR% -L /home/ark/.config/%EMULATOR%/cores/%CORE%_libretro.so %ROM%; sudo perfnorm`, núcleo padrão `snes9x`.
- ROMs: `/run/media/andre/EASYROMS/snes/Donkey Kong Country 2 - Diddy's Kong Quest (USA) (PT-BR).7z` (também DKC 1 e 3) e o save real `Donkey Kong Country 3 - Dixie Kong's Double Trouble! (USA) (PT-BR).srm`.
- `retroarch.cfg` real: `/run/media/andre/ROOTFS/home/ark/.config/retroarch/retroarch.cfg` (hotkeys do dArkOS; `autosave_interval = "10"`).
- RetroArch web oficial: `https://buildbot.libretro.com/nightly/emscripten/<data>_RetroArch.7z` (um `.js/.wasm` por núcleo). Usar o nightly mais recente que funcione; baixar para `build/retroarch-dl/` e extrair só o necessário (`snes9x_libretro.{js,wasm}` + o que o player exigir) para `web/retroarch/`.
- Comando ES chega com caminho escapado para shell (`2020\ Super\ Baseball\ \(USA\).7z`) — desescapar.
- Teclado já mapeado no ES (`es_input.cfg`): setas, Enter=A, Esc=B, F1=Start, F2=Select.
- Hub: `~/Workspace/web-ports/hub.py`, serviço `webports-hub` (systemd user). COOP/COEP já ativos.

## Tasks

### Task 1: ROMs reais na amostra + save semente
- [ ] `data/mksample.py`: copiar (não symlink, não mover) para `card-sample/roms/snes/` as 3 ROMs Donkey Kong Country do EASYROMS (substituindo vazios se houver) e acrescentá-las ao `gamelist.xml` (com capa do `pack-curado/snes/media/images` se existir). Usar o `es_systems.cfg` **real** do snes (comando completo do dArkOS, extensões reais) em vez do `web-launch`.
- [ ] Copiar o `.srm` do DK3 para `saves/snes/` (pasta do projeto, ignorada no git).
- [ ] Regerar manifesto; manifesto continua tratando ROM como `empty` (o ES só lista; a ponte baixa por `fs/roms/...`).
- [ ] Commit.

### Task 2: Rotas de save no hub (TDD)
- [ ] Teste `tests/test_saves.py`: sobe `hub.py` numa porta livre (subprocess, apontando `BASE` para um diretório temporário via env `WEBPORTS_BASE` se necessário — adicionar esse override), e verifica: `GET` inexistente → 404; `PUT` grava; `GET` devolve igual; segundo `PUT` deixa `.bak` com o conteúdo anterior; caminho com `..` ou fora de `saves/` → 400; nomes com espaço/parênteses/apóstrofo funcionam.
- [ ] Implementar em `hub.py`: só para o site `r36s`, `GET|PUT /r36s/saves/<sistema>/<arquivo>` mapeado para `~/Workspace/web-ports/r36s/saves/`. PUT atômico (tmp + `os.replace`), `.bak` da versão anterior, limite 16 MB. Não alterar o comportamento dos outros sites.
- [ ] `systemctl --user restart webports-hub`; testes passam; commit.

### Task 3: Player do RetroArch (`web/retroarch/play.html`)
- [ ] Baixar e examinar o bundle nightly; entender como o player oficial inicia (`Module.arguments`, FS, config). Documentar em `docs/port-notes.md`.
- [ ] `play.html?system=snes&core=snes9x&rom=<caminho em /roms>`: baixa `fs<rom>`; se for `.7z`/`.zip`, usar o suporte nativo do RetroArch se o build tiver (`HAVE_7ZIP`/zlib); se não tiver, extrair no navegador (lib JS pinada, sem CDN não versionado) ou adicionar rota no hub que entrega o arquivo interno — escolher a mais simples que funcione e anotar.
- [ ] Antes de iniciar: `GET /r36s/saves/snes/<nome>.srm` → gravar no `savefile_directory` do FS (404 = sem save, seguir). Se o GET falhar por rede (não 404), **não iniciar** e mostrar erro (spec: não sobrescrever progresso).
- [ ] `retroarch.cfg` web derivado do real: mesmos hotkeys (Select = hotkey enable, Start = sair), `autosave_interval = 10`, `savefile_directory`/`savestate_directory` fixos, mapeamento de teclado igual ao do ES (setas, Enter=A, Esc=B, F1=Start, F2=Select; X/Y/L/R em teclas razoáveis — anotar quais).
- [ ] Sincronização: a cada 2 s comparar o `.srm` do FS (tamanho+hash rápido); mudou → `PUT`. Na saída do RetroArch, `PUT` final e então `parent.postMessage({type:"r36s-exit"}, "*")` (origem = mesma). Falha no PUT: retentar com backoff e guardar cópia no IndexedDB para reenvio (spec, seção Erros).
- [ ] Testável sozinho abrindo `play.html?...` direto. Commit.

### Task 4: Ponte ES ↔ RetroArch
- [ ] `src/es` (branch `web`): em `runSystemCommand` sob `_WEB_`, reconhecer o comando real do dArkOS: extrair núcleo de `-L .../cores/<core>_libretro.so` e a ROM (último argumento antes de `; sudo perfnorm`), desescapar; chamar `EM_ASYNC_JS web_launch(system, core, rom)` que faz `return await Module.webLaunch({...})` (código de saída). Manter `renderGameLoadingScreen`. Depois de voltar: limpar eventos SDL pendentes (`SDL_FlushEvents`) para teclas do jogo não vazarem no ES. Pausar/retomar o áudio do ES (contexto de áudio do SDL) durante o jogo.
- [ ] `web/bridge.js` + `index.html`: `Module.webLaunch` cria o iframe em tela cheia, foca nele, resolve quando chega `r36s-exit` (ou quando o iframe falha ao carregar → resolve com erro e o ES mostra a lista de novo). Remover o iframe e devolver o foco ao canvas do ES.
- [ ] Foco robusto no ES: ao clicar em qualquer lugar da página e ao carregar, focar o canvas (bug relatado: setas não respondiam antes de clicar).
- [ ] Rebuild do ES, exportar patches para `patches/es/`, commit.

### Task 5: Teste de ponta a ponta + gate
- [ ] `tests/e2e_snes.mjs` (playwright headless, swiftshader): abre o ES, Enter no sistema, navega até DK2, Enter; espera o iframe; após ~15 s, screenshot do jogo (deve haver pixels não pretos no canvas do iframe); pressiona teclas por alguns segundos; envia Select+Start; verifica que o iframe sumiu e o ES voltou (screenshot da lista); verifica no servidor que nada quebrou (`GET` do save do DK3 continua igual ao semeado).
- [ ] Teste extra: abrir DK3 e conferir que o save semeado carregou (screenshot do menu de arquivos do jogo mostrando progresso) — se não der para automatizar, deixar a screenshot para o andre conferir.
- [ ] Mostrar ao andre: screenshots + como testar (`localhost:8770/r36s/`, teclas). Sem push/deploy.
