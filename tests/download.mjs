// node tests/download.mjs
// ⬇ ROM no hub: o arquivo baixado é igual ao do cartão. No Drive (mock): ROM pequena vira blob com o nome original;
// acima de 100 MB abre a página do arquivo no Google Drive numa aba nova (sem segurar o arquivo na memória);
// se o navegador bloqueia a aba (window.open -> null), o erro avisa o usuário.
import { chromium } from "/home/andre/Workspace/web-ports/tools/pw/node_modules/playwright-core/index.mjs";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
const b = await chromium.launch({ executablePath: "/usr/bin/chromium" });
const c = await b.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 800 } });
const p = await c.newPage();
await p.goto("http://localhost:8770/r36s/#/s/gbc");
await p.waitForFunction(() => window.r36s && window.r36s.ready, null, { timeout: 60000 });
const rom = await p.evaluate(() => document.querySelector(".cover").dataset.rom);
await p.click(".cover");
const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#sheet .rom")]);
const got = createHash("md5").update(readFileSync(await dl.path())).digest("hex");
const want = createHash("md5").update(readFileSync("/home/andre/Workspace/web-ports/r36s/card" + rom)).digest("hex");
// Drive: io falso por cima do download.js (todas as ramificações)
const drive = await p.evaluate(async () => {
  const { downloadRom } = await import("/r36s/app/download.js");
  const opened = []; const origOpen = window.open;
  // o ID vem do manifest (loadIndex), não do jogo do library.json.gz
  const manifest = { files: { "/roms/gbc/x.gbc": { size: 1234, id: "ID1" }, "/roms/psx/y.chd": { size: 300 << 20, id: "ID2" } } };
  const io = { backend: "drive", loadIndex: async () => ({ manifest, eager: new Uint8Array(0) }),
               drive: { media: async () => new Response(new Uint8Array(1234)) } };
  const bigG = { rom: "/roms/psx/y.chd", size: 300 << 20 };
  window.open = (u) => { opened.push(u); return { opener: 1 }; };
  const small = await downloadRom(io, { rom: "/roms/gbc/x.gbc", size: 1234 }, () => {});
  const big = await downloadRom(io, bigG, () => {});
  window.open = (u) => { opened.push(u); return null; };
  let blocked = null;
  try { await downloadRom(io, bigG, () => {}); } catch (e) { blocked = String(e.message); }
  window.open = origOpen;
  return { small, big, opened, blocked };
});
const ok = got === want && drive.small === "blob" && drive.big === "drive"
  && drive.opened[0] === "https://drive.google.com/file/d/ID2/view" && /bloqueou a aba/.test(drive.blocked || "");
console.log(JSON.stringify({ ok, rom, name: dl.suggestedFilename(), same: got === want, drive }));
await b.close();
process.exit(ok ? 0 : 1);
