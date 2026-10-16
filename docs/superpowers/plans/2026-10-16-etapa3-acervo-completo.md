# Etapa 3 — Acervo completo do cartão de 64 GB (todos os sistemas)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development ou executing-plans.

**Goal:** O ES do navegador mostra o conteúdo real do cartão de 64 GB do dArkOS — todos os sistemas com jogos, com o tema **real** do cartão (`es-theme-farfenkugell_EPICMAX`) e o `es_settings.cfg` real — e qualquer jogo de sistema com núcleo web abre no RetroArch com o mesmo layout de teclado do SNES. Sistemas sem núcleo web mostram aviso e voltam pra lista.

**Spec:** `docs/superpowers/specs/2026-10-16-r36s-web-design.md`. Etapas anteriores: planos `2026-10-16-etapa1-*` e `2026-10-16-etapa2-*`, `docs/port-notes.md`.

## Fatos

- Cartão montado **somente leitura**: `/run/media/andre/ROOTFS` (sistema) e `/run/media/andre/EASYROMS` (46 GB, 138 entradas: pastas de sistemas, `themes/`, `bios/`, `BGM`, etc.). Nunca escrever lá. A montagem (udisks, loop) some no reboot — o hub deve responder erro claro se ela não existir, não quebrar.
- `ROOTFS/etc/emulationstation/es_systems.cfg`: 126 sistemas; comando padrão `... /usr/local/bin/%EMULATOR% -L /home/ark/.config/%EMULATOR%/cores/%CORE%_libretro.so %ROM% ...`; emuladores `retroarch`, `retroarch32` e não-libretro (mednafen, drastic, ppsspp, scripts de ports).
- `ROOTFS/home/ark/.emulationstation/es_settings.cfg`: `ThemeSet = es-theme-farfenkugell_EPICMAX`, `TransitionStyle = instant`.
- `ROOTFS/etc/emulationstation/es_input.cfg` é do aparelho; no navegador continuar usando o nosso de teclado (layout abaixo).
- `ROOTFS/home/ark/.config/retroarch/retroarch.cfg` + `config/<Core>/` (overrides por núcleo/jogo) + `retroarch-core-options.cfg`.
- BIOS em `EASYROMS/bios/`.
- RetroArch web: `https://buildbot.libretro.com/nightly/emscripten/RetroArch.7z` (ou com data); hoje só `snes9x` foi extraído (`build/get-retroarch.sh`).

## Layout de teclado (escolha do andre — vale para TODOS os sistemas e para o ES)

```
W A S D = direcional      L = A    K = B    J = Y    I = X    U = L    O = R
Enter = Start   Backspace = Select   Backspace+Enter = sair do jogo   Esc = menu do RetroArch
F5 / F7 = salvar / carregar estado
```
Já implementado em `web/retroarch/play.js` e `data/mksample.py` (es_input.cfg). Como o RetroArch mapeia teclado → RetroPad, cada núcleo herda o layout; **não** criar mapeamentos por sistema, exceto se um núcleo exigir (ex.: L2/R2/analógico em PS1 — mapear L2=Y? não: escolher teclas livres razoáveis, anotar e reportar ao andre).

## Tasks

### Task 1: Dados reais servidos sem cópia
- `card/` passa a ser a fonte: symlink `web/fs -> /run/media/andre/EASYROMS` (ou rota no hub) + arquivos de configuração copiados do ROOTFS para `card-config/` (es_systems.cfg, es_settings.cfg, retroarch.cfg, configs de núcleo). Não copiar os 46 GB.
- `data/mkmanifest.py`: suportar raiz montada em `/roms` a partir do EASYROMS + `card-config` em `/home/ark/.emulationstation` e `/etc/emulationstation`; eager = xml/fontes/svg do **tema ativo** (EPICMAX) + todos `gamelist.xml` + cfgs; resto lazy; ROMs `empty`. Medir: número de arquivos, tamanho do `manifest.json` e do `eager.bin`; se o manifesto passar de ~10 MB, comprimir (gzip servido pelo hub ou formato compacto) e anotar.
- O `es_input.cfg` de teclado e `resources/` do ES continuam vindo do nosso gerador.
- Testes do mkmanifest atualizados/estendidos (TDD) para os casos novos.

### Task 2: Mapa sistema → núcleo web
- Script `data/mkcores.py`: lê o `es_systems.cfg` real; para cada sistema com jogos no cartão, lista os núcleos na ordem do cfg; cruza com os núcleos disponíveis no bundle emscripten; escolhe o primeiro disponível (preferindo o padrão do dArkOS). Gera `web/data/cores.json` `{system: {core, fallbackFrom, bios: [...]}}` e um relatório `docs/cores-report.md` (sistema, jogos, núcleo do dArkOS, núcleo web escolhido ou "sem núcleo web").
- `build/get-retroarch.sh`: extrair todos os núcleos usados no `cores.json` (e não o bundle inteiro).
- A ponte (`runSystemCommand` + `bridge.js` + `play.js`) passa a usar o `cores.json`: se o núcleo do comando não existir na web, usar o mapeado; se o sistema não tiver núcleo web, a ponte resolve com erro e o ES mostra a lista de novo, com um aviso visível ("sistema sem emulador no navegador") — implementar o aviso no lado web (overlay HTML por 3 s) para não mexer no ES.
- Comandos não-libretro (scripts de ports, drastic, ppsspp standalone): mesmo tratamento ("sem emulador no navegador").

### Task 3: BIOS e configs por núcleo
- `play.js`: copiar para `system_directory` as BIOS de que o núcleo precisa (lista em `cores.json`, vinda dos `.info` do bundle ou de tabela conhecida), buscando em `fs/bios/...` sob demanda.
- Aplicar overrides do cartão (`config/<Core>/<Core>.cfg`/`.opt` e `retroarch-core-options.cfg`) quando existirem, **sem** sobrescrever o layout de teclado nem caminhos web.

### Task 4: Teste de ponta a ponta por sistema
- `tests/e2e_systems.mjs`: para uma amostra (snes, nes, gb, gbc, gba, megadrive, mastersystem, pcengine, psx, n64 e mais 3 a escolher entre os que têm núcleo), abrir o 1º jogo do sistema via ES (navegação por teclado ou injeção controlada documentada), esperar o jogo desenhar (pixels não pretos no iframe), sair com Backspace+Enter, conferir volta ao ES. Registrar tempos de carga e se roda em velocidade (FPS aproximado via rAF do iframe).
- Testar também um sistema sem núcleo web (aviso + volta).
- `tests/smoke.mjs`, `tests/e2e_snes.mjs` e os testes Python continuam passando (o SNES agora vem do cartão real; ajustar os testes que dependiam da amostra, mantendo-os significativos). O save semeado do DK3 deve ser preservado — se os testes mexerem nele, restaurar a partir do cartão ao final.

### Task 5: Mostrar ao andre
- Screenshots: tela de sistemas com EPICMAX, alguns jogos rodando, aviso de sistema sem núcleo. Tabela do `cores-report.md` resumida (quantos sistemas jogáveis / quantos jogos). Limitações. Sem push/deploy.
