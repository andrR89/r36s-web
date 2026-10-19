// Capas e prints sob demanda: a imagem só é pedida quando o elemento chega perto da tela (400 px). Hub/demo: URL
// direta (cache HTTP); Drive: blob com o token (io.image), uma vez por imagem.
export function createMedia(io) {
  const urls = new Map();   // ref -> Promise<url>
  const urlOf = ref => {
    const k = typeof ref === "string" ? ref : ref.id;
    if (!urls.has(k)) urls.set(k, io.image(ref).catch(e => { urls.delete(k); throw e; }));
    return urls.get(k);
  };
  const obs = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) { obs.unobserve(e.target); show(e.target); }
  }, { rootMargin: "400px" });
  async function show(img) {
    try { img.src = await urlOf(img._ref); } catch (e) { img.classList.add("fail"); }
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
  };
}
