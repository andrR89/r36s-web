# Configurar controles — design (aprovado pelo andre em 2026-10-17)

Aba **"Configurar"** no painel de Comandos (abre pelo `?` e pelo menu `≡`, no ES e no jogo). Preferências **por
aparelho** (localStorage `r36s-controles-v1`), aplicadas na hora.

## Peças

- `web/settings.js` — modelo e persistência: padrão, `load()/save()/reset()`, `onChange`. Funções puras e testáveis:
  `mapPad(gp, map)` (controle real → controle "standard" no layout do R36S, com zona morta), `remapKey(code, map)`.
- `web/config-ui.js` — a aba: Jogadores, Teclado (remapear), Controle (remapear), Toque, Analógicos, Restaurar.
- `web/controls.js` — usa as preferências: P1/P2, remapeamento de teclado (camada de tradução tecla física → tecla
  canônica do layout, que é o que ES e RetroArch entendem), remapeamento do controle (no wrapper de
  `navigator.getGamepads()` do iframe e no laço do ES), **controle virtual de toque** no jogo.
- `web/retroarch/play.js` — `input_analog_deadzone` e `input_analog_sensitivity` das preferências.

## Decisões

1. **Jogadores:** `auto` (padrão novo): 1 controle → controle P1, teclado/toque P2; 2+ → ordem de conexão.
   Alternativas fixas: `teclado-p1`, `controle-p1`. Start+Select no controle continua trocando.
2. **Remapear:** ações `up down left right a b x y l r l2 r2 start select lsu lsd lsl lsr rsu rsd rsl rsr`. Teclado: a
   tecla física vira a tecla canônica da ação (layout WASD/LKJI…); uma tecla canônica cuja ação foi movida para outra
   tecla deixa de valer. Controle: cada ação aponta para um botão (`b:n`) ou meio-eixo (`a:n+`/`a:n-`) do controle
   real; o wrapper monta o controle "standard" que o ES e o RetroArch já entendem (cfg do RetroArch não muda).
3. **Toque:** tamanho P/M/G, transparência, analógicos `auto|sempre|nunca`, "direcional vira analógico esquerdo".
4. **Analógico de toque proporcional:** no jogo o toque vira um **controle virtual** (`R36S Toque`, mapping standard)
   exposto no `getGamepads()` do iframe no lugar do slot do teclado; o RetroArch o registra pelo `gamepadconnected`.
   Eixos = deslocamento do dedo / raio, com zona morta. No ES o toque continua mandando teclas.
5. **Sensibilidade:** zona morta (toque e controle) e sensibilidade do RetroArch.

Fora por enquanto: mapa por sistema; preferências na nuvem; remapeamento na aba isolada do PSP.

## Testes

`tests/test_settings.mjs` (funções puras: mapPad, remapKey, P1/P2), `tests/controls_config.mjs` (aba, remapear
tecla e botão, troca P1/P2), `tests/touch_game.mjs` (controle virtual: meio caminho move a mãozinha do Mario 64 mais
devagar que o caminho inteiro; Dreamcast), e a bateria de sempre.
