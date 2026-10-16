# Etapa 1 — Prova do ES (EmulationStation-fcamod em WASM) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O EmulationStation-fcamod (o do dArkOS) abre no navegador em `http://localhost:8770/r36s/`, com o tema EPIC-CODY, mostra o carrossel de sistemas e a lista de jogos de SNES, navegável pelo teclado.

**Architecture:** O ES compila com Emscripten 6.0.12 (`~/Workspace/web-ports/tools/emsdk`), rodando na thread principal com ASYNCIFY (o laço principal cede ao navegador a cada frame). Threads do ES viram execução síncrona; o renderer GLES1 roda sobre `LEGACY_GL_EMULATION`; FreeImage é trocado por stb_image; curl/VLC/ALSA viram stubs. O sistema de arquivos virtual nasce de um manifesto: arquivos "eager" (tema, cfgs, gamelists) chegam num pacote único; os "lazy" (capas) são buscados por `fetch` na primeira leitura; ROMs são arquivos vazios só para listagem.

**Tech Stack:** C++17, CMake + emcmake, Emscripten 6.0.12 (SDL2, SDL2_mixer, FreeType ports), stb_image, Python 3 (scripts de dados e testes), playwright-core + chromium headless (teste de fumaça).

**Spec:** `docs/superpowers/specs/2026-10-16-r36s-web-design.md`

## Convenções para quem executa

- **Shell do usuário é fish/zsh.** Todo comando abaixo roda com `bash -c '...'` ou num script `.sh` com `#!/usr/bin/env bash`. Nunca use `for x in $VAR` no shell interativo.
- **Builds pesados** rodam em `systemd-run --user --scope -p MemoryMax=12G -- <cmd>` (lição do NFS Carbon: o oomd mata o terminal).
- Fontes do ES ficam em `src/es` (clone, ignorado pelo git do projeto). Patches são commitados num branch `web` **dentro de `src/es`** e exportados para `patches/es/` no repo do projeto ao final de cada tarefa (`git -C src/es format-patch master -o ../../patches/es/`).
- Raiz do projeto: `R=/home/andre/Workspace/web-ports/r36s`. External: `X=/run/media/andre/external/handhelds`.
- Este é um port: erros de compilação não previstos vão aparecer. Regra: corrigir com `#ifdef __EMSCRIPTEN__` no ponto exato, nunca apagar funcionalidade fora do que está listado aqui; anotar cada correção extra em `docs/port-notes.md` (uma linha: arquivo, erro, correção).

## Estrutura de arquivos

```
r36s/
  build/
    env.sh              carrega emsdk + variáveis
    build-es.sh         configura e compila o ES → web/es.js/es.wasm
    stb/stb_image.h     vendorizado
  data/
    mksample.py         monta card-sample/ (tema, cfg, ROMs de amostra) a partir do external
    mkmanifest.py       gera web/data/manifest.json + web/data/eager.bin
  tests/
    test_mkmanifest.py  testes do gerador de manifesto/pacote
    smoke.mjs           abre a página headless, espera o ES, tira screenshot
  web/
    index.html          página: canvas + carga do manifesto + Module
    fsboot.js           monta o FS virtual a partir do manifesto/pacote
    fs -> ../card-sample   (symlink: arquivos lazy servidos pelo hub)
  card-sample/          dados de amostra (ignorado no git)
  patches/es/           patches exportados do src/es
  docs/port-notes.md
```

Paths dentro do FS virtual (iguais ao dArkOS):
- `/home/ark/.emulationstation/es_settings.cfg`, `/home/ark/.emulationstation/es_systems.cfg`
- `/roms/<sistema>/...` (ROMs, `gamelist.xml`, imagens)
- `/roms/themes/theme-EPIC-CODY/...` e `/etc/emulationstation/themes` → symlink para `/roms/themes`

---

### Task 1: Dados de amostra (`card-sample/`)

**Files:**
- Create: `data/mksample.py`
- Modify: `.gitignore` (adicionar `card-sample/`)

- [ ] **Step 1: Escrever `data/mksample.py`**

