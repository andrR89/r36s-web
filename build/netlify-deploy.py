#!/usr/bin/env python3
"""Publica uma pasta no Netlify pela API (deploy por digest): manda os sha1, sobe só o que o Netlify pedir.
O netlify-cli não instala no Node 26 (sharp). Só com ok do andre (docs/deploy.md).
  NETLIFY_TOKEN=... build/netlify-deploy.py <site_id> <pasta> "<título>"
"""
import hashlib, json, os, sys, time, urllib.error, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

site, root, title = sys.argv[1], sys.argv[2], sys.argv[3]
tok = os.environ["NETLIFY_TOKEN"]
API = "https://api.netlify.com/api/v1"

def req(method, url, body=None, ctype="application/json"):
    for attempt in range(5):
        r = urllib.request.Request(url, data=body, method=method,
                                   headers={"Authorization": "Bearer " + tok, "Content-Type": ctype})
        try:
            with urllib.request.urlopen(r, timeout=600) as resp:
                return json.loads(resp.read() or b"null")
        except urllib.error.HTTPError as e:
            msg = e.read()[:300]
            if e.code in (429, 500, 502, 503) and attempt < 4:
                time.sleep(5 * (attempt + 1)); continue
            raise SystemExit(f"{method} {url} -> {e.code} {msg}")

files, paths = {}, {}
for d, _, names in os.walk(root):
    for n in names:
        p = os.path.join(d, n)
        rel = "/" + os.path.relpath(p, root).replace(os.sep, "/")
        h = hashlib.sha1(open(p, "rb").read()).hexdigest()
        files[rel] = h; paths.setdefault(h, p)

dep = req("POST", f"{API}/sites/{site}/deploys", json.dumps({"files": files, "title": title}).encode())
need = dep.get("required") or []
print(f"deploy {dep['id']}: {len(files)} arquivos, {len(need)} para subir", flush=True)
by_hash = {}
for rel, h in files.items(): by_hash.setdefault(h, rel)

def up(h):
    rel = by_hash[h]
    req("PUT", f"{API}/deploys/{dep['id']}/files{urllib.parse.quote(rel)}", open(paths[h], "rb").read(),
        "application/octet-stream")
    return rel

with ThreadPoolExecutor(6) as ex:
    for i, rel in enumerate(ex.map(up, need), 1):
        if i % 25 == 0 or i == len(need): print(f"  {i}/{len(need)} {rel}", flush=True)

for _ in range(120):
    st = req("GET", f"{API}/deploys/{dep['id']}")
    if st["state"] in ("ready", "error"): break
    time.sleep(5)
print("estado:", st["state"], st.get("error_message") or "", st.get("ssl_url"))
