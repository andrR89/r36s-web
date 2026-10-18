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
  const stats = { fetched: 0, bytes: 0, frozen: 0 };
  const freeze = freezer(Module);
  // chamado pelo C++ (EM_ASYNC_JS web_fetch_lazy) antes de ler um arquivo
  Module.fetchLazy = async path => {
    let key = path;
    if (!lazy.has(key)) { key = realPath(path); if (!lazy.has(key)) return 0; }
    const url = lazy.get(key);
    lazy.delete(key);
    if (freeze.show()) stats.frozen++;   // vai ceder ao navegador no meio do quadro: mostra o último quadro inteiro
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

// Busca sob demanda no meio de um quadro: o ES cede ao navegador com o quadro pela metade (já limpo, sem o fundo) e o
// navegador mostra isso — a tela pisca preta enquanto a capa chega do Drive. O ES avisa a cada quadro completo
// (Module.r36sFrameDone, em web_wait_frame); aqui fica uma cópia dele num canvas 2D por cima, mostrada só enquanto uma
// busca está pendente, e escondida no quadro completo seguinte.
function freezer(Module) {
  const gl = Module.canvas;
  let snap = null, ctx = null, has = false, shown = false;
  const place = () => {
    if (!snap) {
      snap = document.createElement("canvas");
      snap.id = "r36s-freeze";
      snap.style.cssText = "position:fixed;pointer-events:none;display:none;z-index:1;margin:0";
      ctx = snap.getContext("2d", { alpha: false });
      gl.after(snap);
    }
    const r = gl.getBoundingClientRect();
    Object.assign(snap.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
  };
  let broken = false;
  Module.r36sFrameDone = () => {
    if (broken) return;
    try {
      if (window.r36s && window.r36s.game) { has = false; return; }   // com jogo aberto o ES não desenha
      if (!gl.width || !gl.height) return;
      if (!snap) place();
      if (snap.width !== gl.width || snap.height !== gl.height) { snap.width = gl.width; snap.height = gl.height; }
      ctx.drawImage(gl, 0, 0);   // mesmo task do quadro: o drawing buffer ainda está inteiro
      has = true;
      if (shown) { shown = false; snap.style.display = "none"; }
    } catch (e) {
      // algum navegador recusou a cópia: desliga (volta a piscar, mas o ES segue)
      broken = true; has = false;
      if (snap) snap.style.display = "none";
      console.warn("[r36s] cópia do quadro desligada:", e);
    }
  };
  return {
    show() {
      if (broken || !has || shown) return false;
      place(); snap.style.display = "block"; shown = true;
      return true;
    },
  };
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
