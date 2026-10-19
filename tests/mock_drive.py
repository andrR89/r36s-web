#!/usr/bin/env python3
"""Mock local da API do Google Drive v3 — só o que web/drive.js usa — para testar o site sem o Google.

  python3 tests/mock_drive.py <porta> --library <pasta> [--index <pasta com manifest.json/eager.bin/info.json/library.json.gz>]
  python3 tests/mock_drive.py --lsjson <pasta> > lista.json     # listagem no formato `rclone lsjson -R --hash`

A <pasta> faz o papel de "R36S" no Drive (raiz do cartão de ROMs). IDs são estáveis (sha1 do caminho), os mesmos
nos dois modos — então `mkmanifest.py --drive-ids` com a lista gerada aqui casa com o que o servidor serve.

Usuários (pelo token Bearer), um por estado da tela de biblioteca:
  tok-shared — a pasta R36S do andre compartilhada com ele      tok-own  — uma pasta R36S própria
  tok-both   — as duas                                          tok-none — nenhuma
  tok-noindex — própria, sem R36S/.web (índice não gerado)
Endpoints: GET /drive/v3/about, GET /drive/v3/files?q=..., GET /drive/v3/files/<id>[?alt=media] (Range),
POST /drive/v3/files (pasta), POST /upload/drive/v3/files?uploadType=multipart, PATCH /upload/drive/v3/files/<id>.
Inspeção: GET /_mock/log (requisições), GET /_mock/saves (saves por usuário), POST /_mock/reset.
"""
import argparse, hashlib, http.server, json, os, re, sys, threading, urllib.parse

FOLDER = "application/vnd.google-apps.folder"
USERS = {
    "tok-shared": {"displayName": "Bia Teste", "emailAddress": "bia@example.com", "libs": ["shared"]},
    "tok-own": {"displayName": "Caio Teste", "emailAddress": "caio@example.com", "libs": ["own"]},
    "tok-both": {"displayName": "Duda Teste", "emailAddress": "duda@example.com", "libs": ["shared", "own"]},
    "tok-none": {"displayName": "Edu Teste", "emailAddress": "edu@example.com", "libs": []},
    "tok-noindex": {"displayName": "Fê Teste", "emailAddress": "fe@example.com", "libs": ["own-noindex"]},
}
ANDRE = {"displayName": "André Rogério", "emailAddress": "andre@example.com"}

def fid(*parts):
    return "f" + hashlib.sha1("/".join(parts).encode()).hexdigest()[:20]

def walk(root):
    """[(caminho relativo, é pasta, tamanho, caminho real)] seguindo symlinks, sem ocultos."""
    out = []
    for d, dnames, fnames in os.walk(root, followlinks=True):
        dnames[:] = sorted(x for x in dnames if not x.startswith("."))
        rel = os.path.relpath(d, root).replace(os.sep, "/")
        rel = "" if rel == "." else rel
        for x in dnames:
            out.append(((rel + "/" if rel else "") + x, True, 0, os.path.join(d, x)))
        for x in sorted(fnames):
            if x.startswith("."):
                continue
            p = os.path.join(d, x)
            out.append(((rel + "/" if rel else "") + x, False, os.path.getsize(p), p))
    return out

def lsjson(root):
    items = []
    for rel, isdir, size, real in walk(root):
        e = {"Path": rel, "Name": rel.rsplit("/", 1)[-1], "Size": -1 if isdir else size, "IsDir": isdir, "ID": fid("lib", rel),
             "MimeType": FOLDER if isdir else "application/octet-stream", "ModTime": "2026-10-16T12:00:00.000Z"}
        if not isdir:
            e["Hashes"] = {"md5": hashlib.md5(open(real, "rb").read()).hexdigest()}
        items.append(e)
    return items

