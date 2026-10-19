// E/S do seletor e do player. O seletor (index.html) e o player (retroarch/play.js) falam o "idioma" do hub:
// data/library.json.gz, data/manifest.json, data/eager.bin, fs/<caminho do cartão>, saves/<sistema>/<arquivo>
// (GET 404 = sem save; PUT). Aqui esse espaço de URLs é traduzido para o backend escolhido pelo site (web/site/site.js):
//   drive — biblioteca R36S no Google Drive: índice em R36S/.web (IDs dos arquivos no manifesto), arquivos por ID com
//           Range, capas em cache (Cache API) por ID+versão, saves no Drive do usuário;
//   demo  — homebrews servidos com o site (site/demo/), saves no Drive se logado, senão só neste navegador (IndexedDB);
//   hub   — fs/, saves/ e data/ do hub local: fetch/XHR normais.
// Interface: io.fetchFrom(base) -> função com a assinatura do fetch; io.xhrFrom(base) -> classe XMLHttpRequest.

const ROOT = new URL("./", import.meta.url);   // web/
const CACHE = "r36s-drive-v1";
const PARALLEL = 4;   // downloads de imagens do Drive ao mesmo tempo
const IMG = /\.(png|jpe?g|webp|gif|svg)$/i;

const resp = (body, status = 200, headers = {}) => new Response(body, { status, headers });
const notFound = () => resp(null, 404);

