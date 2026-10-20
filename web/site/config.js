// Configuração pública do site (nada secreto: o Client ID OAuth é público por natureza; fonte: config/google.json).
// window.R36S_CONFIG (definido antes deste módulo) sobrepõe os valores — os testes usam isso para apontar a API
// para o mock do Drive (tests/mock_drive.py) e trocar o login do Google por um token falso.
const defaults = {
  googleClientId: "744452506858-bc5ddj07lucb2kqgpcr8t7svfdmrfu1s.apps.googleusercontent.com",
  scopes: "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file",
  api: "https://www.googleapis.com",
  gisScript: "https://accounts.google.com/gsi/client",
  auth: "google",          // "google" | "mock" (testes: devolve mockToken sem abrir o Google)
  mockToken: "",
  // backend da biblioteca (Supabase h-games-web): função r36s (chaves) e conta?op=pedir (pedido de acesso)
  funcoes: "https://grymbzwpukgauwoyttqc.supabase.co/functions/v1",
};
export default Object.assign({}, defaults, window.R36S_CONFIG || {});
