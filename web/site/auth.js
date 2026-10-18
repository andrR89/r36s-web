// Login com Google Identity Services (token client, popup). O token de acesso fica só em memória — recarregar a
// página pede "Entrar" de novo (o Google não pergunta de novo se já consentiu). Renovação: requestAccessToken com
// prompt vazio (silenciosa quando o consentimento existe), antes de vencer e quando a API responde 401.
// Sem toque na tela o navegador bloqueia o popup (no celular, às vezes sem avisar e a promessa nunca volta): se a
// renovação silenciosa não volta em SILENT_MS, cfg.askGesture(renew) pede um toque e renova dentro dele.
// Modo "mock" (testes): token fixo, sem rede.

const SKEW = 120;   // s: renova 2 min antes de vencer
const SILENT_MS = 8000;

export function createAuth(cfg) {
  let token = "", expiresAt = 0, hint = "", client = null, pending = null, gesture = null;
  const listeners = new Set();
  const emit = () => { for (const f of listeners) f(!!token); };

  function loadGis() {
    if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = cfg.gisScript; s.async = true; s.onload = () => resolve(); s.onerror = () => reject(new Error("não deu para carregar o login do Google"));
      document.head.append(s);
    });
  }

  function request(prompt, timeoutMs = 0) {
    if (cfg.auth === "mock") {
      token = cfg.mockToken; expiresAt = Date.now() / 1000 + (cfg.mockExpiresIn || 3600); emit();
      return Promise.resolve(token);
    }
    if (pending) return pending;
    pending = loadGis().then(() => new Promise((resolve, reject) => {
      if (!client) client = google.accounts.oauth2.initTokenClient({ client_id: cfg.googleClientId, scope: cfg.scopes, callback: () => {} });
      client.callback = r => {
        if (r.error) return reject(new Error(r.error_description || r.error));
        if (!google.accounts.oauth2.hasGrantedAllScopes(r, ...cfg.scopes.split(" ")))
          return reject(new Error("o site precisa das duas permissões (ler a pasta R36S e gravar os saves)"));
        token = r.access_token; expiresAt = Date.now() / 1000 + Number(r.expires_in || 3600);
        emit(); resolve(token);
      };
      client.error_callback = e => reject(new Error(e && e.type === "popup_closed" ? "janela do Google fechada" : (e && e.message) || "login cancelado"));
      client.requestAccessToken({ prompt, login_hint: hint || undefined });
      if (timeoutMs) setTimeout(() => reject(new Error("o Google não respondeu (popup bloqueado?)")), timeoutMs);
    })).finally(() => { pending = null; });
    return pending;
  }

  // renovação: silenciosa; se falhar, um toque do usuário (uma pergunta só para todos que esperam o token)
  async function renew() {
    try { return await request("", cfg.silentMs || SILENT_MS); }
    catch (e) {
      if (!cfg.askGesture) throw e;
      return gesture || (gesture = cfg.askGesture(() => request("")).finally(() => { gesture = null; }));
    }
  }

  // renovação antecipada: com a aba aberta, um pouco antes de vencer
  setInterval(() => { if (token && cfg.auth !== "mock" && expiresAt - Date.now() / 1000 < SKEW * 2) request("", SILENT_MS).catch(() => {}); }, 60000);

  return {
    get signedIn() { return !!token; },
    onChange(f) { listeners.add(f); },
    setHint(email) { hint = email || ""; },
    signIn() { return request(""); },
    async getToken(force) {
      if (token && !force && expiresAt - Date.now() / 1000 > SKEW) return token;
      if (!token && !force) throw Object.assign(new Error("não logado"), { status: 401 });
      return renew();
    },
    peekToken: () => token,
    signOut() {
      const t = token; token = ""; expiresAt = 0; emit();
      if (t && cfg.auth !== "mock" && window.google && google.accounts) try { google.accounts.oauth2.revoke(t, () => {}); } catch (e) {}
    },
  };
}
