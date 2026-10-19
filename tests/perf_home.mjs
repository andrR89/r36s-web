// node tests/perf_home.mjs [url]
// Critérios da spec: primeira tela no celular simulado com < 1 MB transferido fora as imagens e sem pedir o manifest
// antes de aparecer; rolar a grade do maior sistema sem quadros longos (> 100 ms) demais.
// Extras (só informação): heap do JS e nós do DOM depois de rolar a grade, maiores pedidos antes da primeira tela.
import { chromium } from "/home/andre/Workspace/web-ports/tools/pw/node_modules/playwright-core/index.mjs";
const url = process.argv[2] || "http://localhost:8770/r36s/";
const b = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--enable-precise-memory-info"] });
const c = await b.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2.6 });
const p = await c.newPage();
const cdp = await c.newCDPSession(p);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });   // celular médio
const isImg = u => /\.(png|jpe?g|webp|gif)(\?|$)/i.test(u) || u.startsWith("blob:") || u.startsWith("data:");
// hora de início vem do evento "request" (um pedido feito antes da tela conta mesmo se terminar depois);
// o tamanho vem do requestfinished (r.sizes() é assíncrono: a hora é guardada antes de esperar por ele)
const started = [], reqs = [];
p.on("request", r => started.push({ url: r.url(), t: Date.now() }));
p.on("requestfinished", async r => {
  const e = { url: r.url(), t: Date.now(), bytes: 0 }; reqs.push(e);
  const s = await r.sizes().catch(() => null); if (s) e.bytes = s.responseBodySize + s.responseHeadersSize;
});
const t0 = Date.now();
await p.goto(url);
await p.waitForFunction(() => window.r36s && window.r36s.ready, null, { timeout: 60000, polling: 50 });
const tReady = Date.now();
// readyMs conta do início do main.js; navReadyMs, do início da navegação
const { readyMs, navReadyMs } = await p.evaluate(() => ({ readyMs: window.r36s.readyMs, navReadyMs: Math.round(window.r36s.t0 + window.r36s.readyMs) }));
await p.waitForTimeout(300);   // deixa os sizes() dos pedidos já terminados chegarem
const before = reqs.filter(r => r.t <= tReady);
const nonImg = before.filter(r => !isImg(r.url));
const kb = Math.round(nonImg.reduce((a, r) => a + r.bytes, 0) / 1024);
const manifestEarly = started.filter(r => r.t <= tReady).some(r => /manifest\.json|eager\.bin/.test(r.url));
const top = nonImg.sort((a, b) => b.bytes - a.bytes).slice(0, 5).map(r => `${r.url.replace(url, "")} ${Math.round(r.bytes / 1024)}K`);
// maior sistema: rolar a grade inteira
const sys = await p.evaluate(() => [...document.querySelectorAll(".row[data-sys] .more")].map(a => [a.getAttribute("href").split("/s/")[1], +a.textContent.replace(/\D/g, "")]).sort((a, b) => b[1] - a[1])[0][0]);
await p.goto(`${url}#/s/${sys}`); await p.waitForTimeout(1500);
const scroll = await p.evaluate(async () => {
  // longtask não pega o trabalho de desenho fora das tarefas; long-animation-frame (LoAF) pega o quadro inteiro
  const n = { longtask: 0, "long-animation-frame": 0 }; let worst = 0;
  const obs = new PerformanceObserver(l => { for (const e of l.getEntries()) { worst = Math.max(worst, e.duration); if (e.duration > 100) n[e.entryType]++; } });
  obs.observe({ entryTypes: ["longtask", "long-animation-frame"] });
  const t = performance.now(); let steps = 0;
  for (let y = 0; y < document.documentElement.scrollHeight; y += 600) { scrollTo(0, y); steps++; await new Promise(r => requestAnimationFrame(() => setTimeout(r, 30))); }
  await new Promise(r => setTimeout(r, 300));
  obs.disconnect();
  return { long: Math.max(n.longtask, n["long-animation-frame"]), longtasks: n.longtask, loaf: n["long-animation-frame"], worstMs: Math.round(worst), steps, ms: Math.round(performance.now() - t), bottom: scrollY + innerHeight >= document.documentElement.scrollHeight - 700 };
});
const covers = await p.evaluate(() => document.querySelectorAll(".grid .cover").length);
const domNodes = await p.evaluate(() => document.getElementsByTagName("*").length);
await cdp.send("HeapProfiler.collectGarbage").catch(() => {});
const heap = await cdp.send("Runtime.getHeapUsage");
const jsHeapMB = await p.evaluate(() => +(performance.memory.usedJSHeapSize / 1048576).toFixed(1));
const ok = kb < 1024 && !manifestEarly && scroll.long <= 5 && scroll.bottom;
console.log(JSON.stringify({ ok, readyMs, navReadyMs, wallReadyMs: tReady - t0, kbBeforeReady: kb, manifestEarly, top, system: sys, covers,
  longTasks: scroll.long, longtaskEntries: scroll.longtasks, loafEntries: scroll.loaf, worstTaskMs: scroll.worstMs, scrollSteps: scroll.steps, scrollMs: scroll.ms, reachedBottom: scroll.bottom,
  domNodes, heapUsedMB: +(heap.usedSize / 1048576).toFixed(1), heapTotalMB: +(heap.totalSize / 1048576).toFixed(1), jsHeapMB }));
await b.close();
process.exit(ok ? 0 : 1);
