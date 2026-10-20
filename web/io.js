// E/S do seletor e do player. O seletor (index.html) e o player (retroarch/play.js) falam o "idioma" do hub:
// data/library.json.gz, data/manifest.json, data/eager.bin, fs/<caminho do cartão>, saves/<sistema>/<arquivo>
// (GET 404 = sem save; PUT). Aqui esse espaço de URLs é traduzido para o backend escolhido pelo site (web/site/site.js):
//   drive — biblioteca cifrada (spec 2026-10-20-acesso-cifrado): índice pelo backend, arquivos opacos no Drive
//           decifrados aqui (por bloco, com Range; chaves em site.library.keys); cache (Cache API) guarda o cifrado,
//           por ID+versão; saves no Drive do usuário;
//   demo  — homebrews servidos com o site (site/demo/), saves no Drive se logado, senão só neste navegador (IndexedDB);
//   hub   — fs/, saves/ e data/ do hub local: fetch/XHR normais.
// Interface: io.fetchFrom(base) -> função com a assinatura do fetch; io.xhrFrom(base) -> classe XMLHttpRequest;
// no Drive também io.readSync (lazyFile do player), io.lerPedacos (⬇ ROM) e io.canOpen (sistema com chave).

import { faixa, chaveDoCaminho, decifrarIntervalo, decifrarIntervaloSync, decifrarArquivo, decifrarRegistro } from "./cripto.js";

const ROOT = new URL("./", import.meta.url);   // web/
const CACHE = "r36s-drive-v1";
const PARALLEL = 4;   // downloads de imagens do Drive ao mesmo tempo

const resp = (body, status = 200, headers = {}) => new Response(body, { status, headers });
const notFound = () => resp(null, 404);

