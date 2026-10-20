# Acesso cifrado à biblioteca do R36S Web

Data: 2026-10-20. Decisões do andre: mesma técnica da biblioteca (`~/Workspace/web-ports/biblioteca`), **mesmo backend**
(projeto Supabase `h-games-web`, mesma lista de pessoas aprovadas).

## Objetivo

Quem tem acesso à pasta do Drive (dono do link, Google, quem achar o link) **não consegue saber quais jogos existem**:
nada em claro, nem nomes, nem capas, nem índice. Quem decide quem pode abrir é o backend, que entrega as chaves só a
contas aprovadas. O site continua igual para quem joga: seletor com capas, ficha, jogar, ⬇ ROM, saves no Drive de cada
um.

Fora do objetivo: impedir que uma pessoa **aprovada** extraia os jogos do próprio navegador (quem pode jogar pode
copiar); esconder o tamanho e a quantidade de arquivos; mudar o visual (próxima spec); os backends `hub` e `demo`
(continuam em claro: o hub é local e o demo só tem homebrews livres).

## Como a biblioteca faz (base) e o que muda aqui

| | Biblioteca | R36S |
|---|---|---|
| Unidade | jogo inteiro concatenado, partes de 16 MiB em arquivos separados | **cada arquivo do cartão** vira um arquivo cifrado, em blocos de 1 MiB dentro do mesmo arquivo |
| Chave | uma aleatória por jogo, no Vault | **uma mestra** no Vault; o backend deriva a chave de cada sistema (HKDF) |
| Acesso | `acesso(jogo, email)`, `*` = todos | linhas `r36s:*` (tudo) ou `r36s:<sistema>` na mesma tabela |
| Decifrar | WebCrypto, chave não exportável | ChaCha20-Poly1305 em JS (`@noble/ciphers`): conferindo a etiqueta no caminho assíncrono, só o ChaCha20 no caminho sob demanda; ver "Por que a chave fica em JS" e "Cifra: ChaCha20" |
| Drive | pastas com o título, capa/prints/info em claro | pasta com nome neutro, arquivos com **nome opaco**, tudo cifrado (índice, capas, miniaturas) |

### Por que a chave do sistema chega ao JavaScript

O player lê arquivos grandes sob demanda (`lazyFile` em `web/retroarch/play.js`): o núcleo faz `fread` síncrono e o
pedaço de 4 MB vem por **XHR síncrono**. A WebCrypto só tem API assíncrona, então nesse caminho a decifração tem de ser
síncrona, em JS. E os arquivos sob demanda não são só a ROM: são as irmãs da pasta (romset pai do arcade, discos) e a
BIOS, de outros jogos, por isso a chave é **por sistema** (dá para abrir qualquer arquivo da pasta sem ir ao backend no
meio de um `fread`).

Consequência aceita: a chave do sistema existe como bytes na memória da aba durante a sessão (não vai para storage, não
vai para a URL). A proteção que importa (o Drive não revela nada; só o backend entrega chave; dá para revogar) continua.
A alternativa (service worker decifrando o XHR síncrono, chave não exportável) foi descartada: o Chromium não passa
XHR síncrono pelo service worker (ver "Cifra: ChaCha20").

Biblioteca JS: `@noble/ciphers` 2.0.1 (auditada), empacotada em `web/vendor/` com a licença.
Critério de desempenho: decifrar 4 MB no caminho síncrono em menos de 150 ms (Chromium, CPU 4x mais lenta, como
aproximação do A54).

### Cifra: ChaCha20 (decisão de 2026-10-20, depois da medida)

Medido no Chromium, 4 MB, CPU 4x mais lenta: AES-GCM em JS 591-631 ms; AES-CTR em JS (GCM sem a etiqueta) 339 ms;
ChaCha20-Poly1305 146 ms; ChaCha20 sem a etiqueta 61 ms; AES-GCM da WebCrypto 33 ms. Service worker não serve: o
Chromium não passa XHR síncrono pelo service worker (testado: o `fetch` passou, o XHR síncrono foi direto ao servidor).