```python
#!/usr/bin/env python3
"""Monta card-sample/ com o mínimo para a prova do ES: tema EPIC-CODY, cfgs e SNES (20 jogos com capa)."""
import os, shutil, sys

X = "/run/media/andre/external/handhelds"
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(R, "card-sample")
N_GAMES = 20

ES_SYSTEMS = """<?xml version="1.0"?>
<systemList>
  <system>
    <name>snes</name>
    <fullname>Super Nintendo</fullname>
    <path>/roms/snes/</path>
    <extension>.7z .7Z .zip .ZIP .sfc .SFC .smc .SMC</extension>
    <command>web-launch snes snes9x %ROM%</command>
    <platform>snes</platform>
    <theme>snes</theme>
  </system>
</systemList>
"""

ES_SETTINGS = """<?xml version="1.0"?>
<config>
  <string name="ThemeSet" value="theme-EPIC-CODY" />
  <bool name="EnableSounds" value="true" />
  <bool name="SplashScreen" value="false" />
  <string name="TransitionStyle" value="slide" />
</config>
"""

def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

def main():
    if os.path.exists(OUT):
        shutil.rmtree(OUT)
    home = os.path.join(OUT, "home/ark/.emulationstation")
    os.makedirs(home)
    open(os.path.join(home, "es_systems.cfg"), "w").write(ES_SYSTEMS)
    open(os.path.join(home, "es_settings.cfg"), "w").write(ES_SETTINGS)

    theme_src = os.path.join(X, "essenciais-r36s/themes/theme-EPIC-CODY")
    if not os.path.isfile(os.path.join(theme_src, "theme.xml")):
        sys.exit(f"tema incompleto: falta {theme_src}/theme.xml")
    shutil.copytree(theme_src, os.path.join(OUT, "roms/themes/theme-EPIC-CODY"))

    snes_src = os.path.join(X, "packs-de-rom/pack-curado/snes")
    snes = os.path.join(OUT, "roms/snes")
    os.makedirs(os.path.join(snes, "images"))
    roms = sorted(f for f in os.listdir(snes_src) if f.lower().endswith((".7z", ".zip", ".sfc", ".smc")))[:N_GAMES]
    snap = os.path.join(snes_src, "snap")
    entries = []
    for rom in roms:
        # ROM vira arquivo vazio: o ES só lista, não lê
        open(os.path.join(snes, rom), "wb").close()
        stem = os.path.splitext(rom)[0]
        img = next((f for f in (os.listdir(snap) if os.path.isdir(snap) else []) if os.path.splitext(f)[0] == stem), None)
        line = f"\t<game>\n\t\t<path>./{esc(rom)}</path>\n\t\t<name>{esc(stem)}</name>\n"
        if img:
            shutil.copy(os.path.join(snap, img), os.path.join(snes, "images", img))
            line += f"\t\t<image>./images/{esc(img)}</image>\n"
        entries.append(line + "\t</game>\n")
    open(os.path.join(snes, "gamelist.xml"), "w").write('<?xml version="1.0"?>\n<gameList>\n' + "".join(entries) + "</gameList>\n")
    print(f"card-sample: {len(roms)} jogos snes, {sum(1 for e in entries if '<image>' in e)} com capa")

if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Rodar e conferir**

Run: `python3 -I data/mksample.py && test -f card-sample/roms/themes/theme-EPIC-CODY/theme.xml && find card-sample/roms/themes -type f | wc -l`
Expected: `card-sample: 20 jogos snes, N com capa` (N > 0) e contagem de arquivos do tema = 624.

- [ ] **Step 3: Commit**

```bash
printf 'card-sample/\n' >> .gitignore
git add .gitignore data/mksample.py && git commit -m "data: amostra do cartão para a prova do ES"
```

---

### Task 2: Manifesto + pacote eager (TDD)

**Files:**
- Create: `data/mkmanifest.py`
- Test: `tests/test_mkmanifest.py`

Formato (contrato usado pelo `fsboot.js` na Task 6):
- `manifest.json`: `{"dirs": ["/roms", ...], "files": {"/roms/snes/x.7z": {"size": 0, "kind": "empty"}, "/roms/themes/.../theme.xml": {"size": 1234, "kind": "eager", "off": 0}, "/roms/snes/images/x.png": {"size": 5678, "kind": "lazy", "url": "fs/roms/snes/images/x.png"}}, "symlinks": {"/etc/emulationstation/themes": "/roms/themes"}}`
- `eager.bin`: concatenação dos arquivos `eager`, cada um em `off`..`off+size`.
- Regras de classificação: tamanho 0 → `empty`; está sob `/roms/themes/`, sob `/home/`, ou se chama `gamelist.xml` → `eager`; ROM (extensão de ROM) → `empty` (tamanho no manifesto = tamanho real, conteúdo nunca servido); resto → `lazy`.

- [ ] **Step 1: Escrever o teste que falha**

```python
# tests/test_mkmanifest.py
import json, os, sys, tempfile, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "data"))
import mkmanifest

def touch(root, rel, data=b""):
    p = os.path.join(root, rel.lstrip("/"))
    os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, "wb").write(data)

