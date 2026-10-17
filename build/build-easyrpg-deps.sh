#!/usr/bin/env bash
# Dependências do núcleo EasyRPG (libretro) para emscripten, num prefixo próprio (build/cores/easyrpg-prefix):
# pixman 0.40 (autotools, espelho aseprite/pixman), fmt 11.1.4, inih r58 (um .c), liblcf (sem ICU/XML: só windows-1252).
# zlib e libpng vêm das ports do emscripten (embuilder). Chamado por build/build-core.sh easyrpg.
set -euo pipefail
R=/home/andre/Workspace/web-ports/r36s
B="$R/build/cores"; D="$B/easyrpg-deps"; P="$B/easyrpg-prefix"
JOBS="${JOBS:-12}"
mkdir -p "$D" "$P/lib" "$P/include"
clone() { [ -d "$D/$2/.git" ] || GIT_TERMINAL_PROMPT=0 git clone -q --depth 1 --branch "$3" "$1" "$D/$2"; }
clone https://github.com/aseprite/pixman.git pixman pixman-0.40.0
clone https://github.com/fmtlib/fmt.git fmt 11.1.4
clone https://github.com/benhoyt/inih.git inih r58
clone https://github.com/nlohmann/json.git json v3.11.3   # o CMake do Player exige no emscripten
[ -d "$B/liblcf/.git" ] || git clone -q https://github.com/EasyRPG/liblcf.git "$B/liblcf"
git -C "$B/liblcf" checkout -q 6854310c3432e553fd4ae672ce861899c80c3bd0
embuilder build zlib libpng >/dev/null
SYS="$(em-config CACHE)/sysroot"
export CFLAGS="-O2 -g0 -Wno-incompatible-function-pointer-types" CXXFLAGS="-O2 -g0"   # pixman 0.40 x clang novo (const float x float: mesma assinatura no wasm)

if [ ! -f "$P/lib/libpixman-1.a" ]; then
  ( cd "$D/pixman" && NOCONFIGURE=1 ./autogen.sh >/dev/null &&
    emconfigure ./configure --prefix="$P" --host=wasm32-unknown-emscripten --disable-shared --enable-static \
      --disable-openmp --disable-loongson-mmi --disable-mmx --disable-sse2 --disable-ssse3 --disable-vmx --disable-arm-simd \
      --disable-arm-neon --disable-arm-iwmmxt --disable-mips-dspr2 --disable-gtk --disable-libpng --disable-timers >/dev/null &&
    emmake make -C pixman -j"$JOBS" install >/dev/null && emmake make install-pkgconfigDATA >/dev/null )
fi
if [ ! -f "$P/lib/libfmt.a" ]; then
  emcmake cmake -S "$D/fmt" -B "$D/fmt/b" -DCMAKE_INSTALL_PREFIX="$P" -DCMAKE_BUILD_TYPE=Release -DFMT_TEST=OFF -DFMT_DOC=OFF >/dev/null
  cmake --build "$D/fmt/b" -j"$JOBS" >/dev/null && cmake --install "$D/fmt/b" >/dev/null
fi
if [ ! -f "$P/lib/libinih.a" ]; then
  emcc -O2 -c "$D/inih/ini.c" -o "$D/inih/ini.o" && emar rcs "$P/lib/libinih.a" "$D/inih/ini.o" && cp "$D/inih/ini.h" "$P/include/"
fi
if [ ! -d "$P/share/cmake/nlohmann_json" ]; then
  emcmake cmake -S "$D/json" -B "$D/json/b" -DCMAKE_INSTALL_PREFIX="$P" -DJSON_BuildTests=OFF >/dev/null && cmake --install "$D/json/b" >/dev/null
fi
if [ ! -f "$P/lib/liblcf.a" ]; then
  emcmake cmake -S "$B/liblcf" -B "$B/liblcf/b" -DCMAKE_INSTALL_PREFIX="$P" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
    -DLIBLCF_WITH_ICU=OFF -DLIBLCF_WITH_XML=OFF -DLIBLCF_ENABLE_TOOLS=OFF -DLIBLCF_ENABLE_TESTS=OFF -DLIBLCF_UPDATE_MIMEDB=OFF \
    -DCMAKE_FIND_ROOT_PATH="$P" -DCMAKE_PREFIX_PATH="$P" >/dev/null
  cmake --build "$B/liblcf/b" -j"$JOBS" >/dev/null && cmake --install "$B/liblcf/b" >/dev/null
fi
ls "$P/lib"
