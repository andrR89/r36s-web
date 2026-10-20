// node tests/cripto_perf.mjs [url base do web/] — decifra 4 MB (o pedaço do lazyFile) síncrono e assíncrono no
// Chromium, com a CPU 4x mais lenta (aproximação do celular). Critério da spec: síncrono < 150 ms.
import { chromium } from "/home/andre/Workspace/web-ports/tools/pw/node_modules/playwright-core/index.mjs";
const base = (process.argv[2] || "http://localhost:8770/r36s/").replace(/\/?$/, "/");
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium" });
const p = await browser.newPage();
await p.goto(base + "site/");
const cdp = await p.context().newCDPSession(p);
for (const rate of [1, 4]) {
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  const r = await p.evaluate(async b => {
    const C = await import(b + "cripto.js");
    const k = crypto.getRandomValues(new Uint8Array(32)), size = 4 << 20, t = new Uint8Array(size);
    for (let i = 0; i < size; i += 65536) crypto.getRandomValues(t.subarray(i, i + 65536));
    const cif = await C.cifrarArquivo(k, t);
    const med = async f => { const ts = []; for (let n = 0; n < 5; n++) { const a = performance.now(); await f(); ts.push(performance.now() - a); } return Math.round(ts.sort((x, y) => x - y)[2]); };
    return { sync: await med(() => C.decifrarIntervaloSync(k, cif, 0, size - 1, size)), async: await med(() => C.decifrarIntervalo(k, cif, 0, size - 1, size)) };
  }, base);
  console.log(JSON.stringify({ cpu: rate + "x", msPor4MB: r }));
}
await browser.close();