class T(unittest.TestCase):
    def setUp(self):
        self.src = tempfile.mkdtemp(); self.out = tempfile.mkdtemp()
        touch(self.src, "/roms/themes/t/theme.xml", b"<theme/>")
        touch(self.src, "/home/ark/.emulationstation/es_settings.cfg", b"<config/>")
        touch(self.src, "/roms/snes/gamelist.xml", b"<gameList/>")
        touch(self.src, "/roms/snes/Jogo (USA).7z", b"ROMDATA")
        touch(self.src, "/roms/snes/images/Jogo (USA).png", b"PNG")
        mkmanifest.build(self.src, self.out)
        self.m = json.load(open(os.path.join(self.out, "manifest.json")))
        self.blob = open(os.path.join(self.out, "eager.bin"), "rb").read()

    def test_eager_files_are_in_blob(self):
        for path, data in [("/roms/themes/t/theme.xml", b"<theme/>"),
                           ("/home/ark/.emulationstation/es_settings.cfg", b"<config/>"),
                           ("/roms/snes/gamelist.xml", b"<gameList/>")]:
            f = self.m["files"][path]
            self.assertEqual(f["kind"], "eager")
            self.assertEqual(self.blob[f["off"]:f["off"] + f["size"]], data)

    def test_rom_is_empty_and_not_in_blob(self):
        f = self.m["files"]["/roms/snes/Jogo (USA).7z"]
        self.assertEqual(f["kind"], "empty")
        self.assertNotIn(b"ROMDATA", self.blob)

    def test_image_is_lazy_with_url(self):
        f = self.m["files"]["/roms/snes/images/Jogo (USA).png"]
        self.assertEqual(f["kind"], "lazy")
        self.assertEqual(f["size"], 3)
        self.assertEqual(f["url"], "fs/roms/snes/images/Jogo%20%28USA%29.png")

    def test_dirs_and_symlink(self):
        self.assertIn("/roms/snes/images", self.m["dirs"])
        self.assertEqual(self.m["symlinks"]["/etc/emulationstation/themes"], "/roms/themes")

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `python3 -m unittest tests/test_mkmanifest.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'mkmanifest'`

- [ ] **Step 3: Implementar `data/mkmanifest.py`**

```python
#!/usr/bin/env python3
"""Gera manifest.json + eager.bin a partir de uma árvore de cartão (card-sample/ ou card/)."""
import json, os, sys, urllib.parse

ROM_EXT = {".7z", ".zip", ".sfc", ".smc", ".nes", ".gb", ".gbc", ".gba", ".md", ".gen", ".bin",
           ".cue", ".chd", ".iso", ".pbp", ".n64", ".z64", ".v64", ".nds", ".pce", ".sms", ".gg",
           ".a26", ".a78", ".lnx", ".32x", ".cdi", ".gdi", ".p8", ".png8"}
SYMLINKS = {"/etc/emulationstation/themes": "/roms/themes"}

def classify(vpath, size):
    name = os.path.basename(vpath)
    if size == 0:
        return "empty"
    if vpath.startswith("/roms/themes/") or vpath.startswith("/home/") or name == "gamelist.xml":
        return "eager"
    if os.path.splitext(name)[1].lower() in ROM_EXT:
        return "empty"
    return "lazy"

def build(src, out):
    os.makedirs(out, exist_ok=True)
    dirs, files, off = [], {}, 0
    with open(os.path.join(out, "eager.bin"), "wb") as blob:
        for root, dnames, fnames in os.walk(src):
            dnames.sort(); fnames.sort()
            vroot = "/" + os.path.relpath(root, src).replace(os.sep, "/").lstrip(".").lstrip("/")
            if vroot != "/":
                dirs.append(vroot)
            for fn in fnames:
                real = os.path.join(root, fn)
                vpath = (vroot.rstrip("/") + "/" + fn)
                size = os.path.getsize(real)
                kind = classify(vpath, size)
                entry = {"size": size, "kind": kind}
                if kind == "eager":
                    entry["off"] = off
                    with open(real, "rb") as f:
                        blob.write(f.read())
                    off += size
                elif kind == "lazy":
                    entry["url"] = "fs" + urllib.parse.quote(vpath)
                files[vpath] = entry
    with open(os.path.join(out, "manifest.json"), "w") as f:
        json.dump({"dirs": dirs, "files": files, "symlinks": SYMLINKS}, f, ensure_ascii=False)
    return len(files), off

if __name__ == "__main__":
    n, size = build(sys.argv[1], sys.argv[2])
    print(f"{n} arquivos, eager.bin {size/1e6:.1f} MB")
```

- [ ] **Step 4: Rodar e ver passar**

Run: `python3 -m unittest tests/test_mkmanifest.py -v`
Expected: 4 testes `ok`.

- [ ] **Step 5: Gerar para a amostra**

Run: `python3 -I data/mkmanifest.py card-sample web/data && ln -sfn ../card-sample web/fs && ls -la web/data web/fs`
Expected: `NNN arquivos, eager.bin XX MB` (tema ~dezenas de MB), symlink `web/fs -> ../card-sample`.

- [ ] **Step 6: Commit**

```bash
printf 'web/data/\nweb/fs\n' >> .gitignore
git add .gitignore data/mkmanifest.py tests/test_mkmanifest.py && git commit -m "data: manifesto e pacote eager do FS virtual"
```

---

### Task 3: Ambiente de build e primeira configuração do CMake

**Files:**
- Create: `build/env.sh`, `build/build-es.sh`
- Create: `build/stb/stb_image.h` (download)

- [ ] **Step 1: `build/env.sh`**

