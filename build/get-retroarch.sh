#!/usr/bin/env bash
# Baixa o RetroArch web (nightly do buildbot) e extrai só os núcleos usados (os de web/data/cores.json, gerado por
# data/mkcores.py) para web/retroarch/. Núcleos "own" (que o buildbot não publica) vêm de build/build-core.sh: copiados
# de build/cores/out/ se já compilados. Uso: bash build/get-retroarch.sh [AAAA-MM-DD]   (padrão: a data testada abaixo)
set -euo pipefail
R=/home/andre/Workspace/web-ports/r36s
DATE="${1:-2026-10-15}"
CORES=$(python3 -I -c 'import json,sys; print(" ".join(sorted({c for s in json.load(open(sys.argv[1]))["systems"].values() for c in s["cores"] if not s.get("own")})))' "$R/web/data/cores.json")
OWN=$(python3 -I -c 'import json,sys; print(" ".join(sorted({c for s in json.load(open(sys.argv[1]))["systems"].values() for c in s["cores"] if s.get("own")})))' "$R/web/data/cores.json")
DL="$R/build/retroarch-dl"
ARCHIVE="$DL/${DATE}_RetroArch.7z"
mkdir -p "$DL" "$R/web/retroarch"
[ -f "$ARCHIVE" ] || curl -sSfL -o "$ARCHIVE" "https://buildbot.libretro.com/nightly/emscripten/${DATE}_RetroArch.7z"
X="$DL/x-$DATE"; rm -rf "$X"; mkdir -p "$X"
files=(); for c in $CORES; do files+=("retroarch/${c}_libretro.js" "retroarch/${c}_libretro.wasm"); done
7z x -y -o"$X" "$ARCHIVE" "${files[@]}" >/dev/null
cp "$X"/retroarch/*_libretro.{js,wasm} "$R/web/retroarch/"
for c in $OWN; do
  if [ -f "$R/build/cores/out/${c}_libretro.wasm" ]; then cp "$R/build/cores/out/${c}_libretro."{js,wasm} "$R/web/retroarch/"
  else echo "AVISO: $c não compilado: rode build/build-core.sh $c" >&2; fi
done
echo "$DATE" > "$R/web/retroarch/NIGHTLY"
echo "OK -> web/retroarch ($DATE: $CORES; compilados aqui: $OWN)"
