# R36S no navegador — design

Data: 2026-10-16 · Projeto: `~/Workspace/web-ports/r36s/` · Servido em hub `/r36s/` (porta 8770)

## Objetivo

Reproduzir no navegador, **o mais perto possível do original**, a experiência do R36S com
dArkOS: o EmulationStation com o tema EPIC-CODY e os gamelists do cartão de 64 GB, abrindo
jogos no RetroArch com os mesmos núcleos/configs. Jogável no PC (teclado/gamepad) e no
celular (controle virtual na tela), com saves guardados no servidor e compartilhados entre
aparelhos.

Não é emular o sistema operacional: as duas camadas de software (ES e RetroArch) rodam
compiladas para WASM, sem Linux por baixo.

## Decisões tomadas

| tema | decisão |
|---|---|
| abordagem | **A**: ES-fcamod original → WASM + RetroArch emscripten oficial |
| aparelhos | PC e celular (Galaxy A54), acesso via Tailscale |
| acervo | conteúdo do cartão de 64 GB (dArkOS RE, ~6.900 jogos) |
| saves | no servidor, compartilhados; sincronizar com o cartão físico fica para fase 2 |

## Estrutura

```
~/Workspace/web-ports/r36s/
  build/   scripts de build (ES → WASM; download/empacotamento do RetroArch)
  src/     fontes do ES-fcamod + patches emscripten
  card ->  symlink para o conteúdo extraído no external (não cabe no /home: 60 GB livres)
  saves/   saves do servidor: <sistema>/<jogo>.srm|.state (+ .bak da versão anterior)
  web/     o site (index.html, es.wasm, retroarch/, overlay, bridge.js)
  docs/
```

## Fonte do acervo

`external/handhelds/r36s-64gb-darkosre/r36s-64gb-darkosre-20261002.img.zst` (47 GB
comprimido, 62,5 GB cru). Descomprimir **no external** (107 GB livres), montar as partições
em loop somente-leitura (precisa de `sudo` — o andre roda) e usar como `card/`:

- partição de ROMs → `/roms` (roms, `gamelist.xml`, capas, `themes/`, `bios/`)
- ROOTFS → copiar só `es_systems.cfg`, `es_settings.cfg`, `retroarch.cfg` (e o 32) e os
  overrides por núcleo para `card/config/`

Montagem em loop sobrevive só até o reboot; o plano define se vira unit de mount ou cópia
das ROMs para uma pasta no external.

## Componentes

### 1. ES-fcamod em WASM (`web/es.*`)
- Fonte: `christianhaitian/EmulationStation-fcamod` (o commit que o dArkOS usa, se
  identificável pelo binário do ROOTFS; senão `master`).
- Emscripten (`tools/emsdk`): SDL2, SDL2_mixer, FreeType pelos ports; FreeImage compilado;
  RapidJSON header-only; **GLES2 → WebGL2**.
- Stubs: curl (scraper/updates → "indisponível"), VLC (vídeo de prévia desligado), ALSA
  (volume → no-op), comandos de sistema (wifi, desligar, etc. → no-op ou menu oculto).
- Sistema de arquivos: o servidor gera um **manifesto** (árvore com tamanhos) de `card/`.
  O ES vê essa árvore inteira; `themes/`, `gamelist.xml` e configs são baixados no início
  (cacheados no navegador); capas são buscadas sob demanda; as ROMs aparecem como arquivos
  mas o ES nunca as lê (só lista).
- Lançamento: o `system()` usado para rodar o comando do `es_systems.cfg` é trocado por uma
  chamada JS `bridge.launch({system, core, rom})`, e o ES pausa até `bridge` avisar o fim.

### 2. RetroArch em WASM (`web/retroarch/`)
- Base: bundle nightly do buildbot libretro (`nightly/emscripten/<data>_RetroArch.7z`),
  um `.js/.wasm` por núcleo. Compilar do fonte só se faltar núcleo ou precisar de patch.
- Roda num **iframe criado por jogo** (heap/canvas próprios; remover libera memória).
- Recebe núcleo, ROM (buscada do servidor para o FS dele), `retroarch.cfg` do cartão
  (ajustado: caminhos, `autosave_interval = 10`, driver de vídeo/áudio web).
