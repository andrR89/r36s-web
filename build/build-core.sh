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
  ppsspp)   # fork EmulatorJS/ppsspp (receita do EmulatorJS: ffmpeg wasm próprio, pthreads, WebGL2, ASYNCIFY)
    repo=https://github.com/EmulatorJS/ppsspp.git; commit=fa917ebd212e083912d742c830eecb242b6a98ae; mk=Makefile; dir=libretro
    custom=ppsspp
    RA_ARGS="ASYNC=1 HAVE_THREADS=1 PTHREAD_POOL_SIZE=32 HAVE_OPENGLES3=1 INITIAL_HEAP=536870912" ;;
  easyrpg)   # EasyRPG Player (PLAYER_TARGET_PLATFORM=libretro, CMake) + deps de build/build-easyrpg-deps.sh
    repo=https://github.com/EasyRPG/Player.git; commit=0de2a9ab466a133ac6e192a84bd761a1d81f5f14; custom=easyrpg
    RA_ARGS="INITIAL_HEAP=268435456" ;;
  *) echo "núcleo desconhecido: $name" >&2; exit 2 ;;
esac
src="$B/$name"
custom="${custom:-}"
if [ ! -d "$src/.git" ]; then
  git clone -q "$repo" "$src"
  git -C "$src" checkout -q "$commit"
  if [ "$custom" = ppsspp ]; then   # só os submódulos que o núcleo libretro usa (sem testes, MoltenVK, SDL do mac...)
    git -C "$src" submodule update -q --init --depth 1 libretro/libretro-common ffmpeg ext/armips ext/glslang ext/SPIRV-Cross \
      ext/discord-rpc ext/rapidjson ext/miniupnp ext/zstd ext/cpu_features ext/rcheevos ext/naett ext/libchdr ext/lua \
      ext/OpenXR-SDK ext/libadrenotools ext/freetype ext/nanosvg ext/aemu_postoffice
    # como libretro/emscripten/build_emscripten.sh do fork
    sed -i 's|return getauxval(hwcap_type);|return 1;|g; s|#include <sys/auxv.h>||g' "$src/ext/cpu_features/src/hwcaps.c"
    sed -i 's|#ifndef __linux__|#ifdef SO_NOSIGPIPE|g' "$src/ext/aemu_postoffice/client/sock_impl_linux.c"
    # libretro-common do submódulo é antigo: path_get_size devolve int32 e o do RetroArch int64 (assinatura errada = trap)
    sed -i 's/^int32_t path_get_size(const char \*path)/int64_t path_get_size(const char *path)/' \
      "$src/libretro/libretro-common/include/file/file_path.h" "$src/libretro/libretro-common/file/file_path_io.c"
    rm -rf "$src/ext/armips/ext/filesystem"; git clone -q --depth 1 https://github.com/gulrak/filesystem.git "$src/ext/armips/ext/filesystem"
  elif [ "$custom" = easyrpg ]; then
    git -C "$src" submodule update -q --init --depth 1 builds/libretro/libretro-common
  else
    git -C "$src" submodule update -q --init --recursive
  fi
  [ -f "$R/patches/cores/$name.patch" ] && git -C "$src" apply "$R/patches/cores/$name.patch"
fi
if [ "$custom" = ppsspp ] && [ ! -f "$src/ffmpeg/linux/wasm32/lib/libavcodec.a" ]; then
  ( cd "$src/ffmpeg" && cp ../libretro/emscripten/linux_wasm32.sh ./ && sed -i "s/-j\$(nproc)/-j$JOBS/" linux_wasm32.sh && bash linux_wasm32.sh )
fi

