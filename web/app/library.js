// Biblioteca do seletor: data/library.json.gz (gerado por data/mkmanifest.py) com índice por sistema, busca sem acento e
// ordens. Puro (testes em tests/test_app.mjs).
export const norm = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const byName = (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
export function sortGames(list, order = "az") {
  const l = list.slice();
  if (order === "ano") l.sort((a, b) => (a.year || 9999) - (b.year || 9999) || byName(a, b));
  else l.sort(byName);
  return l;
}

export function createLibrary(data) {
  const systems = data.systems.filter(s => s.count > 0);
  const byId = new Map(systems.map(s => [s.id, s]));
  const games = data.games.map(g => ({ ...g, key: norm(g.name) }));
  const bySystem = new Map(systems.map(s => [s.id, []]));
  for (const g of games) if (bySystem.has(g.s)) bySystem.get(g.s).push(g);
  // congeladas: a mesma lista volta em toda chamada (sem cópia); quem precisar mudar a ordem copia antes
  for (const [id, l] of bySystem) bySystem.set(id, Object.freeze(sortGames(l)));
  const byRom = new Map(games.map(g => [g.rom, g]));
  return {
    systems,
    total: games.length,
    system: id => byId.get(id) || null,
    byRom: rom => byRom.get(rom) || null,
    games: (id, order = "az") => (order === "az" ? bySystem.get(id) || [] : sortGames(bySystem.get(id) || [], order)),
    // todas as palavras em qualquer parte do nome; quem começa com a primeira palavra vem antes
    search(q, limit = 200) {
      const words = norm(q).split(/\s+/).filter(Boolean);
      if (!words.length) return [];
      const hit = games.filter(g => words.every(w => g.key.includes(w)));
      const starts = g => (g.key.startsWith(words[0]) ? 0 : 1);
      return hit.sort((a, b) => starts(a) - starts(b) || byName(a, b)).slice(0, limit);
    },
  };
}