- Mapa sistema → núcleo vem do `es_systems.cfg` do cartão. Núcleo que só existe para ARM
  (ex.: DraStic) é trocado pelo equivalente libretro mais próximo; sistema sem nenhum
  núcleo web (provável: PSP) mostra "não suportado no navegador" em vez de abrir.

### 3. Ponte (`web/bridge.js`)
- `launch()`: esconde o canvas do ES, baixa o save do servidor, cria o iframe, injeta
  ROM + save + cfg no FS do RetroArch, inicia.
- Saída do jogo (Quit no menu do RetroArch ou fechar): envia saves, remove o iframe,
  devolve foco ao ES na mesma posição.
- Saves: no início `GET /r36s/saves/...`; durante o jogo, a cada gravação do `.srm`
  (detectada no FS) e na saída, `PUT`. Save state idem quando criado.

### 4. Controle (`web/input.js` + overlay)
- PC: teclado e Gamepad API mapeados para o mesmo layout do R36S (D-pad, A/B/X/Y, L1/L2/
  R1/R2, Select/Start, analógicos).
- Celular: overlay HTML com o layout do R36S (paisagem; retrato mostra a tela em cima e
  os botões embaixo), gerando os mesmos eventos de tecla para ES e RetroArch. Aparece só
  em toque.
- Atalhos do dArkOS mantidos (Select+Start sai do jogo; hotkey do menu do RetroArch).

### 5. Servidor (`hub.py`)
- Site `r36s` no padrão `<nome>/web`, mais rotas:
  - `GET /r36s/manifest.json` — árvore de `card/` (gerada e cacheada; refaz se mudar).
  - `GET /r36s/fs/<caminho>` — arquivos do cartão (Range já suportado).
  - `GET|PUT /r36s/saves/<sistema>/<arquivo>` — PUT grava atômico (tmp+rename) e mantém
    o anterior como `.bak`. Nome/caminho validados (sem `..`, só dentro de `saves/`).
- COOP/COEP já existentes (necessários para threads).
- Acesso externo: `tailscale serve` HTTPS → `localhost:8770` (contexto seguro: Gamepad
  API e SharedArrayBuffer no celular).

## Erros

- Núcleo/sistema não suportado → aviso no estilo do ES, volta para a lista.
- Falha ao baixar ROM/save → aviso e volta; nunca inicia o jogo com save vazio
  silenciosamente se o servidor tinha um save (evita sobrescrever progresso).
- Falha no PUT do save → retenta com backoff e mostra indicador "save não enviado" até
  conseguir; na saída, se ainda falhar, guarda cópia no IndexedDB e reenvia na próxima
  abertura.
- Conflito PC × celular: último que grava vence; o `.bak` guarda a versão anterior.

## Testes

- Headless local (playwright-core + `/usr/bin/chromium --use-angle=swiftshader
  --enable-unsafe-swiftshader`), por etapa: screenshot do ES com tema; jogo SNES rodando
  N frames; ida e volta de save (PUT → nova sessão → GET igual); ponte ES→jogo→ES.
- Servidor: testes das rotas de save (atômico, `.bak`, rejeição de caminho inválido).
- Depois, o andre testa no Chrome do Mac (túnel) e no A54 (Tailscale) — nada é dado como
  pronto antes disso.

## Etapas (cada uma entregável e testável)

1. **Prova do ES** — ES-fcamod abre no navegador com EPIC-CODY e um sistema listado.
   Ponto de abandono: se inviável, cair para a abordagem B (menu HTML) sem perder o resto.
2. **RetroArch + saves** — jogo SNES do cartão rodando no iframe, save ida e volta.
3. **Ponte + acervo completo** — escolher jogo no ES abre o RetroArch e volta; todos os
   sistemas mapeados para núcleo ou marcados como não suportados.
4. **Celular** — overlay de toque, layout retrato/paisagem, `tailscale serve`, teste no A54.

## Fora de escopo (por ora)

- Sincronização automática com o cartão físico (fase 2).
- Scraper, vídeos de prévia, wifi/configs de sistema do dArkOS.
- Ports nativos ARM do dArkOS (`/roms/ports`) e PICO-8 oficial.
- Desempenho garantido em PSP/NDS/N64/Dreamcast — entram se o núcleo web rodar.