Decisão do andre: formato **ChaCha20-Poly1305** (RFC 8439). O caminho sob demanda (`readSync`) decifra só com o
ChaCha20 (contador a partir de 1, o mesmo fluxo que o Poly1305 usa), **sem conferir a etiqueta**: 61 ms por 4 MB.
Todo o resto (ROM inteira, índice, capas, miniaturas, ⬇ ROM) confere a etiqueta. Consequência aceita: um arquivo
adulterado no Drive faz o jogo grande ler lixo em vez de dar erro claro; ninguém lê nada sem a chave. A WebCrypto
continua no HMAC (nonce), no HKDF e no embrulho; não tem ChaCha, então a decifra é toda em JS.

## Formato

### Chaves (derivadas, iguais no empacotador e no backend)

```
mestra   = 32 bytes aleatórios. Vault: "r36s:mestra". Local: ~/.config/r36s/mestra (modo 600)
chave(s) = HKDF-SHA256(mestra, salt = "r36s-web/v1", info = s)   -> 32 bytes
   s = "sistema:<id>"   arquivos de /roms/<id>/...  (id = pasta logo abaixo de /roms, como no library)
   s = "bios"           arquivos de /bios/...
   s = "catalogo"       índice (library, manifest, eager), capas e miniaturas
   s = "nomes"          só no empacotador: nome dos arquivos no Drive (o navegador nunca recebe)
```

Arquivos fora de `/roms` e `/bios` que o manifest leva (`/home/ark/.config`, já dentro do `eager.bin`) usam a chave do
catálogo.

### Arquivo cifrado (ROM, BIOS, capa, índice)

```
bloco i = nonce (12) || ChaCha20-Poly1305(chave, texto[i*1 MiB, (i+1)*1 MiB)) || tag (16)
arquivo = bloco 0 || bloco 1 || ...        (último bloco pode ser menor; arquivo vazio = 0 blocos)
AAD     = "r36s" || u32 i || u32 n_blocos  (bloco fora de ordem, truncado ou de outro tamanho falha)
nonce   = HMAC-SHA256(chave, u32 i || texto do bloco)[:12]
```

- O nonce determinístico (como na biblioteca) faz o mesmo conteúdo gerar o mesmo arquivo: republicar só sobe o que
  mudou.
- Ler o intervalo `[a, b]` do texto = baixar os blocos `a>>20 .. b>>20`, cujo intervalo cifrado é
  `[i*(2^20+28), (j+1)*(2^20+28))` (limitado ao tamanho), decifrar e recortar. O pedaço de 4 MB do `lazyFile` vira 4
  blocos (alinhado).
- O manifest guarda o **tamanho em claro** (o player precisa) e o tamanho cifrado sai da conta.

### Miniaturas

Pacote por sistema como hoje, mas cada miniatura é um registro `nonce || ChaCha20-Poly1305(chave do catálogo, webp) || tag`
(AAD = `"r36s-thumb"`, nonce = HMAC-SHA256(chave, webp)[:12]). O `thumb: [off, len]` do library aponta para o registro cifrado; o Range continua funcionando.
Os pacotes também ganham nome opaco.

### Drive

```
gdrive:R36S-dados/            nome neutro; compartilhada "qualquer pessoa com o link: leitor"
  <opaco>                      um arquivo por arquivo do cartão, plano, sem subpastas
                               opaco = hex(HMAC-SHA256(chave("nomes"), caminho do cartão))[:24]
```

Os índices (`library.json.gz`, `manifest.json`, `eager.bin`) e os pacotes de miniaturas também estão lá, cifrados, com
nome opaco. O site encontra o índice pelo backend (abaixo), não por busca no Drive.

Os IDs do Drive continuam no manifest e no library (cifrados), como hoje. A pasta `R36S/` em claro é apagada só depois
de tudo validado no A54 e **com o ok do andre** (passo separado).

## Backend (projeto `h-games-web`, repositório da biblioteca)

Migração `0003_r36s.sql`:

