// node tests/mock_chaves.mjs <porta> --mestra <arquivo> --indice <indice.json>
// Backend local com o contrato da função "r36s" e de "conta?op=pedir" (o de verdade: biblioteca, supabase/functions).
// Tokens (os do tests/mock_drive.py): tok-shared = tudo, tok-own = só snes, tok-none = sem acesso (pode pedir),
// tok-both = pedido pendente. Inspeção: GET /_mock/pedidos.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import * as C from "../web/cripto.js";

const args = process.argv.slice(2), opt = n => args[args.indexOf(n) + 1];
const porta = Number(args[0]);
const mestra = new Uint8Array(Buffer.from(readFileSync(opt("--mestra"), "utf8").trim(), "base64"));
const indice = JSON.parse(readFileSync(opt("--indice"), "utf8"));
const PODE = { "tok-shared": ["*"], "tok-own": ["snes"] };
const pedidos = { "tok-both": "pendente" };
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };

createServer(async (req, res) => {
  const fim = (status, corpo) => { res.writeHead(status, { ...cors, "Content-Type": "application/json" }); res.end(JSON.stringify(corpo)); };
  if (req.method === "OPTIONS") return res.writeHead(204, cors), res.end();
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/_mock/pedidos") return fim(200, pedidos);
  const tok = (req.headers.authorization || "").replace(/^Bearer /, "");
  if (!tok.startsWith("tok-")) return fim(401, { error: "login" });
  let corpo = "";
  for await (const c of req) corpo += c;
  const dados = corpo ? JSON.parse(corpo) : {};
  if (url.pathname.endsWith("/conta") && url.searchParams.get("op") === "pedir") return fim(200, { status: (pedidos[tok] = "pendente") });
  if (!url.pathname.endsWith("/r36s")) return fim(404, { error: "op" });
  const pode = PODE[tok];
  if (!pode) return fim(403, { error: "acesso", pedido: pedidos[tok] ? { status: pedidos[tok] } : null });
  const sistemas = pode.includes("*") ? indice.sistemas : indice.sistemas.filter(s => pode.includes(s));
  const chaves = {};
  for (const n of ["catalogo", "bios", ...sistemas.map(s => "sistema:" + s)]) chaves[n] = await C.embrulhar(await C.derivar(mestra, n), dados.publica);
  fim(200, { indice, sistemas, chaves });
}).listen(porta, "127.0.0.1", () => console.log(`mock_chaves em ${porta}`));