[ -d "$B/retroarch/.git" ] || { git clone -q https://github.com/libretro/RetroArch.git "$B/retroarch"; }
git -C "$B/retroarch" checkout -q "$RA_COMMIT"

echo "== núcleo $name"
if [ "$custom" = easyrpg ]; then
  bash "$R/build/build-easyrpg-deps.sh"
  # o Player trata __EMSCRIPTEN__ como "web player oficial" (Emscripten_Interface, async_handler baixando arquivos...);
  # no núcleo libretro isso vira EASYRPG_WEB_PLAYER (nunca definido): patches/cores/easyrpg.patch
  P="$B/easyrpg-prefix"; SYS="$(em-config CACHE)/sysroot"; L="$SYS/lib/wasm32-emscripten"
  off=""; for o in FREETYPE HARFBUZZ LHASA MPG123 LIBSNDFILE OGGVORBIS OPUS WILDMIDI FLUIDSYNTH FLUIDLITE XMP SPEEXDSP SAMPLERATE; do off="$off -DPLAYER_WITH_$o=OFF"; done
  PKG_CONFIG_PATH="$P/lib/pkgconfig" emcmake cmake -S "$src" -B "$src/b" -DCMAKE_BUILD_TYPE=Release -DPLAYER_TARGET_PLATFORM=libretro \
    -DBUILD_SHARED_LIBS=OFF -DCMAKE_PREFIX_PATH="$P" -DCMAKE_FIND_ROOT_PATH="$P;$SYS" \
    -DPNG_LIBRARY="$L/libpng.a" -DPNG_PNG_INCLUDE_DIR="$SYS/include" -DZLIB_LIBRARY="$L/libz.a" -DZLIB_INCLUDE_DIR="$SYS/include" \
    -DPIXMAN_INCLUDE_DIR="$P/include/pixman-1" -DPIXMAN_LIBRARY="$P/lib/libpixman-1.a" $off -DPLAYER_ENABLE_TESTS=OFF >/dev/null
  cmake --build "$src/b" -j"$JOBS"
  # núcleo + Player + dependências num .a só (o Makefile.emscripten liga um arquivo; zlib vem do RetroArch)
  lib="$src/b/easyrpg_merged.a"; rm -f "$lib"
  { echo "create $lib"
    for a in "$src/b/easyrpg_libretro.a" "$src/b/builds/libretro/libretro_common.a" \
             "$P/lib/liblcf.a" "$P/lib/libfmt.a" "$P/lib/libinih.a" "$P/lib/libpixman-1.a" "$L/libpng.a"; do
      [ -f "$a" ] && echo "addlib $a" || echo "AVISO: falta $a" >&2; done
    echo save; echo end; } | emar -M
else
  ( cd "$src/$dir" && emmake make -j"$JOBS" -f "$mk" platform=emscripten $args )
  lib=$(ls -t "$src/$dir"/*_libretro_emscripten.{bc,a} 2>/dev/null | head -1 || true)
fi
[ -n "$lib" ] || { echo "sem .a/.bc do núcleo" >&2; exit 1; }
if [ "$custom" = ppsspp ]; then   # núcleo + ffmpeg num .a só (o Makefile.emscripten liga um arquivo)
  rm -f "$B/retroarch/libretro_emscripten.a"
  { echo "create $B/retroarch/libretro_emscripten.a"; echo "addlib $lib"
    for l in avformat avcodec avutil swresample swscale; do echo "addlib $src/ffmpeg/linux/wasm32/lib/lib$l.a"; done
    echo save; echo end; } | emar -M
else
  cp -f "$lib" "$B/retroarch/libretro_emscripten.a"
fi

echo "== RetroArch + $name ($RA_ARGS)"
# objetos do RetroArch dependem das flags (ASYNC muda os DEFINES): limpa quando mudam
stamp="$B/retroarch/.flags"; [ "$(cat "$stamp" 2>/dev/null)" = "$RA_ARGS" ] || make -C "$B/retroarch" -f Makefile.emscripten clean >/dev/null
echo "$RA_ARGS" > "$stamp"
( cd "$B/retroarch" && rm -f "${name}_libretro.js" "${name}_libretro.wasm" &&
  emmake make -f Makefile.emscripten -j"$JOBS" LIBRETRO="$name" TARGET="${name}_libretro.js" $RA_ARGS )
mkdir -p "$R/build/cores/out"
for f in "$B/retroarch/${name}_libretro."{js,wasm} "$B/retroarch/${name}_libretro.worker.js"; do
  [ -f "$f" ] && cp -f "$f" "$R/build/cores/out/" && cp -f "$f" "$R/web/retroarch/"
done
if [ "$custom" = ppsspp ]; then   # assets do PPSSPP (fontes flash0, ppge_atlas, lang...): system_directory/PPSSPP, sob demanda
  A="$R/build/cores/out/assets/ppsspp"; rm -rf "$A"; mkdir -p "$A"; cp -r "$src/assets/." "$A/"
  python3 -I -c 'import json,os,sys; d=sys.argv[1]; print(json.dumps({os.path.relpath(os.path.join(r,f),d): os.path.getsize(os.path.join(r,f)) for r,_,fs in os.walk(d) for f in fs if f!="index.json"}))' "$A" > "$A/index.json"
  mkdir -p "$R/web/retroarch/assets"; rm -rf "$R/web/retroarch/assets/ppsspp"; cp -r "$A" "$R/web/retroarch/assets/ppsspp"
fi
ls -la "$R/web/retroarch/${name}_libretro."*
