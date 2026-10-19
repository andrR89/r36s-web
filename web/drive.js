// Camada do Google Drive (API v3, REST puro): biblioteca R36S (própria ou compartilhada), índice em R36S/.web/,
// leitura por ID (com Range) e saves na pasta "R36S Web — saves" do Drive de cada usuário.
// Interface única para o site (web/site/site.js), o seletor (web/io.js) e o player (via io.js); os testes usam
// tests/mock_drive.py no lugar de https://www.googleapis.com (mesmos caminhos e parâmetros).
//
// Autenticação fica fora daqui: getToken(force) -> Promise<string> (force = renovar), peekToken() -> string síncrona
// (para o XHR síncrono do player). O token nunca é gravado (nem localStorage nem IndexedDB).

export const FOLDER = "application/vnd.google-apps.folder";
export const LIBRARY_NAME = "R36S";
export const INDEX_DIR = ".web";
export const SAVES_NAME = "R36S Web — saves";

export class DriveError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

const quote = s => String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");

export function createDrive({ api = "https://www.googleapis.com", getToken, peekToken }) {
  api = api.replace(/\/$/, "");

  async function req(path, init = {}, retry = true) {
    const token = await getToken(false);
    const headers = new Headers(init.headers || {});
    headers.set("Authorization", "Bearer " + token);
    const r = await fetch(api + path, { ...init, headers });
    if (r.status === 401 && retry) { await getToken(true); return req(path, init, false); }
    return r;
  }
  async function json(path, init) {
    const r = await req(path, init);
    if (!r.ok) throw new DriveError(`Drive HTTP ${r.status} em ${path.split("?")[0]}`, r.status);
    return r.json();
  }
  async function list(q, fields = "files(id,name,mimeType,size,modifiedTime,owners(displayName,emailAddress,me))") {
    const out = [];
    let page = "";
    do {
      const p = new URLSearchParams({ q, fields: "nextPageToken," + fields, pageSize: "1000", spaces: "drive",
        supportsAllDrives: "true", includeItemsFromAllDrives: "true" });
      if (page) p.set("pageToken", page);
      const d = await json(`/drive/v3/files?${p}`);
      out.push(...(d.files || []));
      page = d.nextPageToken;
    } while (page);
    return out;
  }
  const child = async (parent, name, mime) =>
    (await list(`'${quote(parent)}' in parents and name = '${quote(name)}' and trashed = false` + (mime ? ` and mimeType = '${mime}'` : "")))[0] || null;
  const mediaPath = id => `/drive/v3/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`;

  async function createFolder(name, parent) {
    const body = { name, mimeType: FOLDER };
    if (parent) body.parents = [parent];
    return json("/drive/v3/files?fields=id,name&supportsAllDrives=true", {
      method: "POST", headers: { "Content-Type": "application/json; charset=UTF-8" }, body: JSON.stringify(body) });
  }

  // índice da biblioteca: R36S/.web/{manifest.json, eager.bin, info.json} (data/mkmanifest.py --drive-ids)
  async function libraryIndex(folderId) {
    const web = await child(folderId, INDEX_DIR, FOLDER);
    if (!web) return null;
    const files = await list(`'${quote(web.id)}' in parents and trashed = false`);
    const by = Object.fromEntries(files.map(f => [f.name, f]));
    if (!by["manifest.json"] || !by["eager.bin"] || !by["library.json.gz"]) return null;
    let info = null;
    if (by["info.json"]) { try { const r = await req(mediaPath(by["info.json"].id)); if (r.ok) info = await r.json(); } catch (e) {} }
    return { manifest: by["manifest.json"].id, eager: by["eager.bin"].id, library: by["library.json.gz"].id, info,
      modifiedTime: by["manifest.json"].modifiedTime, eagerTime: by["eager.bin"].modifiedTime, libraryTime: by["library.json.gz"].modifiedTime };
  }

  // saves: <SAVES_NAME>/<sistema>/<arquivo>, no Drive de quem joga (escopo drive.file: só vê o que o app criou)
  const saveIds = new Map();
  let savesRoot = null;
  const sysFolders = new Map();
  async function savesFolder(create) {
    if (savesRoot) return savesRoot;
    const f = (await list(`name = '${quote(SAVES_NAME)}' and mimeType = '${FOLDER}' and trashed = false and 'root' in parents`))[0];
    if (f) return (savesRoot = f.id);
    if (!create) return null;
    return (savesRoot = (await createFolder(SAVES_NAME, "root")).id);
  }
  async function systemFolder(system, create) {
    if (sysFolders.has(system)) return sysFolders.get(system);
    const root = await savesFolder(create);
    if (!root) return null;
    let f = await child(root, system, FOLDER);
    if (!f && create) f = await createFolder(system, root);
    if (f) sysFolders.set(system, f.id);
    return f ? f.id : null;
  }
  async function saveId(system, name, create) {
    const key = `${system}/${name}`;
    if (saveIds.has(key)) return saveIds.get(key);
    const dir = await systemFolder(system, create);
    if (!dir) return null;
    const f = await child(dir, name);
    if (f) saveIds.set(key, f.id);
    return f ? f.id : null;
  }

  return {
    api,
    list, child, createFolder, libraryIndex,
    mediaUrl: id => api + mediaPath(id),
    authHeader: () => "Bearer " + peekToken(),

    async user() { return (await json("/drive/v3/about?fields=user(displayName,emailAddress,photoLink)")).user; },

    // pastas "R36S" do usuário e compartilhadas com ele, cada uma com o índice (.web) se houver
    async findLibraries() {
      const base = `name = '${LIBRARY_NAME}' and mimeType = '${FOLDER}' and trashed = false`;
      const [own, shared] = await Promise.all([list(base + " and 'me' in owners"), list(base + " and sharedWithMe = true")]);
      const seen = new Set(own.map(f => f.id));
      const withIndex = async (f, kind) => ({ id: f.id, name: f.name, kind, owner: (f.owners && f.owners[0]) || null,
        modifiedTime: f.modifiedTime, index: await libraryIndex(f.id).catch(() => null) });
      return {
        own: await Promise.all(own.map(f => withIndex(f, "own"))),
        shared: await Promise.all(shared.filter(f => !seen.has(f.id)).map(f => withIndex(f, "shared"))),
      };
    },

    async createLibrary() { return createFolder(LIBRARY_NAME, "root"); },

    // conteúdo de um arquivo por ID; range = [início, fim] inclusivo
    media(id, { range, signal, keepalive } = {}) {
      const headers = {};
      if (range) headers.Range = `bytes=${range[0]}-${range[1]}`;
      return req(mediaPath(id), { headers, signal, keepalive });
    },

    // GET do save: Uint8Array, ou null se não existe (o "404" do hub). Outros erros: exceção
    async getSave(system, name) {
      const id = await saveId(system, name, false);
      if (!id) return null;
      const r = await req(mediaPath(id), { cache: "no-store" });
      if (r.status === 404) { saveIds.delete(`${system}/${name}`); return null; }
      if (!r.ok) throw new DriveError(`save HTTP ${r.status}`, r.status);
      return new Uint8Array(await r.arrayBuffer());
    },

    // PUT do save: atualiza o arquivo (o Drive guarda a revisão anterior) ou cria com upload multipart
    async putSave(system, name, data, { keepalive } = {}) {
      const id = await saveId(system, name, true);
      if (id) {
        const r = await req(`/upload/drive/v3/files/${encodeURIComponent(id)}?uploadType=media&fields=id`, {
          method: "PATCH", headers: { "Content-Type": "application/octet-stream" }, body: data, keepalive });
        if (r.ok) return;
        if (r.status !== 404) throw new DriveError(`save PATCH ${r.status}`, r.status);
        saveIds.delete(`${system}/${name}`);
      }
      const dir = await systemFolder(system, true);
      const boundary = "r36s" + Math.random().toString(36).slice(2);
      const meta = JSON.stringify({ name, parents: [dir], mimeType: "application/octet-stream" });
      const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`,
        `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`, data, `\r\n--${boundary}--`]);
      const r = await req(`/upload/drive/v3/files?uploadType=multipart&fields=id`, {
        method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body, keepalive });
      if (!r.ok) throw new DriveError(`save POST ${r.status}`, r.status);
      saveIds.set(`${system}/${name}`, (await r.json()).id);
    },
  };
}
