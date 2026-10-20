// Acesso à biblioteca cifrada: o backend da biblioteca (Supabase h-games-web, função "r36s") confere o login do Google
// e devolve o ponteiro do índice no Drive e as chaves que esta conta pode usar (catálogo, BIOS, um por sistema),
// embrulhadas para um par ECDH feito agora. As chaves ficam só em memória (nunca em storage nem URL).
import { novoPar, desembrulharCru } from "../cripto.js";

// -> {id, name, kind, owner, index: {library, manifest, eager, sistemas, info}, sistemas, keys: {nome: Uint8Array}}
// erro: {status: 401 | 403 | 404 | 5xx, pedido: {status} | null}
export async function biblioteca({ funcoes, token, fetch = globalThis.fetch }) {
  const { privada, publica } = await novoPar();
  const r = await fetch(`${funcoes}/r36s`, { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
                                             body: JSON.stringify({ publica }) });
  const corpo = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(`chaves HTTP ${r.status}`), { status: r.status, pedido: corpo.pedido || null });
  const keys = {};
  for (const [nome, emb] of Object.entries(corpo.chaves || {})) keys[nome] = await desembrulharCru(privada, emb);
  return { id: "r36s", name: "R36S", kind: "shared", owner: { displayName: "André" }, index: corpo.indice, sistemas: corpo.sistemas || [], keys };
}

// pedido de acesso (mesma tabela da biblioteca; o dono aprova no admin.html dela) -> "pendente" | "aprovado"
export async function pedirAcesso({ funcoes, token, nome, mensagem, fetch = globalThis.fetch }) {
  const r = await fetch(`${funcoes}/conta?op=pedir`, { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
                                                       body: JSON.stringify({ nome, mensagem }) });
  if (!r.ok) throw Object.assign(new Error(`pedido HTTP ${r.status}`), { status: r.status });
  return (await r.json()).status;
}