```bash
#!/usr/bin/env bash
export R=/home/andre/Workspace/web-ports/r36s
export EMSDK_QUIET=1
source /home/andre/Workspace/web-ports/tools/emsdk/emsdk_env.sh >/dev/null
export ES_SRC="$R/src/es" ES_BUILD="$R/build/es-out"
```

- [ ] **Step 2: Baixar stb_image e criar o branch de trabalho**

```bash
bash -c 'cd /home/andre/Workspace/web-ports/r36s && mkdir -p build/stb && curl -sSfo build/stb/stb_image.h https://raw.githubusercontent.com/nothings/stb/master/stb_image.h && head -1 build/stb/stb_image.h && git -C src/es checkout -b web'
```
Expected: `/* stb_image - v2.30 ...` e `Switched to a new branch 'web'`.

- [ ] **Step 3: `build/build-es.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/env.sh"
mkdir -p "$ES_BUILD" "$R/web"
cd "$ES_BUILD"
emcmake cmake "$ES_SRC" -DCMAKE_BUILD_TYPE=Release -DWEB=ON -DGLES=ON \
  -DSTB_DIR="$R/build/stb" >/dev/null
systemd-run --user --scope -q -p MemoryMax=12G -- emmake make -j12 2>&1 | tee "$ES_BUILD/make.log" | grep -E "error|Error|warning: undefined" | head -60 || true
test -f "$ES_BUILD/emulationstation.js" && cp "$ES_BUILD"/emulationstation.{js,wasm} "$R/web/" && echo "OK -> web/emulationstation.{js,wasm}"
```

- [ ] **Step 4: Commit**

```bash
git add build/env.sh build/build-es.sh build/stb/stb_image.h && git commit -m "build: ambiente emscripten do ES"
```

---

### Task 4: CMake com opção `WEB` (dependências e flags)

**Files (em `src/es`):**
- Modify: `CMakeLists.txt` — bloco `if(WEB)` antes dos `find_package`
- Modify: `es-core/CMakeLists.txt`, `es-app/CMakeLists.txt` — tirar `HttpReq.cpp`/`VideoVlcComponent.cpp`/scrapers da lista quando `WEB`, e ajustar a saída para `emulationstation.js`

- [ ] **Step 1: Ler os três CMakeLists inteiros** (`CMakeLists.txt`, `es-core/CMakeLists.txt`, `es-app/CMakeLists.txt`) para localizar: a lista de `find_package`, as listas de fontes e o `add_executable`.

- [ ] **Step 2: No `CMakeLists.txt` raiz, logo após as linhas `option(...)`, inserir:**

```cmake
option(WEB "Emscripten/WebAssembly build" OFF)
if(WEB)
    set(GLES ON)
    add_definitions(-DUSE_OPENGLES_10 -D_WEB_ -DSTBI_ONLY_PNG -DSTBI_ONLY_JPEG -DSTBI_ONLY_GIF)
    set(WEB_PORTS "-sUSE_SDL=2 -sUSE_SDL_MIXER=2 -sSDL2_MIXER_FORMATS=[ogg,mp3,wav] -sUSE_FREETYPE=1")
    set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} ${WEB_PORTS}")
    set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} ${WEB_PORTS}")
    set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} ${WEB_PORTS} -sLEGACY_GL_EMULATION=1 -sGL_UNSAFE_OPTS=0 -sASYNCIFY=1 -sASYNCIFY_STACK_SIZE=1048576 -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=268435456 -sSTACK_SIZE=4194304 -sMODULARIZE=1 -sEXPORT_NAME=createES -sEXPORTED_RUNTIME_METHODS=[FS,callMain] -sINVOKE_RUN=0 -sFORCE_FILESYSTEM=1 -sENVIRONMENT=web -lidbfs.js")
    include_directories(${STB_DIR} ${CMAKE_SOURCE_DIR}/external/pugixml/src ${CMAKE_SOURCE_DIR}/external)
    set(CMAKE_EXECUTABLE_SUFFIX ".js")
    find_path(RAPIDJSON_INCLUDE_DIRS rapidjson/document.h PATHS /usr/include REQUIRED)
else()
```
e fechar com `endif(WEB)` **depois** do último `find_package` da plataforma, de modo que, com `WEB`, nenhum `find_package` (OpenGL, Freetype, FreeImage, SDL2, SDL2MIXER, CURL, VLC, RapidJSON, ALSA) rode. Nas listas de include/link (`COMMON_INCLUDE_DIRS`/`COMMON_LIBRARIES`), envolver `FreeImage`, `CURL`, `VLC`, `OPENGLES`, `ALSA`, `SDL2`, `SDLMIXER`, `FREETYPE` em `if(NOT WEB)`. RapidJSON é header-only: se `/usr/include/rapidjson` não existir, `curl` o release v1.1.0 para `build/rapidjson` e trocar o `PATHS`.