// preload {manifest, eager}: índice já baixado (aba isolada do PSP: o seletor manda pelo BroadcastChannel)
export function createIO({ backend, site, preload }) {
  const drive = site && site.drive;
  const library = site && site.library;
  const demoRoot = new URL("site/demo/", ROOT);
  let manifest = (preload && preload.manifest) || null, eager = (preload && preload.eager) || null;
  const stats = { media: 0, cached: 0, bytes: 0, saves: { get: 0, put: 0 } };

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
      if (hit) { stats.cached++; return hit; }
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
      return resp(buf, 200, { "Content-Length": String(buf.byteLength) });
    }
    return r;
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

  // índice (manifest.json, eager.bin ~0,1 MB, library.json.gz) em cache por ID + data de modificação: só baixa de novo quando muda
  async function indexFile(id, version) {
    const key = `${drive.api}/r36s-cache/index/${id}/${version || ""}`;
    const c = version ? await cache() : null;
    const hit = c && await c.match(key).catch(() => null);
    if (hit) { stats.cached++; return hit; }
    const r = await drive.media(id);
    if (!r.ok || !c) return r;
    const buf = await r.arrayBuffer();
    // versões antigas deste mesmo arquivo saem do cache (não acumulam a cada nova geração do índice)
    for (const k of await c.keys().catch(() => [])) if (k.url.includes(`/r36s-cache/index/${id}/`) && k.url !== key) c.delete(k).catch(() => {});
    c.put(key, resp(buf.slice(0), 200)).catch(() => {});
    return resp(buf, 200);
  }

  // manifest e eager do Drive: uma promessa por arquivo, dividida entre as rotas e o loadIndex (um download só)
  const fail = (what, status) => Object.assign(new Error(`${what} HTTP ${status}`), { status });
  let manifestP = null, eagerP = null;
  function driveManifest() {
    if (manifest) return Promise.resolve(manifest);
    return manifestP || (manifestP = indexFile(library.index.manifest, library.index.modifiedTime)
      .then(r => { if (!r.ok) throw fail("manifest", r.status); return r.json(); })
      .then(m => (manifest = m))
      .catch(e => { manifestP = null; throw e; }));
  }
  // eager vazio só com 404 (índice sem eager); outra falha rejeita e tenta de novo na próxima vez
  function driveEager() {
    if (eager) return Promise.resolve(eager);
    return eagerP || (eagerP = indexFile(library.index.eager, library.index.eagerTime)
      .then(r => r.ok ? r.arrayBuffer() : r.status === 404 ? new ArrayBuffer(0) : Promise.reject(fail("eager", r.status)))
      .then(b => (eager = new Uint8Array(b)))
      .catch(e => { eagerP = null; throw e; }));
  }

  // ---- roteador ----
  async function route(url, init = {}) {
    const rel = relOf(url);
    if (rel === null) return fetch(url, init);
    if (backend === "hub") return fetch(url, init);
    if (rel.startsWith("saves/")) return saveRoute(rel, init);
    if (backend === "demo") {
      if (rel === "data/manifest.json" || rel === "data/eager.bin" || rel === "data/library.json.gz" || rel.startsWith("fs/")) return fetch(new URL(rel, demoRoot), init);
      return fetch(url, init);
    }
    // drive
    if (rel === "data/manifest.json") {
      try { await driveManifest(); } catch (e) { return resp(null, e.status || 502); }
      return resp(JSON.stringify(manifest), 200, { "Content-Type": "application/json" });
    }
    if (rel === "data/eager.bin") {
      try { await driveEager(); } catch (e) { return resp(null, e.status || 502); }
      return resp(eager.slice(), 200);
    }
    if (rel === "data/library.json.gz") {
      const r = await indexFile(library.index.library, library.index.libraryTime);
      return r.ok ? r : resp(null, r.status);
    }
    if (rel.startsWith("fs/")) {
      if (!manifest) try { await driveManifest(); } catch (e) { return resp(null, e.status || 502); }
      const vpath = vpathOf(rel);
      const e = entryOf(vpath);
      return e ? driveFile(vpath, e, init) : notFound();
    }
    return fetch(url, init);
  }

  // imagens do Drive: no máximo PARALLEL downloads ao mesmo tempo, o mais recente primeiro (a tela rolou: vale mais)
  const waiting = [];
  let active = 0;
  const slot = () => new Promise(res => { waiting.unshift(res); next(); });
  const next = () => { while (active < PARALLEL && waiting.length) { active++; waiting.shift()(); } };
  const done = () => { active--; next(); };
  const enc = p => p.split("/").map(encodeURIComponent).join("/");
  // índice completo para o emulador (o seletor só precisa do library.json.gz): pedido em segundo plano
  let indexPromise = null;
  function loadIndex() {
    if (manifest && eager) return Promise.resolve({ manifest, eager });
    if (backend === "drive") return Promise.all([driveManifest(), driveEager()]).then(() => ({ manifest, eager }));
    const get = rel => route(new URL(rel, ROOT).href);
    return indexPromise || (indexPromise = Promise.all([
      get("data/manifest.json").then(r => { if (!r.ok) throw fail("manifest", r.status); return r.json(); }),
      get("data/eager.bin").then(r => r.ok ? r.arrayBuffer() : r.status === 404 ? new ArrayBuffer(0) : Promise.reject(fail("eager", r.status))),
    ]).then(([m, e]) => { manifest = m; eager = new Uint8Array(e); return { manifest, eager }; })
      .catch(e => { indexPromise = null; throw e; }));
  }

  const io = {
    backend, stats,
    get manifest() { return manifest; },
    get eager() { return eager; },
    get drive() { return drive; },
    loadIndex,
    // URL de uma imagem do library.json.gz: caminho do cartão (hub/demo: URL direta, cache HTTP) ou {id, v} (Drive: blob).
    // A URL blob é de quem chamou: revogar (URL.revokeObjectURL) quando a imagem sair da tela.
    async image(ref) {
      if (typeof ref === "string") return new URL("fs" + enc(ref), backend === "demo" ? demoRoot : ROOT).href;
      if (!drive) throw new Error("imagem do Drive sem login no Drive");
      const c = await cache(), key = cacheKey(ref);
      let r = c && await c.match(key).catch(() => null);
      if (r) stats.cached++;
      else {
        await slot();
        try {
          r = await drive.media(ref.id);
          stats.media++;
          if (!r.ok) throw new Error(`imagem HTTP ${r.status}`);
          const buf = await r.arrayBuffer(), type = { "Content-Type": r.headers.get("Content-Type") || "" };
          stats.bytes += buf.byteLength;
          if (c) c.put(key, resp(buf.slice(0), 200, type)).catch(() => {});
          r = resp(buf, 200, type);
        } finally { done(); }
      }
      return URL.createObjectURL(await r.blob());
    },
    // ROM para salvar (hub/demo): link direto
    romUrl(vpath) { return new URL("fs" + enc(vpath), backend === "demo" ? demoRoot : ROOT).href; },
    fetchFrom(base) {
      return (input, init) => route(new URL(typeof input === "string" ? input : input.url, base).href, init || {});
    },
    // XHR síncrono do player (arquivos grandes sob demanda, por Range): mesma tradução, com o token na hora do send
    xhrFrom(base) {
      return class extends XMLHttpRequest {
        open(method, url, async = true) {
          if (backend === "hub") return super.open(method, new URL(url, base).href, async);
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
