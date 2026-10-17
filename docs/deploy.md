# Publicar o R36S Web (Netlify + Google Drive)

> **Nada aqui foi feito ainda.** Cada passo que mexe em serviço externo (Netlify, Google Cloud, Drive) só com o ok
> do andre. O site já funciona local: `http://localhost:8770/r36s/site/` (hub, porta 8770).

## Como as peças se encaixam

```
Netlify (estático, dist/)                Google Drive do andre              Google Drive de cada jogador
  /site/        home, login, biblioteca     R36S/            (= cartão EASYROMS)  R36S Web — saves/<sistema>/<arquivo>
  /index.html   ES (WASM), em iframe        R36S/.web/manifest.json             (criada pelo site, escopo drive.file;
  /retroarch/   RetroArch + núcleos         R36S/.web/eager.bin                  o Drive guarda as revisões)
  /site/demo/   homebrews livres            R36S/.web/info.json
```

- Login: Google Identity Services (popup), escopos `drive.readonly` (ler a pasta R36S, própria ou compartilhada) e
  `drive.file` (só os arquivos que o site cria: os saves). Token só em memória.
- Leitura: `GET https://www.googleapis.com/drive/v3/files/<id>?alt=media` com `Range` — os IDs vêm do manifesto.
- Código: `web/drive.js` (API do Drive), `web/io.js` (traduz o "idioma" do hub — `fs/`, `saves/`, `data/` — para o
  Drive), `web/site/` (telas), `web/controls.js` (comandos, toque, controles, 2 jogadores).

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

## 2. Subir as ROMs para o Drive (rclone, na máquina do andre)

O cartão montado (`/run/media/andre/EASYROMS`, só leitura) vira a pasta `R36S` na raiz do Drive do andre.

```bash
# uma vez: remote "gdrive" (OAuth do próprio rclone, no navegador)
rclone config create gdrive drive scope=drive
# cópia (46 GB; dá para retomar). Só lê do cartão.
rclone copy /run/media/andre/EASYROMS gdrive:R36S --progress --transfers 8 --checkers 16 \
  --exclude ".Trash-1000/**" --exclude "*.log"
```

Dica: começar por uma pasta (`rclone copy /run/media/andre/EASYROMS/snes gdrive:R36S/snes`) e o tema
(`themes/es-theme-farfenkugell_EPICMAX`) para testar antes de subir tudo.

## 3. Gerar e subir o índice (`R36S/.web`)

```bash
cd ~/Workspace/web-ports/r36s
rclone lsjson -R --hash --files-only gdrive:R36S > /tmp/r36s-drive.json      # caminhos + IDs + md5
python3 data/mkmanifest.py card /tmp/r36s-web --drive-ids /tmp/r36s-drive.json
rclone copy /tmp/r36s-web gdrive:R36S/.web --progress                         # manifest.json, eager.bin, info.json
```

`card/` é a árvore local de sempre (`data/mkcard.py`: ROOTFS + `card/roms` -> cartão). O script avisa quantos arquivos
de `/roms` não têm ID (não subiram). Refazer o índice sempre que mudar o cartão (novo jogo, capa, gamelist).
O rclone mantém o ID ao atualizar um arquivo; o `md5` vira a versão do cache das capas no navegador.

## 4. Compartilhar a biblioteca com a família

No Drive: pasta `R36S` → Compartilhar → e-mail da pessoa como **Leitor**. Para o botão **Pedir acesso** (tela
"Nenhuma biblioteca") funcionar: Compartilhar → Copiar link, e colar em `requestAccessUrl` em `web/site/config.js`
(o Google mostra "Solicitar acesso" para quem não tem e manda e-mail ao dono).
O e-mail da pessoa também precisa estar nos **usuários de teste** (passo 1.2).

## 5. Montar e publicar no Netlify

```bash
build/site-dist.sh            # -> dist/ (~240 MB, ~75 MB com gzip); sem ROMs, sem card/, sem saves
```

Conferir local antes: `python3 -m http.server 8782 --directory dist` e abrir `http://localhost:8782/site/`
(o login real do Google só funciona numa origem autorizada; o modo demonstração funciona em qualquer uma).
Testes: `node tests/e2e_site.mjs http://localhost:8782/` (usa o mock do Drive).

Publicar (só com o ok do andre):

```bash
npx netlify-cli deploy --dir dist            # rascunho: URL de prévia
npx netlify-cli deploy --dir dist --prod     # produção
```

- `dist/_headers`: `application/wasm`, cache dos núcleos, `Cross-Origin-Opener-Policy: same-origin-allow-popups`
  em `/site/*` (o popup do Google precisa falar com a página). **Sem COEP** no site e no ES: `require-corp`
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
- Pasta compartilhada de verdade com outra conta (usuário de teste).
- Controles físicos (Xbox/PlayStation/8BitDo, USB e Bluetooth): mapeamento por posição, 2 controles, Start+Select no
  ES para trocar P1/P2. O teste automático usa `navigator.getGamepads` falso.
- Celular (A54): joystick de toque em pé e deitado, multitoque, tela cheia.

## Hub local (desenvolvimento)

O site é servido em `/r36s/site/` pelo `hub.py`. O patch `patches/hub/0003-site-coop-gis.patch` faz o hub mandar
`COOP: same-origin-allow-popups` e **não** mandar COEP nessas páginas (login do Google); sem ele o login real em
`localhost:8770` não abre (o resto funciona). Aplicar com `patch -d ~/Workspace/web-ports < patches/hub/0003-site-coop-gis.patch`
e reiniciar o serviço `webports-hub`. O `0004-r36s-isolated-player.patch` deixa explícito que
`/r36s/retroarch/isolated.html` (aba do PSP) é sempre isolada — o hub já manda COOP/COEP fora de `/r36s/site/`,
então ele não muda o comportamento hoje (opcional).