- [ ] **Step 3: Em `es-core/CMakeLists.txt`**, dentro de `if(WEB)`: `list(REMOVE_ITEM CORE_SOURCES ${CMAKE_CURRENT_SOURCE_DIR}/src/components/VideoVlcComponent.cpp ${CMAKE_CURRENT_SOURCE_DIR}/src/CECInput.cpp)` (e os `.h` correspondentes em `CORE_HEADERS`). `HttpReq.cpp` **fica**, mas compila contra o stub da Task 5.

- [ ] **Step 4: Em `es-app/CMakeLists.txt`**, dentro de `if(WEB)`: remover `ScraperCmdLine.cpp` e os arquivos de `src/scrapers/` das listas de fontes **somente se** não forem referenciados fora deles (checar com `grep -rn "ScraperCmdLine\|ThreadedScraper\|Scraper.h" es-app/src --include=*.cpp | grep -v scrapers/`). Se forem, mantê-los e deixá-los cair no stub de HttpReq.

- [ ] **Step 5: Configurar e ver os erros de compilação**

Run: `bash build/build-es.sh`
Expected: o cmake configura sem `find_package` falhando; a compilação **falha** com erros sobre `FreeImage.h`, `curl/curl.h`, `vlc/vlc.h`, `alsa/asoundlib.h`, `GLES/gl.h` — que são os alvos da Task 5.

- [ ] **Step 6: Commit (em src/es)**

```bash
git -C src/es commit -am "web: opção WEB no CMake (ports emscripten, sem find_package)"
```

---

### Task 5: Stubs e trocas de dependência

**Files (em `src/es`):**
- Modify: `es-core/src/ImageIO.cpp` — FreeImage → stb_image sob `_WEB_`
- Modify: `es-app/src/main.cpp` — `FreeImage_Initialise/DeInitialise` sob `#ifndef _WEB_`
- Modify: `es-core/src/HttpReq.cpp/.h` — sob `_WEB_`, `HttpReq` sempre termina em `REQ_IO_ERROR` com mensagem "sem rede no navegador"
- Modify: `es-app/src/VolumeControl.cpp` — sob `_WEB_`, volume guardado numa variável (0–100), sem ALSA
- Modify: `es-core/src/renderers/Renderer_GLES10.cpp` — includes `GLES/gl.h` → `<GL/gl.h>` do emscripten sob `_WEB_`; funções `glOrthof`/extensões ausentes mapeadas
- Modify: qualquer `#include <vlc/...>` remanescente sob `#ifndef _WEB_`

- [ ] **Step 1: ImageIO com stb_image.** Ler `es-core/src/ImageIO.cpp` inteiro. Sob `#ifdef _WEB_`, implementar as **mesmas funções públicas declaradas em `ImageIO.h`** (com as mesmas assinaturas) usando:

```cpp
#ifdef _WEB_
#define STB_IMAGE_IMPLEMENTATION
#include "stb_image.h"
// loadFromMemoryRGBA32: decodifica para RGBA 8 bits por canal, linha 0 = topo
unsigned char* ImageIO::loadFromMemoryRGBA32(const unsigned char* data, const size_t size, size_t& width, size_t& height, MaxSizeInfo* maxSize, Vector2i* baseSize, Vector2i* packedSize)
{
	int w = 0, h = 0, n = 0;
	unsigned char* px = stbi_load_from_memory(data, (int)size, &w, &h, &n, 4);
	if (!px) return nullptr;
	if (baseSize) *baseSize = Vector2i(w, h);
	if (packedSize) *packedSize = Vector2i(w, h);
	width = w; height = h;
	unsigned char* out = new unsigned char[w * h * 4];
	memcpy(out, px, w * h * 4);
	stbi_image_free(px);
	return out;
}
#else
// ... implementação FreeImage original intocada ...
#endif
```
Ajustar a assinatura acima para bater exatamente com a declaração real de `ImageIO.h` (o nome e parâmetros podem diferir no fcamod: copiar de lá). Se o original redimensiona quando `maxSize` estoura, sob `_WEB_` ignorar o redimensionamento (anotar em `docs/port-notes.md`). Para as demais funções que usam FreeImage (ex.: `getImageSize`, `flipPixelsVert`, `saveImage`), usar `stbi_info_from_memory`/`stbi_info` para tamanho, loop manual para flip, e retorno `false` em salvar.

- [ ] **Step 2: Compilar até não sobrar erro de include.** Rodar `bash build/build-es.sh`, corrigir cada erro restante de dependência (curl, vlc, alsa, GLES headers) com os stubs listados acima. Cada correção sob `#ifdef _WEB_`. Repetir até a compilação passar e falhar só no **link** (ou passar).

- [ ] **Step 3: Commit**

```bash
git -C src/es commit -am "web: stb_image no lugar de FreeImage; stubs de curl/vlc/alsa"
```

---

### Task 6: Laço principal, threads e lançamento