- Vault: segredo `r36s:mestra` (gravado pelo `publicar.sh r36s-chave`, como o `guardar_chave`).
- Tabela `r36s_indice (id int primary key default 1, indice jsonb, atualizado timestamptz)`: `{library: {id, v, size},
  manifest: {id, v, size}, eager: {id, v, size}, sistemas: [ids]}` (IDs do Drive, versão e tamanho em claro; a lista
  de sistemas do índice). RLS sem políticas, como as outras.
- Função `r36s_sistemas(p_email) -> text[]`: `['*']` se tiver `r36s:*`, senão a lista de `r36s:<sistema>`. Admin
  (`admins`) = `['*']`. A linha `*` da biblioteca **não** vale para o R36S (são coisas separadas no admin).
- Função `r36s_mestra() -> text`: lê o Vault (só `service_role`).

Edge Function nova `r36s` (mesmo `_shared/nucleo.js`, mesmo `quemGoogle`, mesmo `ID`/CORS):

```
POST {publica: JWK}  (Authorization: Bearer <token Google>)
  -> 401 sem login | 403 {error: "acesso", pedido: status|null} sem nenhuma linha r36s
  -> 200 {indice: {...}, sistemas: ["*"] | ["snes", ...],
          chaves: {catalogo: <embrulhada>, bios: <embrulhada>, "<sistema>": <embrulhada>, ...}, publica: JWK}
```

- Uma chamada no login entrega tudo o que a pessoa pode abrir. Com `*`, entrega a chave de **todos os sistemas que
  aparecem no índice** (a lista vem do `r36s_indice.indice.sistemas`, gravada pelo publicar).
- Embrulho: o par efêmero do backend é um só por resposta; cada chave vai com AES-KW. O navegador desembrulha para
  bytes (precisa deles no caminho síncrono).
- Registra em `acessos` (`jogo = "r36s"`, ok true/false), como a função `chave`.
- `ORIGENS` do `nucleo.js` ganha `https://r36s-web.netlify.app` e `http://localhost:8770`.

Pedidos e aprovação: a mesma tabela `pedidos`. O R36S pede acesso chamando `conta?op=pedir` (formulário curto na
própria página do R36S quando a função `r36s` responde 403). O `admin.html` da biblioteca ganha, ao aprovar, a opção
"R36S: tudo / estes sistemas" (grava `r36s:*` ou `r36s:<sistema>`); revogar remove também as linhas `r36s:`.

## Ferramentas (repositório r36s)

- `data/cifrar.mjs` (Node, WebCrypto, mesmo código de formato que o navegador usa: `web/cripto.js`):
  entrada = a pasta do cartão (somente leitura), o manifest e o library gerados pelo `mkmanifest.py`, a mestra local;
  saída = `build/upload/cifrado/<opaco>` (com cache: só cifra de novo o que mudou de tamanho/mtime) e o mapa
  `caminho -> opaco`. Nunca grava no cartão.
- `mkmanifest.py`: modo `--cifrado` que, a partir do `lsjson` da pasta `R36S-dados`, escreve os IDs/versões dos
  arquivos opacos no manifest/library (mesma lógica da passada dupla de hoje), as miniaturas como registros cifrados
  e o `sistemas` do índice.
- `build/upload/sobe.sh` (gitignored): cifra, `rclone copy` para `R36S-dados` (só o que mudou), gera o índice, cifra o
  índice, sobe, grava `r36s_indice` no backend. Escreve no Drive e no Supabase: roda só com o ok do andre.
- `publicar.sh` da biblioteca: `r36s-chave` (mestra no Vault), `r36s-indice`, `acesso <email> r36s:*`.

Primeira carga: ~38,6 GiB / 25.469 arquivos re-subidos cifrados (o Drive conta como espaço novo até apagar a `R36S/`).

## Site (repositório r36s)

- `web/cripto.js`: formato de bloco, AAD, nonce, HKDF (empacotador), desembrulho (navegador), decifra assíncrona
  (ChaCha20-Poly1305 com a etiqueta) e síncrona (ChaCha20 sem a etiqueta). Testado em Node contra os dois caminhos (mesmo texto).
