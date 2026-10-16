#!/usr/bin/env bash
set -euo pipefail
# ES_LDFLAGS="--profiling-funcs -sASSERTIONS=1" bash build/build-es.sh   -> build de depuração (pilhas com nomes)
source "$(dirname "$0")/env.sh"
mkdir -p "$ES_BUILD" "$R/web"
# RapidJSON (header-only; v1.1.0 não compila com clang novo -> master)
if [ ! -f "$R/build/rapidjson/include/rapidjson/document.h" ]; then
  mkdir -p "$R/build/rapidjson"
  curl -sSfL https://github.com/Tencent/rapidjson/archive/refs/heads/master.tar.gz | tar -xz -C "$R/build/rapidjson" --strip-components=1 rapidjson-master/include
fi
cd "$ES_BUILD"
emcmake cmake "$ES_SRC" -DCMAKE_BUILD_TYPE=Release -DWEB=ON -DGLES=ON \
  -DSTB_DIR="$R/build/stb" -DRAPIDJSON_DIR="$R/build/rapidjson/include" \
  -DCMAKE_POLICY_VERSION_MINIMUM=3.5 -DCMAKE_EXE_LINKER_FLAGS="${ES_LDFLAGS:-}" > "$ES_BUILD/cmake.log" 2>&1 || { tail -30 "$ES_BUILD/cmake.log"; exit 1; }
st=0; systemd-run --user --scope -q -p MemoryMax=12G -- emmake make -j12 > "$ES_BUILD/make.log" 2>&1 || st=$?
grep -E "error|Error|warning: undefined" "$ES_BUILD/make.log" | head -60 || true
[ "$st" -eq 0 ] || { echo "make falhou ($st): web/ não foi atualizado"; exit "$st"; }
test -f "$ES_BUILD/emulationstation.js" && cp "$ES_BUILD"/emulationstation.{js,wasm} "$R/web/" && echo "OK -> web/emulationstation.{js,wasm}"