class Store:
    def __init__(self, library, index):
        self.lock = threading.Lock()
        self.files = {}   # id -> dict(id, name, mimeType, parents, owner(user|"andre"), real|data, shared_with)
        self.log = []
        self.library, self.index = library, index
        self.reset()

    def add(self, id, name, mime, parents, owner, real=None, data=None, shared=()):
        self.files[id] = {"id": id, "name": name, "mimeType": mime, "parents": list(parents), "owner": owner, "real": real,
                          "data": data, "shared": set(shared), "revisions": 0, "modifiedTime": "2026-10-16T12:00:00.000Z"}

    def reset(self):
        with self.lock:
            self.files.clear(); self.log.clear()
            # pastas R36S: a do andre (compartilhada com tok-shared e tok-both) e uma própria por usuário
            roots = {"shared": fid("root", "andre")}
            self.add(roots["shared"], "R36S", FOLDER, ["root-andre"], "andre", shared={"tok-shared", "tok-both"})
            for tok, u in USERS.items():
                for kind in u["libs"]:
                    if kind.startswith("own"):
                        rid = fid("root", tok)
                        self.add(rid, "R36S", FOLDER, ["root-" + tok], tok)
                        roots[tok] = rid
                        if kind == "own-noindex":
                            roots.pop(tok); self.add(fid("lone", tok), "snes", FOLDER, [rid], tok)
            libroots = list(roots.values())
            # conteúdo da biblioteca: os mesmos arquivos em todas (um arquivo pode ter vários pais no mock)
            for rel, isdir, size, real in walk(self.library):
                parent = rel.rsplit("/", 1)[0] if "/" in rel else None
                parents = [fid("lib", parent)] if parent else libroots
                self.add(fid("lib", rel), rel.rsplit("/", 1)[-1], FOLDER if isdir else "application/octet-stream", parents, "andre",
                         real=None if isdir else real)
            if self.index:
                web = fid("web")
                self.add(web, ".web", FOLDER, libroots, "andre")
                for n in ("manifest.json", "eager.bin", "info.json", "library.json.gz"):
                    p = os.path.join(self.index, n)
                    if os.path.exists(p):
                        self.add(fid("web", n), n, "application/octet-stream", [web], "andre", real=p)

    def content(self, f):
        if f["data"] is not None:
            return f["data"]
        return open(f["real"], "rb").read()

    def size(self, f):
        return len(f["data"]) if f["data"] is not None else (os.path.getsize(f["real"]) if f["real"] else 0)

    def meta(self, f, tok):
        owner = {"displayName": USERS[f["owner"]]["displayName"], "emailAddress": USERS[f["owner"]]["emailAddress"]} \
            if f["owner"] in USERS else dict(ANDRE)
        owner["me"] = f["owner"] == tok
        m = {"id": f["id"], "name": f["name"], "mimeType": f["mimeType"], "modifiedTime": f["modifiedTime"], "owners": [owner],
             "parents": f["parents"]}
        if f["mimeType"] != FOLDER:
            m["size"] = str(self.size(f))
        return m

    def query(self, q, tok):
        terms = [t.strip() for t in re.split(r"\s+and\s+", q)]
        out = []
        for f in self.files.values():
            ok = True
            for t in terms:
                m = re.fullmatch(r"name\s*=\s*'((?:[^'\\]|\\.)*)'", t)
                if m:
                    ok = f["name"] == re.sub(r"\\(.)", r"\1", m.group(1))
                elif (m := re.fullmatch(r"mimeType\s*=\s*'([^']*)'", t)):
                    ok = f["mimeType"] == m.group(1)
                elif t == "trashed = false":
                    ok = True
                elif t == "'me' in owners":
                    ok = f["owner"] == tok
                elif t == "sharedWithMe = true":
                    ok = tok in f["shared"]
                elif (m := re.fullmatch(r"'([^']*)' in parents", t)):
                    pid = "root-" + tok if m.group(1) == "root" else m.group(1)
                    ok = pid in f["parents"]
                else:
                    raise ValueError("termo não suportado no mock: " + t)
                if not ok:
                    break
            # o que é de outro usuário (saves, pastas próprias) não aparece
            if ok and f["owner"] not in (tok, "andre"):
                ok = False
            if ok:
                out.append(f)
        return out

