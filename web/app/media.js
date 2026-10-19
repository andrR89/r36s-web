// Capas e prints sob demanda: a imagem só é pedida quando o elemento fica perto da tela (400 px) por DELAY ms (rolagem
// rápida não dispara downloads). Hub/demo: URL direta (cache HTTP); Drive: blob com o token (io.image), um por imagem,
// dividido entre as <img> que a mostram e revogado quando a última sai (release, ao trocar de tela).
const DELAY = 150;
const key = ref => (typeof ref === "string" ? ref : ref.id);

export function createMedia(io) {
  const urls = new Map();   // chave -> { p: Promise<url>, n: <img> que usam }
  const take = ref => {
    const k = key(ref);
    let u = urls.get(k);
    if (!u) {
      u = { n: 0, p: io.image(ref) };
      u.p.catch(() => { if (urls.get(k) === u) urls.delete(k); });
      urls.set(k, u);
    }
    u.n++;
    return u.p;
  };
  const drop = ref => {
    const k = key(ref), u = urls.get(k);
    if (!u || --u.n > 0) return;
    urls.delete(k);
    u.p.then(url => { if (url.startsWith("blob:")) URL.revokeObjectURL(url); }, () => {});
  };
  const obs = new IntersectionObserver(entries => {
    for (const e of entries) {
      const img = e.target;
      clearTimeout(img._t);
      if (e.isIntersecting) img._t = setTimeout(() => { if (img.isConnected && img._ref && !img._took) show(img); }, DELAY);
    }
  }, { rootMargin: "400px" });
  async function show(img) {
    obs.unobserve(img);
    img._took = true;
    try { const url = await take(img._ref); if (img._took) img.src = url; } catch (e) { img.classList.add("fail"); }
  }
  return {
    // <img> que carrega ao aparecer; sem imagem (ou se falhar) fica invisível e aparece o nome atrás
    img(ref, cls = "") {
      const i = document.createElement("img");
      i.className = cls; i.alt = ""; i.decoding = "async"; i.draggable = false;
      i.addEventListener("error", () => i.classList.add("fail"));
      if (ref) { i._ref = ref; obs.observe(i); } else i.classList.add("fail");
      return i;
    },
    // a tela (ou a ficha) vai sair: para de observar e solta as imagens dela
    release(root) {
      if (!root) return;
      for (const i of root.querySelectorAll("img")) {
        if (!i._ref) continue;
        obs.unobserve(i); clearTimeout(i._t);
        if (i._took) { i._took = false; drop(i._ref); }
      }
    },
  };
}
