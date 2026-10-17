// node tests/drive_boot.mjs [url do site]
// Mede o boot do ES no modo Drive com a biblioteca REAL (pasta R36S do andre): usa o token do remote "gdrive" do rclone
// (escopo drive, só leitura aqui — não abre jogo, não grava save). O token fica só no navegador do teste, nunca no log.
// Saída: tempo até o ES pronto e até desenhar, quantos arquivos vieram sob demanda (lazy) e quanto tempo levaram.
import { chromium } from "/home/andre/Workspace/web-ports/tools/pw/node_modules/playwright-core/index.mjs";
import { execFileSync, execSync } from "node:child_process";
const rssBy = () => execSync(`ps -eo rss,cmd | grep -E 'chromium' | grep -v grep | sed -E 's/.*--type=([a-z-]+).*/\\1/;t;s/.*/browser/' | sort | uniq -c | head -0; ps -eo rss,args | grep chromium | grep -v grep | awk '{t="browser"; for(i=2;i<=NF;i++) if ($i ~ /^--type=/) t=substr($i,8); s[t]+=$1} END {for (k in s) printf "%s=%dMB ", k, s[k]/1024}'`).toString().trim();
const site = (process.argv[2] || "http://localhost:8770/r36s/site/").replace(/\/?$/, "/");
const token = JSON.parse(JSON.parse(execFileSync("rclone", ["config", "dump"]).toString()).gdrive.token).access_token;
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-logging=stderr", "--v=0"], ...(process.env.DUMPIO ? { logger: undefined } : {}) });
const c = await browser.newContext({ viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true });
await c.addInitScript(tok => {
  window.R36S_CONFIG = { auth: "mock", mockToken: tok };
  const orig = HTMLCanvasElement.prototype.getContext;   // para ler os pixels do canvas do ES
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    if (/webgl/.test(type)) attrs = Object.assign({}, attrs, { preserveDrawingBuffer: true });
    return orig.call(this, type, attrs);
  };
}, token);
const p = await c.newPage();
p.on("crash", () => console.log("PÁGINA CAIU (crash) em", Date.now() - t0, "ms"));
p.on("close", () => console.log("página fechou"));
browser.on("disconnected", () => console.log("navegador desconectou"));
const t0 = Date.now(), reqs = [];
const cdp = await c.newCDPSession(p); await cdp.send("Performance.enable");
p.on("requestfinished", async q => {
  if (!/googleapis\.com\/drive/.test(q.url())) return;
  const t = q.timing(); const s = await q.sizes().catch(() => ({ responseBodySize: 0 }));
  reqs.push({ at: Date.now() - t0, ms: Math.round(t.responseEnd), kb: Math.round(s.responseBodySize / 1024), id: (q.url().match(/files\/([^?/]+)/) || [])[1] || q.url().slice(40, 90) });
});
p.on("console", m => { if (/r36s|lazy|erro|error/i.test(m.text())) console.log("  console:", m.text().slice(0, 400)); });
await p.goto(site + "#/entrar");
await p.click("text=Continuar com Google");
// "Jogar" da biblioteca encontrada
await p.waitForSelector("button.play-btn:not([disabled])", { timeout: 60000 }).catch(async e => { await p.screenshot({ path: "/home/andre/Workspace/web-ports/r36s/tests/out/drive-lib.png" }); console.log(await p.evaluate(() => location.hash + " " + document.body.innerText.slice(0, 400))); throw e; });
const tLib = Date.now() - t0;
await p.click("button.play-btn");
let es; for (let i = 0; i < 600 && !(es = p.frames().find(f => /\/index\.html\?backend=/.test(f.url()))); i++) await p.waitForTimeout(100);
await es.waitForFunction(() => window.r36s && window.r36s.ready, null, { timeout: 600000, polling: 500 });
const tReady = Date.now() - t0;
console.log("pronto", JSON.stringify({ tLib, tReady, driveReqs: reqs.length, kb: reqs.reduce((a, r) => a + r.kb, 0) }));
for (let i = 0; i < 3; i++) {   // memória do renderer a cada segundo (CDP)
  const m = await cdp.send("Performance.getMetrics").catch(() => null);
  const g = k => m && Math.round((m.metrics.find(x => x.name === k) || {}).value / 1e6);
  const st = await es.evaluate(() => { const r = window.r36s; const io = r.io; return io && { ...io.stats, fs: r.fsStats || null, heap: (window.Module && Module.HEAP8 ? Math.round(Module.HEAP8.length / 1e6) : null) }; }).catch(e => "erro " + e.message);
  console.log("mem", Date.now() - t0, "ms: JS", g("JSHeapUsedSize"), "MB", rssBy());
  await p.waitForTimeout(1000);
}
const io = await es.evaluate(() => window.r36s.io || window.r36s.stats || null).catch(() => null);
await p.screenshot({ path: "/home/andre/Workspace/web-ports/r36s/tests/out/drive-boot.png" });
// navegar: fecha o painel, entra no sistema (A) e desce a lista; amostra o canvas do ES a cada 100 ms
await es.evaluate(() => window.r36s.controls && window.r36s.controls.close());
const nBoot = reqs.length;
const dark = () => es.evaluate(() => { const c = document.getElementById("canvas"); const g = document.createElement("canvas");
  g.width = 160; g.height = 120; const x = g.getContext("2d"); x.drawImage(c, 0, 0, 160, 120); const d = x.getImageData(0, 0, 160, 120).data;
  let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 30) n++; return +(n / (d.length / 4)).toFixed(2); }).catch(() => -1);
