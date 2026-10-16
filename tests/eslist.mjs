// Posições no ES do cartão real, para os testes navegarem só com teclado:
//  carouselIndex(sistema): posição no carrossel (0 = coleção Favoritos; depois os sistemas visíveis na ordem do
//    es_systems.cfg — data/mkcores.py grava "order"/"hidden" em web/data/cores.json)
//  gameIndex(sistema, arquivo): posição do jogo na lista do sistema, como o FileSorts::compareName do ES ordena
//    (pastas primeiro; nome do gamelist.xml ou o nome do arquivo sem extensão; sem diferenciar maiúsculas)
import { readFileSync } from "node:fs";
const R = new URL("..", import.meta.url).pathname;
const cores = JSON.parse(readFileSync(`${R}web/data/cores.json`));
const manifest = JSON.parse(readFileSync(`${R}web/data/manifest.json`));

export function carouselIndex(system) {
  const visible = Object.entries(cores.systems).filter(([, s]) => !s.hidden).sort((a, b) => a[1].order - b[1].order).map(([k]) => k);
  const i = visible.indexOf(system);
  return i < 0 ? -1 : i + 1;
}

const unxml = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const upper = s => Buffer.from(s, "utf8").toString("latin1").toUpperCase();   // compareIgnoreCase: byte a byte

export function gameIndex(system, file) {
  const dir = `/roms/${system}/`;
  const names = new Map();
  try {
    const xml = readFileSync(`${R}card/roms/${system}/gamelist.xml`, "utf8");
    for (const g of xml.matchAll(/<game>([\s\S]*?)<\/game>/g)) {
      const p = g[1].match(/<path>([\s\S]*?)<\/path>/), n = g[1].match(/<name>([\s\S]*?)<\/name>/);
      if (p && n) names.set(unxml(p[1].trim()).replace(/^\.\//, ""), unxml(n[1].trim()));
    }
  } catch (e) {}
  const games = Object.entries(manifest.files)
    .filter(([p, f]) => f.kind === "empty" && p.startsWith(dir) && !p.slice(dir.length).includes("/"))
    .map(([p]) => p.slice(dir.length))
    .map(f => ({ f, name: names.get(f) ?? f.slice(0, f.lastIndexOf(".")) }));
  games.sort((a, b) => (upper(a.name) < upper(b.name) ? -1 : upper(a.name) > upper(b.name) ? 1 : 0));
  return games.findIndex(g => g.f === file);
}
