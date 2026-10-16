#!/usr/bin/env bash
# Baixa o RetroArch web (nightly do buildbot) e extrai só os núcleos usados (os de web/data/cores.json, gerado por
# data/mkcores.py) para web/retroarch/. Uso: bash build/get-retroarch.sh [AAAA-MM-DD]   (padrão: a data testada abaixo)
set -euo pipefail
R=/home/andre/Workspace/web-ports/r36s
DATE="${1:-2026-10-15}"
CORES=$(python3 -I -c 'import json,sys; print(" ".join(sorted({c for s in json.load(open(sys.argv[1]))["systems"].values() for c in s["cores"]})))' "$R/web/data/cores.json")
DL="$R/build/retroarch-dl"
ARCHIVE="$DL/${DATE}_RetroArch.7z"
mkdir -p "$DL" "$R/web/retroarch"
[ -f "$ARCHIVE" ] || curl -sSfL -o "$ARCHIVE" "https://buildbot.libretro.com/nightly/emscripten/${DATE}_RetroArch.7z"
X="$DL/x-$DATE"; rm -rf "$X"; mkdir -p "$X"
files=(); for c in $CORES; do files+=("retroarch/${c}_libretro.js" "retroarch/${c}_libretro.wasm"); done
7z x -y -o"$X" "$ARCHIVE" "${files[@]}" >/dev/null
cp "$X"/retroarch/*_libretro.{js,wasm} "$R/web/retroarch/"
echo "$DATE" > "$R/web/retroarch/NIGHTLY"
echo "OK -> web/retroarch ($DATE: $CORES)"