**Files (em `src/es`):**
- Modify: `es-app/src/main.cpp` — laço `while(running)` (linha ~594) e o laço de espera da linha ~82
- Modify: `es-core/src/utils/ThreadPool.cpp` — execução síncrona sob `_WEB_`
- Modify: `es-core/src/resources/TextureDataManager.cpp` — `TextureLoader` sem threads sob `_WEB_`
- Modify: `es-core/src/platform.cpp` — `runSystemCommand` sob `_WEB_`
- Modify: `es-core/src/resources/ResourceManager.cpp` — leitura lazy

- [ ] **Step 1: Ceder ao navegador em cada laço.** Em `main.cpp`, no fim do corpo de **cada** laço de eventos/render (`while(!exitLoop)` ~82 e `while(running)` ~594), inserir:

```cpp
#ifdef _WEB_
		emscripten_sleep(0);
#endif
```
com `#ifdef _WEB_\n#include <emscripten.h>\n#endif` no topo. Em `PowerSaver`, sob `_WEB_`, trocar `SDL_WaitEventTimeout` por `SDL_PollEvent` (o `ps_standby ? ... :` da linha ~601 passa a usar sempre `SDL_PollEvent`).

- [ ] **Step 2: ThreadPool síncrono.** Em `ThreadPool.cpp`, sob `#ifdef _WEB_`: o construtor não cria threads; `queueWorkItem(work)` chama `work()` imediatamente; `wait()` e `wait(work, delay)` chamam `work()` (se houver) e retornam. Destrutor sem `join`.

- [ ] **Step 3: TextureLoader síncrono.** Em `TextureDataManager.cpp` (construtor ~246–251 e destrutor ~263), sob `_WEB_`: não criar `mThreads`; no método que enfileira carga (`TextureLoader::load(...)`), chamar diretamente o carregamento do `TextureData` (o mesmo corpo que `threadProc` executa para um item) em vez de enfileirar.

- [ ] **Step 4: Leitura lazy no ResourceManager.** Em `ResourceManager::getFileData` (`ResourceManager.cpp:52`), antes de abrir o `ifstream`, sob `_WEB_`:

```cpp
#ifdef _WEB_
#include <emscripten.h>
EM_ASYNC_JS(int, web_fetch_lazy, (const char* path), {
	return await Module.fetchLazy(UTF8ToString(path));   // 1 = baixou agora, 0 = não é lazy/já estava
});
#endif
...
#ifdef _WEB_
	web_fetch_lazy(path.c_str());
#endif
```
(o `EM_ASYNC_JS` vai no escopo de arquivo, acima da função). `Module.fetchLazy` é implementado no `fsboot.js` (Task 7).

- [ ] **Step 5: Lançamento.** Em `platform.cpp:90`, `runSystemCommand`, sob `#ifdef _WEB_` no início da função:

```cpp
#ifdef _WEB_
	// "web-launch <sistema> <nucleo> <rom>" -> ponte JS (Etapa 3). Outros comandos (scripts do dArkOS) são ignorados.
	if (cmd_utf8.rfind("web-launch ", 0) == 0) {
		if (window) window->renderGameLoadingScreen();
		return EM_ASM_INT({ return Module.webLaunch ? 0 : 1; });
	}
	return 0;
#endif
```
Na Etapa 1 basta não travar: `webLaunch` ainda não existe e o ES só volta.

- [ ] **Step 6: Compilar e linkar**

Run: `bash build/build-es.sh`
Expected: `OK -> web/emulationstation.{js,wasm}`. Se o link falhar com símbolo GL ausente (ex.: `glOrthof`, `glDrawTex*`, `glGenFramebuffersOES`), implementar o mínimo sob `_WEB_` no `Renderer_GLES10.cpp` (ex.: `glOrthof` → `glOrtho`; `*OES` → versões sem sufixo) e anotar em `port-notes.md`.

- [ ] **Step 7: Commit**

```bash
git -C src/es commit -am "web: laço com asyncify, threads síncronas, leitura lazy e lançamento"
```

---

### Task 7: Página web e boot do FS

**Files:**
- Create: `web/index.html`, `web/fsboot.js`

- [ ] **Step 1: `web/fsboot.js`**

```js
// Monta o FS virtual do ES a partir de data/manifest.json + data/eager.bin (contrato: data/mkmanifest.py)
export async function bootFS(Module) {
  const [manifest, blob] = await Promise.all([
    fetch("data/manifest.json").then(r => r.json()),
    fetch("data/eager.bin").then(r => r.arrayBuffer()).then(b => new Uint8Array(b)),
  ]);
  const FS = Module.FS;
  const mkdirp = p => { let cur = ""; for (const part of p.split("/").filter(Boolean)) { cur += "/" + part; try { FS.mkdir(cur); } catch (e) {} } };
  for (const d of manifest.dirs) mkdirp(d);
  const lazy = new Map();
  for (const [path, f] of Object.entries(manifest.files)) {
    mkdirp(path.slice(0, path.lastIndexOf("/")));
    if (f.kind === "eager") FS.writeFile(path, blob.subarray(f.off, f.off + f.size));
    else { FS.writeFile(path, new Uint8Array(0)); if (f.kind === "lazy") lazy.set(path, f.url); }
  }
  for (const [link, target] of Object.entries(manifest.symlinks)) {
    mkdirp(link.slice(0, link.lastIndexOf("/")));
    try { FS.symlink(target, link); } catch (e) {}
  }
  // chamado pelo C++ (EM_ASYNC_JS web_fetch_lazy) antes de ler um arquivo
  Module.fetchLazy = async path => {
    const url = lazy.get(path);
    if (!url) return 0;
    lazy.delete(path);
    const r = await fetch(url);
    if (!r.ok) { console.warn("[r36s] lazy falhou", path, r.status); return 0; }
    FS.writeFile(path, new Uint8Array(await r.arrayBuffer()));
    return 1;
  };
  return { files: Object.keys(manifest.files).length, lazy: lazy.size };
}
```

