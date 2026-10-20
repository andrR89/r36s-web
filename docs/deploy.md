# Publicar o R36S Web (Netlify + Google Drive)

> Cada passo que mexe em serviço externo (Netlify, Google Cloud, Drive, Supabase) só com o ok do andre. O site já funciona local: `http://localhost:8770/r36s/site/` (hub, porta 8770).

## Como as peças se encaixam

A biblioteca no Drive é **cifrada** (spec `docs/superpowers/specs/2026-10-20-acesso-cifrado-design.md`): quem vê a
pasta não descobre nem os nomes dos jogos. Quem entrega as chaves é o backend da biblioteca
(`~/Workspace/web-ports/biblioteca`, Supabase `h-games-web`).

```
Netlify (estático, dist/)          Google Drive do andre                  Supabase h-games-web (backend da biblioteca)
  /site/      home, login            R36S-dados/  arquivos de nome opaco    função r36s: confere o login Google e entrega
  /index.html seletor (iframe)         (ROMs, BIOS, capas, miniaturas e o     as chaves (catálogo, BIOS, uma por sistema)
  /retroarch/ RetroArch + núcleos      índice, tudo ChaCha20-Poly1305);       Vault: r36s:mestra (as chaves derivam dela)
  /site/demo/ homebrews livres         link "qualquer pessoa: leitor"         r36s_indice: onde está o índice no Drive
                                                                              acesso: r36s:* | r36s:<sistema> por e-mail
Google Drive de cada jogador: R36S Web — saves/<sistema>/<arquivo> (escopo drive.file; o Drive guarda as revisões)
```

- Login: Google Identity Services (popup), escopos `drive.readonly` (ler os arquivos da pasta por ID) e `drive.file`
  (os saves). Token só em memória. Com o token, o site chama a função `r36s` e recebe o ponteiro do índice e as chaves
  (embrulhadas por ECDH; ficam só em memória).
- Leitura: `GET https://www.googleapis.com/drive/v3/files/<id>?alt=media` com `Range` (blocos cifrados de 1 MiB); o
  `web/io.js` decifra. O player lê arquivos grandes sob demanda com `io.readSync` (XHR síncrono + ChaCha20).
- Código: `web/cripto.js` (formato), `web/site/acesso.js` (backend), `web/drive.js` (API do Drive), `web/io.js`
  (traduz `fs/`, `saves/`, `data/` para o Drive), `web/site/` (telas), `web/controls.js` (comandos, toque, controles).

## 1. Google Cloud: origem autorizada e usuários de teste (console, projeto `r36s-web`)

Client ID: `744452506858-bc5ddj07lucb2kqgpcr8t7svfdmrfu1s.apps.googleusercontent.com` (público; `config/google.json`,
`web/site/config.js`).

1. **APIs e serviços → Credenciais → o Client ID (Aplicativo da Web) → Origens JavaScript autorizadas**: hoje só
   `http://localhost:8770`. Adicionar a URL do Netlify **exata**, sem barra no fim, ex. `https://r36s-web.netlify.app`
   (e o domínio próprio, se houver). Não precisa de URI de redirecionamento (o token client usa popup).
   Se for testar pelo túnel do Tailscale, adicionar também `https://<máquina>.<tailnet>.ts.net`.
2. **Tela de consentimento OAuth → Público-alvo**: app em modo *Teste* → **Usuários de teste**: adicionar o e-mail de
   cada pessoa da família (máx. 100). Quem não estiver na lista recebe "acesso bloqueado". Conferir que os dois escopos
   (`.../auth/drive.readonly`, `.../auth/drive.file`) estão declarados e **salvar**. Como `drive.readonly` é escopo
   restrito, o app não verificado mostra o aviso "Este app não foi verificado" — a tela de login já explica
   (Avançado → Acessar R36S Web).
3. Atualizar `config/google.json` (`authorizedOrigins`) para registrar o que foi adicionado.

## 2. Backend (uma vez; repositório da biblioteca, só com o ok do andre)

```bash
cd ~/Workspace/web-ports/biblioteca
tools/publicar.sh r36s-migrar                    # tabela r36s_indice e funções (migração 0003)
tools/publicar.sh funcoes                        # Edge Functions chave, jogadas, conta e r36s
cd ~/Workspace/web-ports/r36s && node data/cifrar.mjs mestra   # ~/.config/r36s/mestra (600): GUARDAR UMA CÓPIA
cd ~/Workspace/web-ports/biblioteca && tools/publicar.sh r36s-chave   # a mestra no Vault
```

Sem a mestra, a biblioteca no Drive não abre mais: guardar cópia num lugar seguro.

## 3. Cifrar e subir a biblioteca (`build/upload/sobe.sh`, fora do git)

O cartão montado (`/run/media/andre/EASYROMS`, só leitura) é lido pela árvore local `card/` (`data/mkcard.py`).

