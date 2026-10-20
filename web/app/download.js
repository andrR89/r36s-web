// ⬇ ROM: salva o arquivo da ROM (para outro emulador ou para o R36S de verdade). Hub/demo: link direto. Drive
// (biblioteca cifrada): o io baixa e decifra em pedaços de 8 MB; até BLOB_MAX junta num blob; acima, grava direto no
// disco onde o navegador deixa escolher o arquivo (showSaveFilePicker, PC); no celular, acima disso, não dá.
const BLOB_MAX = 100 << 20;

function save(href, name) {
  const a = document.createElement("a");
  a.href = href; a.download = name; a.rel = "noopener"; a.style.display = "none";
  document.body.append(a); a.click(); a.remove();
}

// -> "link" | "blob" | "arquivo"
export async function downloadRom(io, g, onProgress, signal) {
  const name = g.rom.slice(g.rom.lastIndexOf("/") + 1);
  if (io.backend !== "drive") { save(io.romUrl(g.rom), name); return "link"; }
  if (g.size > BLOB_MAX && !window.showSaveFilePicker)
    throw new Error("arquivo grande demais para baixar pelo navegador do celular (mais de 100 MB)");
  let got = 0;
  if (g.size > BLOB_MAX) {
    const h = await window.showSaveFilePicker({ suggestedName: name });
    const w = await h.createWritable();
    try {
      for await (const p of io.lerPedacos(g.rom, { signal })) { await w.write(p); got += p.length; onProgress(got, g.size); }
      await w.close();
    } catch (e) { await w.abort().catch(() => {}); throw e; }
    return "arquivo";
  }
  const parts = [];
  for await (const p of io.lerPedacos(g.rom, { signal })) { parts.push(p); got += p.length; onProgress(got, g.size); }
  const url = URL.createObjectURL(new Blob(parts, { type: "application/octet-stream" }));
  save(url, name);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return "blob";
}
