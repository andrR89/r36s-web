// Favoritos e jogados recentemente, só neste aparelho (localStorage; sem ele, nada é lembrado mas nada quebra)
const KEY = "r36s-prefs-v1", MAX_RECENT = 20;
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };
const write = p => { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) {} };

export function load() {
  const p = read();
  return { fav: Array.isArray(p.fav) ? p.fav : [], recent: Array.isArray(p.recent) ? p.recent : [] };
}
export const isFav = rom => load().fav.includes(rom);
// liga/desliga; devolve se ficou favorito
export function toggleFav(rom) {
  const p = load(), i = p.fav.indexOf(rom);
  if (i < 0) p.fav.unshift(rom); else p.fav.splice(i, 1);
  write(p);
  return i < 0;
}
export function played(rom) {
  const p = load();
  p.recent = [rom, ...p.recent.filter(r => r !== rom)].slice(0, MAX_RECENT);
  write(p);
}
