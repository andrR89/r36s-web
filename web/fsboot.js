// Monta o FS virtual do ES a partir de data/manifest.json + data/eager.bin (contrato: data/mkmanifest.py)
export async function bootFS(Module) {
  const [manifest, blob] = await Promise.all([
    fetch("data/manifest.json").then(r => r.json()),
    fetch("data/eager.bin").then(r => r.arrayBuffer()).then(b => new Uint8Array(b)),
  ]);
  const FS = Module.FS;
  const mkdirp = p => { let cur = ""; for (const part of p.split("/").filter(Boolean)) { cur += "/" + part; try { FS.mkdir(cur); } catch (e) {} } };
  for (const d of manifest.dirs) mkdirp(d);
  const lazy = new Map();
  for (const [path, f] of Object.entries(manifest.files)) {
    mkdirp(path.slice(0, path.lastIndexOf("/")));
    if (f.kind === "eager") FS.writeFile(path, blob.subarray(f.off, f.off + f.size));
    else { FS.writeFile(path, new Uint8Array(0)); if (f.kind === "lazy") lazy.set(path, f.url); }
  }
  for (const [link, target] of Object.entries(manifest.symlinks)) {
    mkdirp(link.slice(0, link.lastIndexOf("/")));
    try { FS.symlink(target, link); } catch (e) {}
  }
  // o C++ chama com o caminho como o ES o vê (pode passar por symlink ou ter "//"): normaliza
  const realPath = p => { try { return FS.lookupPath(p, { follow: true }).path; } catch (e) { return p; } };
  const stats = { fetched: 0, bytes: 0 };
  // chamado pelo C++ (EM_ASYNC_JS web_fetch_lazy) antes de ler um arquivo
  Module.fetchLazy = async path => {
    let key = path;
    if (!lazy.has(key)) { key = realPath(path); if (!lazy.has(key)) return 0; }
    const url = lazy.get(key);
    lazy.delete(key);
    const r = await fetch(url);
    if (!r.ok) { console.warn("[r36s] lazy falhou", key, r.status); return 0; }
    const data = new Uint8Array(await r.arrayBuffer());
    FS.writeFile(key, data);
    stats.fetched++; stats.bytes += data.length;
    return 1;
  };
  return { files: Object.keys(manifest.files).length, lazy: lazy.size, stats };
}
