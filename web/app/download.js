// ⬇ ROM: salva o arquivo da ROM (para outro emulador ou para o R36S de verdade). Hub/demo: link direto. Drive: até
// BLOB_MAX baixa aqui (com o token no cabeçalho, progresso e cancelar); acima, abre a página do arquivo no Google
// Drive, que baixa sem passar pela memória do celular. O token nunca vai em URL.
const BLOB_MAX = 100 << 20;

function save(href, name) {
  const a = document.createElement("a");
  a.href = href; a.download = name; a.rel = "noopener"; a.style.display = "none";
  document.body.append(a); a.click(); a.remove();
}

// -> "link" | "blob" | "drive"
export async function downloadRom(io, g, onProgress, signal) {
  const name = g.rom.slice(g.rom.lastIndexOf("/") + 1);
  if (io.backend !== "drive") { save(io.romUrl(g.rom), name); return "link"; }
  if (!g.id) throw new Error("a biblioteca não tem o ID deste arquivo (gere o índice de novo)");
  if (g.size > BLOB_MAX) {
    // sem "noopener" no open: com ele o retorno é sempre null e não dá para saber se o pop-up foi bloqueado
    const w = window.open(`https://drive.google.com/file/d/${encodeURIComponent(g.id)}/view`, "_blank");
    if (!w) throw new Error("o navegador bloqueou a aba: toque no botão de novo ou permita pop-ups");
    w.opener = null;
    return "drive";
  }
  const r = await io.drive.media(g.id, { signal });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const total = Number(r.headers.get("Content-Length")) || g.size;
  const parts = [];
  let got = 0;
  if (r.body && r.body.getReader) {
    const rd = r.body.getReader();
    for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); got += value.length; onProgress(got, total); }
  } else parts.push(new Uint8Array(await r.arrayBuffer()));
  const url = URL.createObjectURL(new Blob(parts, { type: "application/octet-stream" }));
  save(url, name);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return "blob";
}
