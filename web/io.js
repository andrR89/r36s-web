// E/S do ES e do player fora do hub. O ES (fsboot.js) e o player (retroarch/play.js) falam o "idioma" do hub:
// data/manifest.json, data/eager.bin, fs/<caminho do cartão>, saves/<sistema>/<arquivo> (GET 404 = sem save; PUT).
// Aqui esse espaço de URLs é traduzido para o backend escolhido pelo site (web/site/site.js):
//   drive — biblioteca R36S no Google Drive: índice em R36S/.web (IDs dos arquivos no manifesto), arquivos por ID com
//           Range, capas/tema em cache (Cache API) por ID+versão com pré-busca das vizinhas, saves no Drive do usuário;
//   demo  — homebrews servidos com o site (site/demo/), saves no Drive se logado, senão só neste navegador (IndexedDB).
// No modo hub nada disto é usado: fetch/XHR normais (o caminho dos testes de sempre).
// Interface: io.fetchFrom(base) -> função com a assinatura do fetch; io.xhrFrom(base) -> classe XMLHttpRequest.

const ROOT = new URL("./", import.meta.url);   // web/
const CACHE = "r36s-drive-v1";
const PREFETCH = 4;   // capas seguintes da mesma pasta buscadas em segundo plano
const IMG = /\.(png|jpe?g|webp|gif|svg)$/i;

const resp = (body, status = 200, headers = {}) => new Response(body, { status, headers });
const notFound = () => resp(null, 404);