class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    store = None

    def log_message(self, *a):
        pass

    def cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Range, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS")
        self.send_header("Access-Control-Expose-Headers", "Content-Range, Content-Length")
        self.send_header("Cross-Origin-Resource-Policy", "cross-origin")

    def reply(self, code, body=b"", ctype="application/json", extra=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
        self.send_response(code)
        self.cors()
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def do_OPTIONS(self):
        self.reply(204)

    def token(self):
        a = self.headers.get("Authorization", "")
        t = a[7:] if a.startswith("Bearer ") else ""
        return t if t in USERS else None

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n else b""

    def route(self):
        u = urllib.parse.urlsplit(self.path)
        qs = dict(urllib.parse.parse_qsl(u.query))
        s = self.store
        if u.path == "/_mock/log":
            return self.reply(200, s.log)
        if u.path == "/_mock/saves":
            with s.lock:
                saves = [{"user": f["owner"], "name": f["name"], "size": s.size(f), "revisions": f["revisions"],
                          "parent": s.files.get(f["parents"][0], {}).get("name")} for f in s.files.values()
                         if f["data"] is not None]
            return self.reply(200, saves)
        if u.path == "/_mock/reset":
            s.reset(); return self.reply(204)
        if u.path == "/_mock/seed" and self.command == "POST":   # ?user=&system=&name= corpo = save
            tok, system, name, data = qs["user"], qs["system"], qs["name"], self.body()
            with s.lock:
                root = next((f for f in s.files.values() if f["name"] == "R36S Web — saves" and f["owner"] == tok), None)
                if not root:
                    s.add(fid("saves", tok), "R36S Web — saves", FOLDER, ["root-" + tok], tok); root = s.files[fid("saves", tok)]
                sd = next((f for f in s.files.values() if f["name"] == system and root["id"] in f["parents"]), None)
                if not sd:
                    s.add(fid("saves", tok, system), system, FOLDER, [root["id"]], tok); sd = s.files[fid("saves", tok, system)]
                s.add(fid("saves", tok, system, name), name, "application/octet-stream", [sd["id"]], tok, data=data)
            return self.reply(204)
        tok = self.token()
        s.log.append({"method": self.command, "path": u.path, "q": qs.get("q"), "range": self.headers.get("Range"), "user": tok})
        if not tok:
            return self.reply(401, {"error": {"code": 401, "message": "Invalid Credentials"}})
        if u.path == "/drive/v3/about":
            us = USERS[tok]
            return self.reply(200, {"user": {"displayName": us["displayName"], "emailAddress": us["emailAddress"]}})
        if u.path == "/drive/v3/files" and self.command == "GET":
            try:
                with s.lock:
                    res = [s.meta(f, tok) for f in s.query(qs.get("q", ""), tok)]
            except ValueError as e:
                return self.reply(400, {"error": {"code": 400, "message": str(e)}})
            return self.reply(200, {"files": res})
        if u.path == "/drive/v3/files" and self.command == "POST":
            meta = json.loads(self.body() or b"{}")
            parents = ["root-" + tok if p == "root" else p for p in meta.get("parents", ["root"])]
            nid = fid("new", tok, str(len(s.files)), meta.get("name", ""))
            with s.lock:
                s.add(nid, meta["name"], meta.get("mimeType", "application/octet-stream"), parents, tok, data=None if meta.get("mimeType") == FOLDER else b"")
            return self.reply(200, {"id": nid, "name": meta["name"]})
        if u.path == "/upload/drive/v3/files" and self.command == "POST":
            ctype = self.headers.get("Content-Type", "")
            bnd = re.search(r"boundary=([^;\s]+)", ctype)
            if not ctype.startswith("multipart/related") or not bnd:
                return self.reply(400, {"error": {"code": 400, "message": "esperado multipart/related"}})
            parts = [x.split(b"\r\n\r\n", 1)[1][:-2] for x in self.body().split(b"--" + bnd.group(1).encode())[1:3]]
            meta, data = json.loads(parts[0]), parts[1]
            nid = fid("up", tok, str(len(s.files)), meta.get("name", ""))
            with s.lock:
                s.add(nid, meta["name"], meta.get("mimeType", "application/octet-stream"), meta.get("parents", ["root-" + tok]), tok, data=data)
            return self.reply(200, {"id": nid})
        m = re.fullmatch(r"/upload/drive/v3/files/([^/]+)", u.path)
        if m and self.command == "PATCH":
            f = s.files.get(m.group(1))
            if not f or f["owner"] != tok:
                return self.reply(404, {"error": {"code": 404}})
            with s.lock:
                f["data"] = self.body(); f["revisions"] += 1
            return self.reply(200, {"id": f["id"]})
        m = re.fullmatch(r"/drive/v3/files/([^/]+)", u.path)
        if m and self.command == "GET":
            f = s.files.get(urllib.parse.unquote(m.group(1)))
            if not f or f["owner"] not in (tok, "andre"):
                return self.reply(404, {"error": {"code": 404, "message": "File not found"}})
            if qs.get("alt") != "media":
                return self.reply(200, s.meta(f, tok))
            data = s.content(f)
            rng = self.headers.get("Range")
            if rng and (mm := re.fullmatch(r"bytes=(\d+)-(\d*)", rng)):
                a = int(mm.group(1)); b = min(int(mm.group(2)) if mm.group(2) else len(data) - 1, len(data) - 1)
                return self.reply(206, data[a:b + 1], "application/octet-stream", {"Content-Range": f"bytes {a}-{b}/{len(data)}"})
            return self.reply(200, data, "application/octet-stream")
        return self.reply(404, {"error": {"code": 404, "message": "rota não existe no mock"}})

    do_GET = do_POST = do_PATCH = do_HEAD = lambda self: self.route()

def main():
    ap = argparse.ArgumentParser(description="mock do Google Drive v3 para os testes do site")
    ap.add_argument("port", nargs="?", type=int)
    ap.add_argument("--library", help="pasta que faz o papel de R36S no Drive")
    ap.add_argument("--index", help="pasta com manifest.json/eager.bin/info.json/library.json.gz (vira R36S/.web)")
    ap.add_argument("--lsjson", metavar="PASTA", help="só imprime a listagem estilo rclone lsjson -R --hash")
    a = ap.parse_args()
    if a.lsjson:
        json.dump(lsjson(a.lsjson), sys.stdout, ensure_ascii=False); return
    Handler.store = Store(a.library, a.index)
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", a.port), Handler)
    print(f"mock do Drive em http://127.0.0.1:{a.port}/", flush=True)
    srv.serve_forever()

if __name__ == "__main__":
    main()