const press = async k => { await p.keyboard.down(k); await p.waitForTimeout(120); await p.keyboard.up(k); };
await cdp.send("Debugger.enable");
if (process.env.PAUSE) {
  const rend = () => +((rssBy().match(/renderer=(\d+)MB/) || [])[1] || 0);
  const tick = setInterval(async () => {
    const r = rend(); console.log("vigia renderer", r, "MB em", Date.now() - t0, "ms");
    if (r < 5000) return;
    clearInterval(tick);
    cdp.once("Debugger.paused", ev => {
      console.log("PILHA:", ev.callFrames.slice(0, 40).map(f => (f.functionName || "?")).join(" <- "));
      process.exit(0);
    });
    await cdp.send("Debugger.pause").catch(e => console.log("pause erro", e.message));
    setTimeout(() => { console.log("não pausou"); process.exit(0); }, 15000);
  }, 1000);
}
await press("l");
await p.waitForTimeout(4000);
const samples = [], stepMs = [];
for (let i = 0; i < 12; i++) {
  const t = Date.now(); await press("s");
  // quanto tempo o ES fica "parado" (sem responder a evaluate leve) depois de descer
  await es.evaluate(() => new Promise(r => requestAnimationFrame(() => r()))).catch(() => {});
  stepMs.push(Date.now() - t);
  for (let k = 0; k < 6; k++) { if (!process.env.NOSAMPLE) samples.push(await dark()); await p.waitForTimeout(100); }
  console.log("nav", i, Date.now() - t0, "ms", rssBy());
}
await p.screenshot({ path: "/home/andre/Workspace/web-ports/r36s/tests/out/drive-lista.png" });
const nav = reqs.slice(nBoot);
const big = reqs.filter(r => r.kb > 500), small = reqs.filter(r => r.kb <= 500);
const sum = a => a.reduce((s, r) => s + r.ms, 0);
console.log(JSON.stringify({ tLib, tReady, drive: reqs.length, grandes: big.map(r => `${r.kb} KB em ${r.ms} ms`),
  pequenos: { n: small.length, msTotal: sum(small), msMedia: Math.round(sum(small) / (small.length || 1)) }, io,
  nav: { reqs: nav.length, ms: nav.map(r => r.ms), kb: nav.map(r => r.kb) }, stepMs, escuro: samples.filter(v => v < 0.05).length + "/" + samples.length, samples }, null, 1));
await browser.close();