// preload {manifest, eager}: índice já baixado (aba isolada do PSP: a página do ES manda pelo BroadcastChannel)
export function createIO({ backend, site, preload }) {
  const drive = site && site.drive;
  const library = site && site.library;
  const demoRoot = new URL("site/demo/", ROOT);
  let manifest = (preload && preload.manifest) || null, eager = (preload && preload.eager) || null, byDir = null;
  const stats = { media: 0, cached: 0, prefetched: 0, bytes: 0, saves: { get: 0, put: 0 } };

  const entryOf = vpath => manifest && (manifest.files[vpath] || (manifest.extra && manifest.extra[vpath])) || null;
  const relOf = url => { const u = new URL(url, ROOT); return u.href.startsWith(ROOT.href) ? u.href.slice(ROOT.href.length).split(/[?#]/)[0] : null; };
  const vpathOf = rel => "/" + rel.slice(3).split("/").map(decodeURIComponent).join("/");

  // ---- arquivos do Drive ----
  let cachePromise = null;
  const cache = () => cachePromise || (cachePromise = (self.caches ? caches.open(CACHE) : Promise.resolve(null)).catch(() => null));
  const cacheKey = e => `${drive.api}/r36s-cache/${e.id}/${e.v || ""}`;

  async function driveFile(vpath, e, init = {}) {
    if (e.kind === "eager" && eager) {
      const data = eager.subarray(e.off, e.off + e.size);
      return init.method === "HEAD" ? resp(null, 200, { "Content-Length": String(e.size) }) : resp(data.slice(), 200, { "Content-Length": String(e.size) });
    }
    if (!e.id) return notFound();
    if (init.method === "HEAD") return resp(null, 200, { "Content-Length": String(e.size) });
    const range = init.headers && (init.headers.Range || init.headers.range);
    const cacheable = !range && (IMG.test(vpath) || vpath.startsWith("/roms/themes/"));
    if (cacheable) {
      const c = await cache();
      const hit = c && await c.match(cacheKey(e)).catch(() => null);
      if (hit) { stats.cached++; prefetchAfter(vpath); return hit; }
    }
    const m = range && /bytes=(\d+)-(\d*)/.exec(range);
    const r = await drive.media(e.id, m ? { range: [+m[1], m[2] ? +m[2] : e.size - 1] } : {});
    stats.media++;
    if (!r.ok) return resp(null, r.status === 404 ? 404 : 502);
    if (cacheable) {
      const buf = await r.arrayBuffer();
      stats.bytes += buf.byteLength;
      const c = await cache();
      if (c) c.put(cacheKey(e), resp(buf.slice(0), 200, { "Content-Length": String(buf.byteLength) })).catch(() => {});
      prefetchAfter(vpath);
      return resp(buf, 200, { "Content-Length": String(buf.byteLength) });
    }
    return r;
  }

  // pré-busca: as próximas imagens da mesma pasta (a lista do ES anda em ordem alfabética, como o manifesto)
  const prefetching = new Set();
  function prefetchAfter(vpath) {
    if (!IMG.test(vpath) || !vpath.startsWith("/roms/")) return;
    if (!byDir) {
      byDir = new Map();
      for (const [p, e] of Object.entries(manifest.files)) {
        if (e.kind !== "lazy" || !IMG.test(p)) continue;
        const d = p.slice(0, p.lastIndexOf("/"));
        if (!byDir.has(d)) byDir.set(d, []);
        byDir.get(d).push(p);
      }
      for (const l of byDir.values()) l.sort();
    }
    const list = byDir.get(vpath.slice(0, vpath.lastIndexOf("/"))) || [];
    const i = list.indexOf(vpath);
    for (const p of list.slice(i + 1, i + 1 + PREFETCH)) {
      if (prefetching.has(p)) continue;
      prefetching.add(p);
      const e = manifest.files[p];
      cache().then(async c => {
        if (!c || await c.match(cacheKey(e))) return;
        const r = await drive.media(e.id);
        if (r.ok) { await c.put(cacheKey(e), resp(await r.arrayBuffer(), 200)); stats.prefetched++; }
      }).catch(() => {});
    }
  }

  // ---- saves ----
  const localSaves = {
    db: null,
    open() {
      return this.db || (this.db = new Promise((res, rej) => {
        const r = indexedDB.open("r36s-local-saves", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("saves");
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      }));
    },
    async op(mode, fn) {
      const db = await this.open();
      return new Promise((res, rej) => { const tx = db.transaction("saves", mode); const q = fn(tx.objectStore("saves")); tx.oncomplete = () => res(q.result); tx.onerror = () => rej(tx.error); });
    },
    getSave(system, name) { return this.op("readonly", s => s.get(`${system}/${name}`)).then(v => v || null); },
    putSave(system, name, data) { return this.op("readwrite", s => s.put(new Uint8Array(data), `${system}/${name}`)); },
  };
  const saves = drive ? drive : localSaves;

  async function saveRoute(rel, init) {
    const [system, name] = rel.slice(6).split("/").map(decodeURIComponent);
    if (!system || !name) return resp(null, 400);
    const method = (init.method || "GET").toUpperCase();
    try {
      if (method === "PUT") {
        let body = init.body;
        if (body instanceof Blob) body = new Uint8Array(await body.arrayBuffer());
        await saves.putSave(system, name, body, { keepalive: !!init.keepalive });
        stats.saves.put++;
        return resp(null, 204);
      }
      const d = await saves.getSave(system, name);
      stats.saves.get++;
      return d ? resp(d, 200, { "Content-Length": String(d.length) }) : notFound();
    } catch (e) {
      console.warn("[io] save", method, system, name, e);
      return resp(null, e.status === 401 || e.status === 403 ? e.status : 502);
    }
  }

  // ---- roteador ----
  async function route(url, init = {}) {
    const rel = relOf(url);
    if (rel === null) return fetch(url, init);
    if (rel.startsWith("saves/")) return saveRoute(rel, init);
    if (backend === "demo") {
      if (rel === "data/manifest.json" || rel === "data/eager.bin" || rel.startsWith("fs/")) return fetch(new URL(rel, demoRoot), init);
      return fetch(url, init);
    }
    // drive
    if (rel === "data/manifest.json") {
      if (!manifest) {
        const r = await drive.media(library.index.manifest);
        if (!r.ok) return resp(null, r.status);
        manifest = await r.json();
      }
      return resp(JSON.stringify(manifest), 200, { "Content-Type": "application/json" });
    }
    if (rel === "data/eager.bin") {
      if (!eager) {
        const r = await drive.media(library.index.eager);
        if (!r.ok) return resp(null, r.status);
        eager = new Uint8Array(await r.arrayBuffer());
      }
      return resp(eager.slice(), 200);
    }
    if (rel.startsWith("fs/")) {
      if (!manifest) await route(new URL("data/manifest.json", ROOT).href);
      const vpath = vpathOf(rel);
      const e = entryOf(vpath);
      return e ? driveFile(vpath, e, init) : notFound();
    }
    return fetch(url, init);
  }

  const io = {
    backend, stats,
    get manifest() { return manifest; },
    get eager() { return eager; },
    fetchFrom(base) {
      return (input, init) => route(new URL(typeof input === "string" ? input : input.url, base).href, init || {});
    },
    // XHR síncrono do player (arquivos grandes sob demanda, por Range): mesma tradução, com o token na hora do send
    xhrFrom(base) {
      return class extends XMLHttpRequest {
        open(method, url, async = true) {
          const abs = new URL(url, base).href, rel = relOf(abs);
          this._r36sAuth = false;
          if (rel && rel.startsWith("fs/")) {
            if (backend === "demo") return super.open(method, new URL(rel, demoRoot).href, async);
            const e = entryOf(vpathOf(rel));
            if (e && e.id) { this._r36sAuth = true; return super.open(method, drive.mediaUrl(e.id), async); }
          }
          return super.open(method, abs, async);
        }
        send(body) {
          if (this._r36sAuth) this.setRequestHeader("Authorization", drive.authHeader());
          return super.send(body);
        }
      };
    },
  };
  return io;
}
