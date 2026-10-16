#!/usr/bin/env bash
# Núcleo libretro que o buildbot não publica para a web: compila o núcleo (platform=emscripten, .a estático) e liga com
# o RetroArch emscripten do mesmo commit do nightly usado (build/get-retroarch.sh), no mesmo formato
# (<núcleo>_libretro.{js,wasm}, módulo ES6) que o play.js carrega. Ver docs/port-notes.md, seção "Núcleos próprios".
# Uso: bash build/build-core.sh <núcleo>      (fontes em build/cores/<núcleo>, clonadas no commit fixo abaixo + o patch
# patches/cores/<núcleo>.patch; árvore do RetroArch em build/cores/retroarch; saída também em build/cores/out/)
# Rodar dentro de: systemd-run --user --scope -p MemoryMax=12G bash build/build-core.sh <núcleo>
set -euo pipefail
R=/home/andre/Workspace/web-ports/r36s
B="$R/build/cores"
RA_COMMIT=05006426cfec12b1bd34c2e19c3bdfbad25bb3ea   # RetroArch master em 2026-10-14 22:00 UTC (nightly 2026-10-15)
EMSDK="${EMSDK_DIR:-/home/andre/Workspace/web-ports/tools/emsdk-3.1.74}"   # versão do build do EmulatorJS
JOBS="${JOBS:-12}"
name="$1"
# shellcheck disable=SC1091
source "$EMSDK/emsdk_env.sh" >/dev/null 2>&1

# por núcleo: repositório, commit, makefile, pasta do makefile, args do RetroArch (do dist-scripts/dist-cores.sh do RetroArch)
RA_ARGS=""; dir=.; args=""
case "$name" in
  mupen64plus_next)   # GLideN64 (GLES3/WebGL2), interpretador, libco por fibras do emscripten (exige ASYNCIFY)
    repo=https://github.com/libretro/mupen64plus-libretro-nx.git; commit=12edd2c74a517ff86dfa8cfc71ad75e4c10486d5; mk=Makefile
    RA_ARGS="ASYNC=1 HAVE_OPENGLES3=1 STACK_SIZE=134217728 INITIAL_HEAP=268435456" ;;
  melonds)   # bloco emscripten do fork EmulatorJS/melonDS (renderizador por software, sem threads/wifi)
    repo=https://github.com/libretro/melonds.git; commit=66b5d2634cd0a79030562811e6e05f5532f800ba; mk=Makefile
    RA_ARGS="INITIAL_HEAP=268435456" ;;
  picodrive)
    repo=https://github.com/libretro/picodrive.git; commit=1890c2932234c9d30f4cd3851d02228baae8f09e; mk=Makefile.libretro ;;
  prosystem)
    repo=https://github.com/libretro/prosystem-libretro.git; commit=8a88014287c7a01cd568067e5a557d0a2b2a051f; mk=Makefile ;;
  *) echo "núcleo desconhecido: $name" >&2; exit 2 ;;
esac
src="$B/$name"
if [ ! -d "$src/.git" ]; then
  git clone -q "$repo" "$src"
  git -C "$src" checkout -q "$commit"
  git -C "$src" submodule update -q --init --recursive
  [ -f "$R/patches/cores/$name.patch" ] && git -C "$src" apply "$R/patches/cores/$name.patch"
fi

[ -d "$B/retroarch/.git" ] || { git clone -q https://github.com/libretro/RetroArch.git "$B/retroarch"; }
git -C "$B/retroarch" checkout -q "$RA_COMMIT"

echo "== núcleo $name"
( cd "$src/$dir" && emmake make -j"$JOBS" -f "$mk" platform=emscripten $args )
lib=$(ls -t "$src/$dir"/*_libretro_emscripten.{bc,a} 2>/dev/null | head -1 || true)
[ -n "$lib" ] || { echo "sem .a/.bc do núcleo" >&2; exit 1; }
cp -f "$lib" "$B/retroarch/libretro_emscripten.a"

echo "== RetroArch + $name ($RA_ARGS)"
# objetos do RetroArch dependem das flags (ASYNC muda os DEFINES): limpa quando mudam
stamp="$B/retroarch/.flags"; [ "$(cat "$stamp" 2>/dev/null)" = "$RA_ARGS" ] || make -C "$B/retroarch" -f Makefile.emscripten clean >/dev/null
echo "$RA_ARGS" > "$stamp"
( cd "$B/retroarch" && rm -f "${name}_libretro.js" "${name}_libretro.wasm" &&
  emmake make -f Makefile.emscripten -j"$JOBS" LIBRETRO="$name" TARGET="${name}_libretro.js" $RA_ARGS )
mkdir -p "$R/build/cores/out"
cp -f "$B/retroarch/${name}_libretro."{js,wasm} "$R/build/cores/out/"
cp -f "$B/retroarch/${name}_libretro."{js,wasm} "$R/web/retroarch/"
ls -la "$R/web/retroarch/${name}_libretro."{js,wasm}
