// node tests/drive_boot.mjs [url do site]
// Mede o boot do seletor no modo Drive com a biblioteca REAL (pasta R36S do andre): usa o token do remote "gdrive" do rclone
// (escopo drive, só leitura aqui — não abre jogo, não grava save). O token fica só no navegador do teste, nunca no log.
// Saída: tempo até o seletor pronto (readyMs dele e do teste) e até as primeiras capas do Drive aparecerem, quantos
// pedidos ao Drive e quanto tempo levaram; depois desce as fileiras com S (como o controle) e mede capas e pedidos.
// ATENÇÃO (biblioteca cifrada, 2026-10-20): o índice e as chaves agora vêm do backend da biblioteca (função r36s do
// Supabase h-games-web), não de pastas do Drive. Este teste só volta a valer depois da Tarefa 10 do plano
// docs/superpowers/plans/2026-10-20-acesso-cifrado.md (biblioteca cifrada no Drive, índice publicado, função no ar) e
// com uma conta aprovada lá; o token do rclone sozinho não basta (o backend recusa) e ainda costuma dar 403 de cota no
// Drive. Não rodar antes disso; o ponta a ponta local é o tests/e2e_site.mjs (Drive simulado + backend local).
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
await es.waitForFunction(() => window.r36s && (window.r36s.ready || window.r36s.error), null, { timeout: 600000, polling: 200 });
const err = await es.evaluate(() => window.r36s.error || null);
if (err) { console.log(JSON.stringify({ ok: false, erro: err, status: await es.evaluate(() => document.getElementById("status")?.textContent) })); await browser.close(); process.exit(1); }
const tReady = Date.now() - t0, readyMs = await es.evaluate(() => window.r36s.readyMs);
// capas vindas do Drive
await es.waitForFunction(() => document.querySelectorAll(".cover img[src]").length > 0, null, { timeout: 120000, polling: 200 });
const tCovers = Date.now() - t0;
console.log("pronto", JSON.stringify({ tLib, tReady, readyMs, tCovers, driveReqs: reqs.length, kb: reqs.reduce((a, r) => a + r.kb, 0) }));
for (let i = 0; i < 3; i++) {   // memória do renderer a cada segundo (CDP)
  const m = await cdp.send("Performance.getMetrics").catch(() => null);
  const g = k => m && Math.round((m.metrics.find(x => x.name === k) || {}).value / 1e6);
  console.log("mem", Date.now() - t0, "ms: JS", g("JSHeapUsedSize"), "MB", rssBy());
  await p.waitForTimeout(1000);
}
const io = await es.evaluate(() => window.r36s.io && window.r36s.io.stats || null).catch(() => null);
await p.screenshot({ path: "/home/andre/Workspace/web-ports/r36s/tests/out/drive-boot.png" });
// navegar: desce as fileiras do Início com S; conta as capas com imagem a cada passo
const nBoot = reqs.length;
const imgs = () => es.evaluate(() => document.querySelectorAll(".cover img[src]").length).catch(() => -1);
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
const samples = [], stepMs = [];
for (let i = 0; i < 12; i++) {
  const t = Date.now(); await press("s");
  // quanto tempo o seletor fica "parado" (sem responder a evaluate leve) depois de descer
  await es.evaluate(() => new Promise(r => requestAnimationFrame(() => r()))).catch(() => {});
  stepMs.push(Date.now() - t);
  await p.waitForTimeout(600);
  samples.push(await imgs());
  console.log("nav", i, Date.now() - t0, "ms", rssBy());
}
await p.screenshot({ path: "/home/andre/Workspace/web-ports/r36s/tests/out/drive-lista.png" });
const nav = reqs.slice(nBoot);
const big = reqs.filter(r => r.kb > 500), small = reqs.filter(r => r.kb <= 500);
const sum = a => a.reduce((s, r) => s + r.ms, 0);
const ok = tCovers > 0 && samples.at(-1) > 0;
console.log(JSON.stringify({ ok, tLib, tReady, readyMs, tCovers, drive: reqs.length, grandes: big.map(r => `${r.kb} KB em ${r.ms} ms`),
  pequenos: { n: small.length, msTotal: sum(small), msMedia: Math.round(sum(small) / (small.length || 1)) }, io,
  nav: { reqs: nav.length, ms: nav.map(r => r.ms), kb: nav.map(r => r.kb) }, stepMs, capasComImagem: samples }, null, 1));
await browser.close();
process.exit(ok ? 0 : 1);