- [ ] **Step 2: `web/index.html`**

```html
<!doctype html>
<html lang="pt-BR">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<title>R36S</title>
<style>
  html,body{margin:0;height:100%;background:#000;overflow:hidden}
  #screen{display:block;margin:auto;height:100%;aspect-ratio:4/3;max-width:100%;image-rendering:auto}
  #status{position:fixed;left:8px;bottom:8px;color:#888;font:12px system-ui}
</style>
<canvas id="screen" tabindex="0" oncontextmenu="event.preventDefault()"></canvas>
<div id="status">carregando…</div>
<script type="module">
  import createES from "./emulationstation.js";
  import { bootFS } from "./fsboot.js";
  const status = document.getElementById("status");
  const canvas = document.getElementById("screen");
  const Module = await createES({
    canvas,
    print: t => console.log("[es]", t),
    printErr: t => console.warn("[es]", t),
    locateFile: f => f,
  });
  const info = await bootFS(Module);
  status.textContent = `${info.files} arquivos (${info.lazy} sob demanda)`;
  Module.ENV.HOME = "/home/ark";
  window.r36s = { Module, ready: false };
  canvas.focus();
  // resolução do R36S: 640x480
  Module.callMain(["--resolution", "640", "480", "--home", "/home/ark"]);
  window.r36s.ready = true;
  setTimeout(() => status.remove(), 3000);
</script>
</html>
```
Se `emulationstation.js` não for ESM (`-sMODULARIZE=1` sem `-sEXPORT_ES6=1`), adicionar `-sEXPORT_ES6=1` aos linker flags da Task 4 e recompilar. Se `--home`/`--resolution` não existirem no fcamod, conferir os argumentos aceitos em `main.cpp` (`parseArgs`) e usar os equivalentes; `ENV` precisa estar em `EXPORTED_RUNTIME_METHODS` (adicionar `ENV` lá).

- [ ] **Step 3: Servir e abrir**

Run: `bash -c 'systemctl --user restart webports-hub; sleep 1; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8770/r36s/ http://localhost:8770/r36s/data/manifest.json http://localhost:8770/r36s/emulationstation.wasm'`
Expected: `200` três vezes. (O hub já serve `r36s/web` pelo padrão `<nome>/web`.)

- [ ] **Step 4: Commit**

```bash
git add web/index.html web/fsboot.js && git commit -m "web: página do ES e boot do FS virtual"
```

---

### Task 8: Teste de fumaça headless e iteração até o ES aparecer

**Files:**
- Create: `tests/smoke.mjs`
- Create/Modify: `docs/port-notes.md`

- [ ] **Step 1: `tests/smoke.mjs`**

```js
// node tests/smoke.mjs [url] [saida.png] — abre o ES headless, espera, navega e tira screenshots
import { chromium } from "/tmp/claude-1000/-home-andre-Workspace/1fd2c2ca-b792-4d98-9c37-e7def61314b7/scratchpad/pw/node_modules/playwright-core/index.mjs";
const url = process.argv[2] ?? "http://localhost:8770/r36s/";
const out = process.argv[3] ?? "/home/andre/Workspace/web-ports/r36s/tests/out";
import { mkdirSync } from "node:fs"; mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
const logs = [];
page.on("console", m => logs.push(m.text()));
page.on("pageerror", e => logs.push("PAGEERROR " + e.message));
await page.goto(url);
await page.waitForFunction(() => window.r36s?.ready, null, { timeout: 120000 });
await page.waitForTimeout(8000);
await page.screenshot({ path: `${out}/1-sistemas.png` });
await page.keyboard.press("Enter");          // entra no sistema (A = Enter no mapeamento padrão do ES)
await page.waitForTimeout(3000);
await page.screenshot({ path: `${out}/2-jogos.png` });
await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowDown");
await page.waitForTimeout(2000);
await page.screenshot({ path: `${out}/3-jogo-selecionado.png` });
// pixels não-pretos no canvas: prova de que algo foi desenhado
const lit = await page.evaluate(() => {
  const c = document.getElementById("screen"); const g = document.createElement("canvas");
  g.width = c.width; g.height = c.height; const x = g.getContext("2d"); x.drawImage(c, 0, 0);
  const d = x.getImageData(0, 0, g.width, g.height).data; let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] + d[i+1] + d[i+2] > 30) n++;
  return n / (d.length / 4);
});
const fatal = logs.filter(l => /abort|PAGEERROR|RuntimeError|Aborted/.test(l));
console.log(JSON.stringify({ lit: +lit.toFixed(3), fatal, tail: logs.slice(-25) }, null, 1));
await browser.close();
process.exit(fatal.length || lit < 0.05 ? 1 : 0);
```
Se o playwright do scratchpad antigo não existir mais: `bash -c 'mkdir -p /home/andre/Workspace/web-ports/tools/pw && cd /home/andre/Workspace/web-ports/tools/pw && npm i playwright-core@1.48.2'` e trocar o import para `/home/andre/Workspace/web-ports/tools/pw/node_modules/playwright-core/index.mjs`. A canvas precisa de `preserveDrawingBuffer` para o `drawImage` funcionar: se `lit` der 0 com a screenshot mostrando imagem, passar `webglContextAttributes: { preserveDrawingBuffer: true }` no `createES({...})`.