- Login (`web/site/site.js`): depois do token, chama a função `r36s` com o par ECDH. 200 -> guarda `{indice, chaves}`
  em memória (não em storage) e segue. 403 -> tela "Sem acesso" com o formulário de pedido (nome + mensagem) e o status
  do pedido. 401 -> o fluxo de login vencido que já existe.
- `web/io.js` (backend `drive`): o índice vem dos IDs do backend; `indexFile`, `driveFile`, `image` e `thumb`
  decifram (os do cache continuam em cache **cifrados**, chave = ID + versão, como hoje; decifra ao ler). Range em
  claro -> blocos cifrados. Sistema sem chave (acesso parcial) -> 403, e o seletor mostra o sistema apagado com
  "sem acesso".
- `io.readSync(vpath, de, ate)`: o `lazyFile` do `play.js` usa quando existe (XHR síncrono dos blocos + decifra
  síncrona); hub/demo seguem com o XHR de hoje. O `xhrFrom` deixa de apontar `fs/` para o Drive direto.
- Aba isolada (PSP): recebe as chaves pelo mesmo `BroadcastChannel` que já leva o índice (só dentro da origem).
- ⬇ ROM: decifra para blob até 100 MB (como hoje); acima, no PC, grava por `showSaveFilePicker` em streaming; no
  celular, acima de 100 MB, o botão explica que o arquivo é grande demais para o navegador. Sai o "abrir no Drive".

## Erros

- Bloco que não confere (etiqueta Poly1305, caminho assíncrono) -> o arquivo é tratado como corrompido: 502 no `fetch`, `EIO` no `fread`, e o
  cache daquele ID é apagado.
- Backend fora (Supabase pausado após 7 dias sem uso, rede): tela "Servidor de chaves indisponível, tente de novo"
  com botão; o demo continua disponível.
- Pedido de acesso pendente/recusado: a tela diz qual.

## Testes

- `tests/test_cripto.mjs`: formato (vetores fixos), Range em qualquer alinhamento, último bloco, arquivo vazio, AAD
  (troca/corte de bloco falha), síncrono == assíncrono, HKDF igual ao do backend.
- Backend: os testes da biblioteca (`funcoes-local.mjs`) ganham a função `r36s` (sem login, sem acesso, `*`,
  sistemas parciais, admin).
- `test_library.py`: `mkmanifest --cifrado` (IDs opacos, registros de miniatura, nenhum nome em claro no que sobe:
  varredura do diretório de upload procurando nomes de jogos/sistemas conhecidos).
- `drive_boot`/`e2e_site` com Drive simulado **cifrado** e backend local: seletor, capas, jogar um jogo pequeno
  (inteiro) e um grande (sob demanda, PSP na aba isolada), ⬇ ROM, sem acesso, acesso parcial.
- Desempenho: `perf_home` sem piora visível; decifra de 4 MB medida no Chromium com CPU 4x e depois no A54.
- Saves do DK3: conferir o md5 no fim, como sempre.

## Ordem

1. `web/cripto.js` + `@noble/ciphers` + teste e medida de desempenho (se falhar o critério, parar e decidir).
2. Backend: migração, função `r36s`, testes locais, CORS. Deploy só com ok.
3. `cifrar.mjs` + `mkmanifest --cifrado` (local, sem subir).
4. Site: login com a função, `io.js`, `readSync`, aba isolada, ⬇ ROM, telas de acesso; e2e com Drive simulado.
5. `admin.html` com as opções do R36S.
6. Subir para `R36S-dados` (ok do andre), publicar o índice no backend, deploy do site (ok), teste no A54.
7. Apagar `gdrive:R36S` em claro (ok do andre, depois de validado).

## Fica para depois

- Biblioteca: as pastas do `gdrive:Jogos` têm o nome dos jogos e `capa`/`prints`/`info.json`/`pack.json`/
  `webports-game.json` estão em claro. Corrigir com o mesmo esquema (nomes opacos, capas cifradas com chave de
  catálogo).
- Ping para o Supabase não pausar (os dois sites dependem dele).