// preload {manifest, eager}: índice já baixado (aba isolada do PSP: o seletor manda pelo BroadcastChannel)
export function createIO({ backend, site, preload }) {
  const drive = site && site.drive;
  const library = site && site.library;
  const demoRoot = new URL("site/demo/", ROOT);
  let manifest = (preload && preload.manifest) || null, eager = (preload && preload.eager) || null;
  const stats = { media: 0, cached: 0, bytes: 0, saves: { get: 0, put: 0 } };
  // chaves da biblioteca (só em memória): "catalogo" (índice, capas, miniaturas), "bios", "sistema:<id>"
  const keys = (library && library.keys) || null;
  const keyOf = vpath => (keys && keys[chaveDoCaminho(vpath)]) || null;

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
    const k = keyOf(vpath);
    if (!k) return resp(null, 403);   // sistema sem acesso (o backend não mandou a chave)
    if (init.method === "HEAD") return resp(null, 200, { "Content-Length": String(e.size) });
    if (!e.size) return resp(new Uint8Array(0), 200, { "Content-Length": "0" });
    const range = init.headers && (init.headers.Range || init.headers.range);
    const m = range && /bytes=(\d+)-(\d*)/.exec(range);
    const de = m ? +m[1] : 0, ate = Math.min(e.size - 1, m && m[2] ? +m[2] : e.size - 1);
    if (de > ate) return resp(null, 416, { "Content-Range": `bytes */${e.size}` });
    // pede os blocos cifrados inteiros que cobrem [de, ate] e devolve só o recorte em claro
    const fx = faixa(de, ate, e.size);
    const r = await drive.media(e.id, { range: [fx.cDe, fx.cAte], signal: init.signal });
    stats.media++;
    if (!r.ok) return resp(null, r.status === 404 ? 404 : 502);
    let c = new Uint8Array(await r.arrayBuffer());
    if (r.status === 200 && c.length > fx.cAte - fx.cDe + 1) c = c.subarray(fx.cDe, fx.cAte + 1);   // Range ignorado
    let t;
    try { t = await decifrarIntervalo(k, c, de, ate, e.size); }
    catch (err) { console.warn("[io] bloco não confere", vpath, err); return resp(null, 502); }
    stats.bytes += c.length;
    return m ? resp(t, 206, { "Content-Length": String(t.length), "Content-Range": `bytes ${de}-${ate}/${e.size}` })
             : resp(t, 200, { "Content-Length": String(t.length) });
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

  // índice (manifest.json, eager.bin ~0,1 MB, library.json.gz; ref = {id, v} vindo do backend) em cache por ID +
  // versão: só baixa de novo quando muda. O cache guarda o cifrado; etiqueta que não confere -> 502 e sai do cache.
  async function indexFile(ref) {
    if (!ref || !ref.id) return notFound();
    const key = `${drive.api}/r36s-cache/index/${ref.id}/${ref.v || ""}`;
    const c = ref.v ? await cache() : null;
    const hit = c && await c.match(key).catch(() => null);
    let buf;
    if (hit) { stats.cached++; buf = new Uint8Array(await hit.arrayBuffer()); }
    else {
      const r = await drive.media(ref.id);
      if (!r.ok) return resp(null, r.status);
      buf = new Uint8Array(await r.arrayBuffer());
    }
    if (!keys || !keys.catalogo) return resp(null, 403);
    let t;
    try { t = await decifrarArquivo(keys.catalogo, buf); }
    catch (err) {
      console.warn("[io] índice não confere", ref.id, err);
      if (hit) c.delete(key).catch(() => {});
      return resp(null, 502);
    }
    if (c && !hit) {
      // versões antigas deste mesmo arquivo saem do cache (não acumulam a cada nova geração do índice)
      for (const k of await c.keys().catch(() => [])) if (k.url.includes(`/r36s-cache/index/${ref.id}/`) && k.url !== key) c.delete(k).catch(() => {});
      c.put(key, resp(buf.slice(), 200)).catch(() => {});
    }
    return resp(t, 200);
  }

  // manifest e eager do Drive: uma promessa por arquivo, dividida entre as rotas e o loadIndex (um download só)
  const fail = (what, status) => Object.assign(new Error(`${what} HTTP ${status}`), { status });
  let manifestP = null, eagerP = null;
  function driveManifest() {
    if (manifest) return Promise.resolve(manifest);
    return manifestP || (manifestP = indexFile(library.index.manifest)
      .then(r => { if (!r.ok) throw fail("manifest", r.status); return r.json(); })
      .then(m => (manifest = m))
      .catch(e => { manifestP = null; throw e; }));
  }
  // eager vazio só com 404 (índice sem eager); outra falha rejeita e tenta de novo na próxima vez
  function driveEager() {
    if (eager) return Promise.resolve(eager);
    return eagerP || (eagerP = indexFile(library.index.eager)
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
      const r = await indexFile(library.index.library);
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
  const idv = ref => { const i = ref.indexOf("."); return i < 0 ? { id: ref, v: "" } : { id: ref.slice(0, i), v: ref.slice(i + 1) }; };
  // "@<caminho>[?<versão>]": relativo à pasta do índice do backend (hub: data/, demo: site/demo/data/); no Drive não existe
  const atUrl = ref => {
    if (backend === "drive") throw new Error(`"${ref}": "@" (relativo ao índice) só existe no hub/demo; no Drive é "<id>.<versão>"`);
    const q = ref.indexOf("?");
    return new URL("data/" + enc(q < 0 ? ref.slice(1) : ref.slice(1, q)) + (q < 0 ? "" : ref.slice(q)), backend === "demo" ? demoRoot : ROOT).href;
  };
  // recorte de um pacote (hub/demo) com Range. Servidor que ignora o Range (200 com o pacote todo): o primeiro pedido
  // de cada pacote é a "sonda" e os outros esperam por ela; o pacote inteiro fica na memória (um por vez) e os recortes
  // saem dele.
  const rangeOk = new Set(), probing = new Map();
  let whole = null;   // { url, p: Promise<ArrayBuffer> }
  async function packSlice(url, off, len) {
    const range = { headers: { Range: `bytes=${off}-${off + len - 1}` } };
    for (;;) {
      if (rangeOk.has(url)) break;
      if (whole && whole.url === url) return (await whole.p).slice(off, off + len);
      const wait = probing.get(url);
      if (!wait) break;
      await wait.catch(() => {});
    }
    const probe = !rangeOk.has(url);
    let done;
    if (probe) probing.set(url, new Promise(res => (done = res)));
    try {
      const r = await fetch(url, range);
      if (!r.ok) throw new Error(`miniatura HTTP ${r.status}`);
      if (r.status === 206) { rangeOk.add(url); return await r.arrayBuffer(); }
      const w = { url, p: r.arrayBuffer() };
      whole = w;
      w.p.catch(() => { if (whole === w) whole = null; });
      return (await w.p).slice(off, off + len);
    } finally {
      if (probe) { probing.delete(url); done(); }
    }
  }
  // Cache API (chave = URL) ou, se não tem, get() na fila (PARALLEL de cada vez); get -> {buf, type}
  async function cached(key, opts, get) {
    const c = await cache();
    const hit = c && await c.match(key).catch(() => null);
    if (hit) { stats.cached++; return hit; }
    await slot();
    if (opts.wanted && !opts.wanted()) { done(); throw new DOMException("imagem fora da tela", "AbortError"); }
    try {
      const { buf, type } = await get();
      stats.bytes += buf.byteLength;
      const h = { "Content-Type": type };
      if (c) c.put(key, resp(buf.slice(0), 200, h)).catch(() => {});
      return resp(buf, 200, h);
    } finally { done(); }
  }
  const blobUrl = async r => URL.createObjectURL(await r.blob());
  // Drive: o cache devolve o cifrado; decifra aqui. Não confere -> a entrada sai do cache (não fica quebrada para sempre)
  const blobDe = async (key, r, decifra, type) => {
    let t;
    try { t = await decifra(new Uint8Array(await r.arrayBuffer())); }
    catch (err) { const c = await cache(); if (c) c.delete(key).catch(() => {}); throw err; }
    return URL.createObjectURL(new Blob([t], { type }));
  };
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
    // URL de uma imagem do library.json.gz: caminho do cartão "/roms/..." (hub/demo: URL direta, cache HTTP) ou, no Drive,
    // "<id>[.<versão>]" (blob; {id, v} de índices antigos também vale).
    // A URL blob é de quem chamou: revogar (URL.revokeObjectURL) quando a imagem sair da tela.
    // opts.wanted(): conferido quando chega a vez na fila; se não quer mais (saiu da tela), nem baixa (AbortError).
    async image(ref, opts = {}) {
      if (typeof ref === "string" && ref.startsWith("/")) return new URL("fs" + enc(ref), backend === "demo" ? demoRoot : ROOT).href;
      if (typeof ref === "string") ref = idv(ref);
      if (!drive) throw new Error("imagem do Drive sem login no Drive");
      if (!keys || !keys.catalogo) throw new Error("imagem do Drive sem a chave do catálogo");
      const key = cacheKey(ref);
      // tipo vazio: o arquivo no Drive é opaco; o navegador reconhece a imagem pelo conteúdo
      return blobDe(key, await cached(key, opts, async () => {
        const r = await drive.media(ref.id);
        stats.media++;
        if (!r.ok) throw new Error(`imagem HTTP ${r.status}`);
        return { buf: await r.arrayBuffer(), type: "" };
      }), b => decifrarArquivo(keys.catalogo, b), "");
    },
    // miniatura de capa: recorte [off, off+len) do pacote do sistema (library: sistema "capas", jogo "thumb"), lido com
    // Range. pack: hub/demo "@capas/<sistema>.bin?<versão>" (relativo à pasta do índice: data/ ou site/demo/data/);
    // Drive "<id>.<versão>". URL blob (revogar como a do image); mesmo cache, fila e opts.wanted do image.
    async thumb(pack, off, len, opts = {}) {
      const type = "image/webp", end = off + len - 1;
      const exact = buf => { if (buf.byteLength !== len) throw new Error(`miniatura: ${buf.byteLength} bytes, tamanho esperado ${len}`); return { buf, type }; };
      if (pack.startsWith("@")) {
        const url = atUrl(pack), key = `${url}${url.includes("?") ? "&" : "?"}r36s-thumb=${off}-${len}`;
        return blobUrl(await cached(key, opts, () => packSlice(url, off, len).then(exact)));
      }
      if (!drive) throw new Error("miniatura do Drive sem login no Drive");
      if (!keys || !keys.catalogo) throw new Error("miniatura do Drive sem a chave do catálogo");
      const { id, v } = idv(pack), key = `${drive.api}/r36s-cache/thumb/${id}/${v}/${off}-${len}`;
      // [off, off+len) é o registro cifrado (nonce || cifra || etiqueta); o cache guarda o registro
      return blobDe(key, await cached(key, opts, async () => {
        const r = await drive.media(id, { range: [off, end] });
        stats.media++;
        if (!r.ok) throw new Error(`miniatura HTTP ${r.status}`);
        // 200 = Range ignorado: o corpo é o pacote inteiro (MBs). Não baixa por capa: cancela e falha (a <img> mostra o nome)
        if (r.status !== 206 && !(off === 0 && +r.headers.get("Content-Length") === len)) {
          if (r.body) r.body.cancel().catch(() => {});
          throw new Error(`miniatura: o Drive ignorou o Range (HTTP ${r.status})`);
        }
        return exact(await r.arrayBuffer());
      }), b => decifrarRegistro(keys.catalogo, b), type);
    },
    // limpa do cache os recortes de pacotes deste backend que não são mais os atuais (packs: "capas" dos sistemas do
    // library). As capas originais (destaque e ficha) e os recortes de outro backend ficam. Devolve quantos apagou.
    async pruneThumbs(packs) {
      const c = await cache();
      if (!c) return 0;
      const drivePrefix = drive && `${drive.api}/r36s-cache/thumb/`;
      const mine = backend === "drive" ? drivePrefix : new URL("data/", backend === "demo" ? demoRoot : ROOT).href;
      if (!mine) return 0;
      const keep = new Set(packs.map(p => (backend === "drive" ? `${drivePrefix}${idv(p).id}/${idv(p).v}/` : atUrl(p))));
      let n = 0;
      for (const k of await c.keys().catch(() => [])) {
        const u = k.url;
        if (!u.startsWith(mine)) continue;
        let base;
        if (backend === "drive") base = u.slice(0, u.lastIndexOf("/") + 1);
        else { const i = u.search(/[?&]r36s-thumb=/); if (i < 0) continue; base = u.slice(0, i); }
        if (!keep.has(base)) { await c.delete(k).catch(() => {}); n++; }
      }
      return n;
    },
    // ROM para salvar (hub/demo): link direto
    romUrl(vpath) { return new URL("fs" + enc(vpath), backend === "demo" ? demoRoot : ROOT).href; },
    fetchFrom(base) {
      return (input, init) => route(new URL(typeof input === "string" ? input : input.url, base).href, init || {});
    },
    // sistema que este usuário pode abrir: no Drive, só com a chave do sistema (hub/demo: todos)
    canOpen(systemId) { return backend !== "drive" || !!(keys && keys["sistema:" + systemId]); },
    // leitura síncrona [de, ate] de um arquivo do cartão (lazyFile do player, dentro do fread do núcleo): blocos
    // cifrados por XHR síncrono + ChaCha20 síncrono (sem conferir a etiqueta, ver web/cripto.js). Só no Drive.
    readSync(vpath, de, ate) {
      if (backend !== "drive") throw new Error("io.readSync só existe no Drive");
      const e = entryOf(vpath), k = keyOf(vpath);
      if (!e || !e.id || !k) throw Object.assign(new Error(`sem acesso a ${vpath}`), { status: 403 });
      ate = Math.min(ate, e.size - 1);
      if (de > ate) return new Uint8Array(0);
      const fx = faixa(de, ate, e.size);
      const x = new XMLHttpRequest();
      x.open("GET", drive.mediaUrl(e.id), false);
      x.setRequestHeader("Range", `bytes=${fx.cDe}-${fx.cAte}`);
      x.setRequestHeader("Authorization", drive.authHeader());
      x.overrideMimeType("text/plain; charset=x-user-defined");
      x.send();
      if (x.status !== 206 && x.status !== 200) throw Object.assign(new Error(`HTTP ${x.status}`), { status: x.status });
      const s = x.responseText;
      let c = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) c[i] = s.charCodeAt(i) & 0xff;
      if (x.status === 200 && c.length > fx.cAte - fx.cDe + 1) c = c.subarray(fx.cDe, fx.cAte + 1);   // Range ignorado
      stats.media++; stats.bytes += c.length;
      return decifrarIntervaloSync(k, c, de, ate, e.size);
    },
    // arquivo do cartão em pedaços decifrados de até `passo` bytes, em ordem (⬇ ROM no Drive: progresso e cancelar
    // pelo signal). Falha lança Error com status (403 = sem a chave do sistema).
    async *lerPedacos(vpath, { signal, passo = 8 << 20 } = {}) {
      if (backend !== "drive") throw new Error("io.lerPedacos só existe no Drive");
      await loadIndex();
      const e = entryOf(vpath);
      if (!e) throw Object.assign(new Error(`${vpath} não está no índice`), { status: 404 });
      if (e.kind === "eager" && eager) { yield eager.slice(e.off, e.off + e.size); return; }
      for (let de = 0; de < e.size; de += passo) {
        const ate = Math.min(e.size, de + passo) - 1;
        const r = await driveFile(vpath, e, { headers: { Range: `bytes=${de}-${ate}` }, signal });
        if (r.status !== 206 && r.status !== 200) throw Object.assign(new Error(`${vpath}: HTTP ${r.status}`), { status: r.status });
        yield new Uint8Array(await r.arrayBuffer());
      }
    },
    // XHR do player: mesma tradução de URLs (hub: direto; demo: fs/ em site/demo/). No Drive os arquivos do cartão são
    // cifrados: o lazyFile lê pelo io.readSync, não por aqui.
    xhrFrom(base) {
      return class extends XMLHttpRequest {
        open(method, url, async = true) {
          if (backend === "hub") return super.open(method, new URL(url, base).href, async);
          const abs = new URL(url, base).href, rel = relOf(abs);
          if (rel && rel.startsWith("fs/") && backend === "demo") return super.open(method, new URL(rel, demoRoot).href, async);
          return super.open(method, abs, async);
        }
      };
    },
  };
  return io;
}
