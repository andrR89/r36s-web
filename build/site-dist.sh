#!/bin/bash
# Monta dist/ para publicar no Netlify (NÃO publica nada — ver docs/deploy.md):
#   site (web/site/, home em /site/, "/" redireciona) + ES (index.html, emulationstation.*) + RetroArch (play.* e os
#   núcleos que data/cores.json usa) + data/cores.json + modo demonstração (data/mkdemo.py).
# Fica de fora: ROMs, card/ (web/fs), o manifesto do cartão (web/data/manifest.json, eager.bin), saves/.
# Cabeçalhos em dist/_headers (MIME do wasm, COOP para o popup do Google, COOP+COEP só na aba isolada do PSP); o
# Netlify comprime (gzip/brotli) na hora.
#   build/site-dist.sh [dist]
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WEB=$ROOT/web
OUT=${1:-$ROOT/dist}

for f in emulationstation.js emulationstation.wasm data/cores.json; do
  [ -e "$WEB/$f" ] || { echo "falta web/$f (build do ES / data/mkcores.py)" >&2; exit 1; }
done
python3 "$ROOT/data/mkdemo.py" >/dev/null

rm -rf "$OUT"; mkdir -p "$OUT/data" "$OUT/retroarch"
cp -L "$WEB"/index.html "$WEB"/*.js "$WEB"/*.css "$WEB"/emulationstation.wasm "$OUT/"
cp -L "$WEB/data/cores.json" "$OUT/data/"
cp -L "$WEB"/retroarch/play.html "$WEB"/retroarch/play.js "$WEB"/retroarch/isolated.html "$WEB"/retroarch/isolated.js "$WEB"/retroarch/NIGHTLY "$OUT/retroarch/"
# núcleos: só os que o mapa sistema -> núcleo usa
python3 -I - "$WEB/data/cores.json" <<'PY' | while read -r core; do
import json, sys
d = json.load(open(sys.argv[1]))
print("\n".join(sorted({s["core"] for s in d["systems"].values() if s.get("core")})))
PY
  for ext in js wasm; do
    if [ -e "$WEB/retroarch/${core}_libretro.$ext" ]; then cp -L "$WEB/retroarch/${core}_libretro.$ext" "$OUT/retroarch/"
    else echo "aviso: núcleo $core sem ${core}_libretro.$ext (build/get-retroarch.sh)" >&2; fi
  done
done
# arquivos de apoio dos núcleos (cores.json "assets": PPSSPP em retroarch/assets/ppsspp, com index.json)
python3 -I - "$WEB/data/cores.json" <<'PY' | while read -r dir; do
import json, sys
d = json.load(open(sys.argv[1]))
print("\n".join(sorted({s["assets"]["url"] for s in d["systems"].values() if s.get("assets")})))
PY
  if [ -d "$WEB/retroarch/$dir" ]; then mkdir -p "$OUT/retroarch/$dir"; cp -rL "$WEB/retroarch/$dir/." "$OUT/retroarch/$dir/"
  else echo "aviso: falta web/retroarch/$dir (build/build-core.sh)" >&2; fi
done
# site + demo (sem o es-fundo do design, que só ilustrava o canvas)
mkdir -p "$OUT/site"
(cd "$WEB/site" && tar --exclude=img/es-fundo.png -chf - .) | (cd "$OUT/site" && tar -xf -)

cat > "$OUT/_headers" <<'H'
# Netlify. Site e ES sem COEP, que bloquearia o script do login do Google (accounts.google.com não manda CORP);
# COOP same-origin-allow-popups no site: o popup do Google fala com a página. O ES (/index.html) só abre num iframe do
# site (COOP não vale em iframe). Só a aba isolada do player (/retroarch/isolated.html: PSP, pthreads) é
# crossOriginIsolated (COOP same-origin + COEP require-corp): tudo nela é da mesma origem ou fetch/XHR CORS do Drive,
# que o require-corp aceita. O COOP fica fora do /* porque o Netlify junta valores de regras que casam no mesmo caminho.
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: gamepad=(self), fullscreen=(self), autoplay=(self)
/site/*
  Cross-Origin-Opener-Policy: same-origin-allow-popups
/retroarch/isolated.html
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
/retroarch/isolated
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
/*.wasm
  Content-Type: application/wasm
  Cache-Control: public, max-age=86400
/retroarch/*
  Cache-Control: public, max-age=86400
/site/img/*
  Cache-Control: public, max-age=604800
/site/fonts/*
  Cache-Control: public, max-age=31536000, immutable
H
cat > "$OUT/_redirects" <<'R'
# a home é o site; o ES fica em /index.html (aberto pelo site num iframe)
/   /site/   302!
R

echo "dist: $OUT"
du -sh "$OUT" | cut -f1 | sed 's/^/  total: /'
echo "  arquivos: $(find "$OUT" -type f | wc -l)"
# estimativa do que trafega comprimido (o Netlify comprime na hora)
python3 -I - "$OUT" <<'PY'
import os, sys, zlib
root = sys.argv[1]; raw = comp = 0
for d, _, fs in os.walk(root):
    for f in fs:
        if f.endswith((".js", ".wasm", ".css", ".html", ".json", ".xml", ".cfg")):
            b = open(os.path.join(d, f), "rb").read(); raw += len(b); comp += len(zlib.compress(b, 6))
print(f"  texto/wasm: {raw/1e6:.0f} MB, ~{comp/1e6:.0f} MB com gzip")
PY