- [ ] **Step 2: Rodar**

Run: `node tests/smoke.mjs`
Expected (final): exit 0, `lit` > 0.05, `fatal: []`, e as três screenshots mostrando: (1) carrossel do EPIC-CODY com "Super Nintendo", (2) lista dos 20 jogos, (3) seleção movida duas posições com capa quando houver.

- [ ] **Step 3: Iterar.** Enquanto falhar, diagnosticar pelo `tail` do log e pelas screenshots (ex.: `es_systems.cfg file does not exist` → caminho/HOME; tela preta com GL error → função GL1 não emulada; travamento → laço sem `emscripten_sleep`; `Asyncify` "unreachable" → aumentar `ASYNCIFY_STACK_SIZE` ou listar o import em `ASYNCIFY_IMPORTS`). Cada correção: patch sob `_WEB_`, rebuild (`bash build/build-es.sh`), rerun. Registrar em `docs/port-notes.md`. **Critério de abandono:** se o renderer GLES1 sobre `LEGACY_GL_EMULATION` não desenhar texturas corretamente após corrigir funções ausentes, parar e reportar ao andre (próximo passo seria escrever um `Renderer_GLES20` com shaders — decisão dele).

- [ ] **Step 4: Exportar patches e commit**

```bash
bash -c 'cd /home/andre/Workspace/web-ports/r36s && rm -rf patches/es && git -C src/es format-patch -q master -o ../../patches/es/ && git add patches docs/port-notes.md tests/smoke.mjs && git commit -m "etapa 1: ES-fcamod abre no navegador com EPIC-CODY"'
```

---

### Task 9: Mostrar ao andre (gate da Etapa 1)

- [ ] **Step 1:** Enviar as três screenshots de `tests/out/` e os números do smoke (tempo até aparecer, tamanho do `.wasm` e do `eager.bin`).
- [ ] **Step 2:** Pedir que abra `http://localhost:8770/r36s/` no Chrome do Mac (túnel `ssh -fN webports`) e navegue com o teclado (setas, Enter = A, Backspace/Esc = B — confirmar o mapeamento real no `es_input.cfg` padrão).
- [ ] **Step 3:** Só com o ok dele seguir para o plano da Etapa 2 (RetroArch + saves). **Não** fazer deploy, push nem gastar créditos externos.

---

## Trabalho paralelo (independente desta etapa): extração do cartão de 64 GB

Precisa de `sudo` — o andre roda. Não bloqueia as Tasks 1–9 (que usam a amostra).

```bash
# 1. descomprimir no external (62,5 GB cru; 107 GB livres) — ~20-40 min
zstd -d "/run/media/andre/external/handhelds/r36s-64gb-darkosre/r36s-64gb-darkosre-20261002.img.zst" -o "/run/media/andre/external/handhelds/r36s-64gb-darkosre/r36s-64gb-darkosre-20261002.img"
# 2. associar loop somente-leitura com partições (andre):
sudo losetup -P -r --show -f "/run/media/andre/external/handhelds/r36s-64gb-darkosre/r36s-64gb-darkosre-20261002.img"
# 3. montar (andre), trocando loopN pelo que o passo 2 imprimiu:
sudo mkdir -p /mnt/r36s-rootfs /mnt/r36s-roms
sudo mount -o ro /dev/loopNp2 /mnt/r36s-rootfs
sudo mount -o ro,uid=1000 /dev/loopNp3 /mnt/r36s-roms
```
Depois: copiar `es_systems.cfg`, `es_settings.cfg`, `retroarch.cfg`, `retroarch32.cfg` e configs de núcleo do ROOTFS para `card-config/` no projeto, e anotar quais núcleos o `es_systems.cfg` usa por sistema (entrada do plano da Etapa 2).
