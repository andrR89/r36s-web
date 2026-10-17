// Monta o FS virtual do ES a partir de data/manifest.json + data/eager.bin (contrato: data/mkmanifest.py)
// fetch: o do navegador (hub) ou o do backend do site (web/io.js: drive/demo), com as mesmas URLs relativas
export async function bootFS(Module, fetch = globalThis.fetch.bind(globalThis)) {
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
    let data = new Uint8Array(await r.arrayBuffer());
    if (isWebP(data)) data = await webpToPng(data, key);
    FS.writeFile(key, data);
    stats.fetched++; stats.bytes += data.length;
    return 1;
  };
  return { files: Object.keys(manifest.files).length, lazy: lazy.size, stats, manifest };   // manifest: o player usa (pastas, BIOS)
}

// capas WebP com extensão .png (scraper): o FreeImage do aparelho lê, o stb_image do ES web não -> o navegador converte
const isWebP = d => d.length > 12 && d[0] === 0x52 && d[1] === 0x49 && d[2] === 0x46 && d[3] === 0x46 && d[8] === 0x57 && d[9] === 0x45 && d[10] === 0x42 && d[11] === 0x50;
async function webpToPng(data, path) {
  try {
    const bmp = await createImageBitmap(new Blob([data], { type: "image/webp" }));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    c.getContext("2d").drawImage(bmp, 0, 0);
    bmp.close();
    return new Uint8Array(await (await c.convertToBlob({ type: "image/png" })).arrayBuffer());
  } catch (e) { console.warn("[r36s] WebP não convertido", path, e); return data; }
}
