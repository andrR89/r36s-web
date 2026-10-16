#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/env.sh"
mkdir -p "$ES_BUILD" "$R/web"
# RapidJSON (header-only; v1.1.0 não compila com clang novo -> master)
if [ ! -f "$R/build/rapidjson/include/rapidjson/document.h" ]; then
  mkdir -p "$R/build/rapidjson"
  curl -sSfL https://github.com/Tencent/rapidjson/archive/refs/heads/master.tar.gz | tar -xz -C "$R/build/rapidjson" --strip-components=1 rapidjson-master/include
fi
cd "$ES_BUILD"
emcmake cmake "$ES_SRC" -DCMAKE_BUILD_TYPE=Release -DWEB=ON -DGLES=ON \
  -DSTB_DIR="$R/build/stb" -DRAPIDJSON_DIR="$R/build/rapidjson/include" >/dev/null
systemd-run --user --scope -q -p MemoryMax=12G -- emmake make -j12 2>&1 | tee "$ES_BUILD/make.log" | grep -E "error|Error|warning: undefined" | head -60 || true
test -f "$ES_BUILD/emulationstation.js" && cp "$ES_BUILD"/emulationstation.{js,wasm} "$R/web/" && echo "OK -> web/emulationstation.{js,wasm}"