1. `mkmanifest.py card build/upload/claro --thumbs build/upload/capas-cache`: o índice em claro, só local.
2. `cifrar.mjs cifrar`: cada arquivo de `card/roms` (fora `ports/`, `themes/`, `*.log`) vira
   `build/upload/dados/<opaco>`; só cifra de novo o que mudou. O mapa com os nomes reais
   (`build/upload/mapa.json`) **nunca sobe**.
3. `rclone sync build/upload/dados gdrive:R36S-dados` (só nessa pasta: o que saiu do cartão sai do Drive).
4. `cifrar.mjs indice` com o `lsjson` da pasta: manifest/library com os IDs, cifrados; sobem também.
5. `cifrar.mjs ponteiro` -> `build/upload/indice.json` -> `tools/publicar.sh r36s-indice` (biblioteca).

Primeira carga: ~38,6 GiB. Depois: `rclone link gdrive:R36S-dados` (link de leitor, para quem foi aprovado baixar).
Refazer (rodar o `sobe.sh` de novo) sempre que mudar o cartão (novo jogo, capa, gamelist).

## 4. Dar acesso à família

A pessoa entra no site com o Google; sem acesso, vê "Sem acesso à biblioteca" e manda o pedido (nome e mensagem).
O andre aprova no `admin.html` da biblioteca (https://h-games-web.netlify.app/admin.html): "Todo o R36S" ou por
sistema. Direto pela linha de comando: `tools/publicar.sh acesso <email> 'r36s:*'` (ou `r36s:snes`), na biblioteca.
O e-mail da pessoa também precisa estar nos **usuários de teste** do app OAuth (passo 1.2), enquanto ele não for
verificado.

## 5. Montar e publicar no Netlify

```bash
build/site-dist.sh            # -> dist/ (~240 MB, ~75 MB com gzip); sem ROMs, sem card/, sem saves
```

Conferir local antes: `python3 -m http.server 8782 --directory dist` e abrir `http://localhost:8782/site/`
(o login real do Google só funciona numa origem autorizada; o modo demonstração funciona em qualquer uma).
Testes: `node tests/e2e_site.mjs http://localhost:8782/` (Drive simulado cifrado + backend local
`tests/mock_chaves.mjs`).

Publicar (só com o ok do andre):

```bash
npx netlify-cli deploy --dir dist            # rascunho: URL de prévia
npx netlify-cli deploy --dir dist --prod     # produção
```

- `dist/_headers`: `application/wasm`, cache dos núcleos, `Cross-Origin-Opener-Policy: same-origin-allow-popups`
  em `/site/*` (o popup do Google precisa falar com a página). **Sem COEP** no site e no seletor: `require-corp`
  bloquearia o script `accounts.google.com/gsi/client`. O PSP (ppsspp, pthreads -> `SharedArrayBuffer`) roda numa
  aba própria, `/retroarch/isolated.html`, a única com `COOP: same-origin` + `COEP: require-corp` (ver
  docs/port-notes.md, "PSP no site"). O COOP não fica no `/*` porque o Netlify junta os valores de regras que casam
  no mesmo caminho. Conferir depois do deploy: na aba do PSP, `crossOriginIsolated === true` no console.
- `dist/_redirects`: `/` → `/site/`.
- Compressão: o Netlify serve gzip/brotli sozinho para texto e wasm.
- Arquivos grandes: `scummvm_libretro.wasm` (73 MB) e `fbneo_libretro.wasm` (42 MB) — conferir se o plano do
  Netlify aceita; se não, tirar esses núcleos do `dist/` (os sistemas mostram "sem emulador no navegador").

## 6. Testes que só o andre consegue fazer

- Login Google de verdade (aviso de app não verificado, os dois escopos, renovação do token depois de 1 h).
- Outra conta de verdade: pedir acesso, aprovar no admin, entrar de novo.
- Controles físicos (Xbox/PlayStation/8BitDo, USB e Bluetooth): mapeamento por posição, 2 controles, Start+Select no
  seletor para trocar P1/P2. O teste automático usa `navigator.getGamepads` falso.
- Celular (A54): joystick de toque em pé e deitado, multitoque, tela cheia.

## Hub local (desenvolvimento)

O site é servido em `/r36s/site/` pelo `hub.py`. O patch `patches/hub/0003-site-coop-gis.patch` faz o hub mandar
`COOP: same-origin-allow-popups` e **não** mandar COEP nessas páginas (login do Google); sem ele o login real em
`localhost:8770` não abre (o resto funciona). Aplicar com `patch -d ~/Workspace/web-ports < patches/hub/0003-site-coop-gis.patch`
e reiniciar o serviço `webports-hub`. O `0004-r36s-isolated-player.patch` deixa explícito que
`/r36s/retroarch/isolated.html` (aba do PSP) é sempre isolada — o hub já manda COOP/COEP fora de `/r36s/site/`,
então ele não muda o comportamento hoje (opcional).
