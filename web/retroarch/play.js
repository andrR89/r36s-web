// Player do RetroArch web para o R36S no navegador (ver play.html e docs/port-notes.md, seções RetroArch e Etapa 3).
// Fluxo: valida parâmetros e o núcleo (../data/cores.json) -> reenvia save pendente do IndexedDB -> baixa save do
// servidor (404 = tenta o .srm do cartão ao lado da ROM; erro de rede = NÃO inicia) -> ROM em /roms/<sistema>/ como no
// aparelho (pequena: baixada; grande, irmãs da pasta, faixas de .cue/.m3u e BIOS em /roms/bios: arquivos sob demanda
// por Range) -> sobe o núcleo com MEMFS e um retroarch.cfg derivado do dArkOS + opções de núcleo do cartão ->
// a cada 2 s sobe o .srm se mudou -> na saída, PUT final e avisa o pai.

const RA = "/home/web_user/retroarch";
const CFG = `${RA}/userdata/retroarch.cfg`;
const CONTENT_DIR = `${RA}/userdata/content`;
const SAVES_DIR = `${RA}/userdata/saves`;
const STATES_DIR = `${RA}/userdata/states`;
const SYSTEM_DIR = "/roms/bios";   // system_directory do retroarch.cfg do dArkOS
const CORE_OPTS = `${RA}/userdata/retroarch-core-options.cfg`;
// celular (tela de toque): opções mais leves quando o cartão não define (o N64 do aparelho era o parallel_n64, sem
// opções do mupen64plus no cartão). 320x240 = resolução nativa do N64 (1/4 dos pixels do padrão 640x480); FrameDuping
// repete o quadro anterior quando a emulação atrasa, em vez de engasgar.
const COARSE = matchMedia("(pointer: coarse)").matches;
const MOBILE_CORE_DEFAULTS = {
  mupen64plus_next: { "mupen64plus-43screensize": "320x240", "mupen64plus-FrameDuping": "True" },
  flycast: { "reicast_internal_resolution": "320x240", "reicast_auto_skip_frame": "some" },
};
// celular: valem mesmo sobre o cartão. O flycast web não tem threads: "threaded rendering" (ligado no cartão, certo
// no aparelho) travava o Dreamcast no celular.
const MOBILE_CORE_FORCE = {
  flycast: { "reicast_threaded_rendering": "disabled" },
};
const CARD_RA = "../fs/home/ark/.config/retroarch";   // cópia dos cfgs do ROOTFS (data/mkcard.py)
const SYNC_MS = 2000;
const EAGER_MAX = 48 << 20;   // ROM até 48 MB: baixa inteira; acima (CHD/ISO): sob demanda
// .7z/.zip o núcleo lê inteiro de qualquer jeito (FBNeo, MAME...): baixa tudo antes, em pedaços paralelos e com
// progresso, em vez de 4 MB por vez com a tela parada (kof2000.7z: 88 MB = 22 pedidos em série ao Drive)
const ARCHIVE = /\.(7z|zip)$/i, ARCHIVE_MAX = 512 << 20, PART = 8 << 20, PARALLEL = 6;
const CHUNK = 4 << 20;        // pedaço dos arquivos sob demanda

const params = new URLSearchParams(location.search);
const system = params.get("system") || "";
let core = params.get("core") || "";
const rom = params.get("rom") || "";
// aba isolada (núcleos com threads no site: retroarch/isolated.html + isolated.js) faz o papel do pai: window.r36sHost
const host = window.r36sHost || null;
const embedded = window.parent !== window || !!host;
const msg = document.getElementById("msg");
const syncEl = document.getElementById("sync");
const canvas = document.getElementById("canvas");
const log = (...a) => console.log("[play]", ...a);
// E/S: no hub, fetch/XHR do navegador (../fs, ../saves, ../data). Dentro do site (backend drive/demo) o player usa o
// backend da página do seletor (web/io.js), que traduz essas mesmas URLs; nada mais muda aqui entre os backends.
const io = (() => { try { return host ? host.io : embedded && parent.r36s && parent.r36s.io; } catch (e) { return null; } })();
const fetch = io ? io.fetchFrom(location.href) : globalThis.fetch.bind(globalThis);
const XMLHttpRequest = io ? io.xhrFrom(location.href) : globalThis.XMLHttpRequest;
const state = { module: null, finished: false, started: false };
window.r36sPlay = state;   // inspeção nos testes

// teclado (layout do andre, igual no seletor e em todos os sistemas): WASD = direcional, L=A K=B J=Y I=X U=L O=R, Enter=Start,
// Backspace=Select, Backspace+Enter = sair (F12 sintético, abaixo), Esc = menu do RetroArch, F5/F7 = salvar/carregar estado.
// Extras para núcleos que usam L2/R2 (PS1): Y = L2 (ao lado do U=L), P = R2 (ao lado do O=R).
// Analógicos (N64 e afins), em teclas livres do layout: setas = analógico esquerdo (o direcional do N64);
// T/F/G/H = analógico direito (cima/esquerda/baixo/direita), que o mupen64plus_next usa como botões C.
// No N64 (mapa padrão do núcleo): A = K, B = J, Z = Y (L2), L = U, R = O, Start = Enter, direcional = WASD.
// Overrides/remaps automáticos do RetroArch ficam desligados: os do cartão entram filtrados (sem teclado nem caminhos).
const RETROARCH_CFG = `
config_save_on_exit = "false"
video_driver = "gl"
input_driver = "rwebinput"
menu_driver = "rgui"
rgui_show_start_screen = "false"
menu_show_load_content_animation = "false"
video_font_enable = "true"
quit_press_twice = "false"
confirm_quit = "false"
pause_nonactive = "false"
savefile_directory = "${SAVES_DIR}"
savestate_directory = "${STATES_DIR}"
system_directory = "${SYSTEM_DIR}"
core_options_path = "${CORE_OPTS}"
global_core_options = "true"
auto_overrides_enable = "false"
auto_remaps_enable = "false"
sort_savefiles_enable = "false"
sort_savefiles_by_content_enable = "false"
sort_savestates_enable = "false"
sort_savestates_by_content_enable = "false"
savefiles_in_content_dir = "false"
savestates_in_content_dir = "false"
autosave_interval = "10"
savestate_auto_save = "false"
savestate_auto_load = "false"
input_autodetect_enable = "true"
input_quit_gamepad_combo = "4"
input_player1_up = "w"
input_player1_down = "s"
input_player1_left = "a"
input_player1_right = "d"
input_player1_a = "l"
input_player1_b = "k"
input_player1_x = "i"
input_player1_y = "j"
input_player1_l = "u"
input_player1_r = "o"
input_player1_l2 = "y"
input_player1_r2 = "p"
input_player1_l3 = "nul"
input_player1_l_x_plus = "right"
input_player1_l_x_minus = "left"
input_player1_l_y_plus = "down"
input_player1_l_y_minus = "up"
input_player1_r_x_plus = "h"
input_player1_r_x_minus = "f"
input_player1_r_y_plus = "g"
input_player1_r_y_minus = "t"
input_player1_r3 = "nul"
input_player1_start = "enter"
input_player1_select = "backspace"
input_enable_hotkey = "nul"
input_exit_emulator = "f12"
input_save_state = "f5"
input_load_state = "f7"
input_menu_toggle = "escape"
input_state_slot_increase = "nul"
input_state_slot_decrease = "nul"
input_toggle_fast_forward = "nul"
input_hold_fast_forward = "nul"
input_pause_toggle = "nul"
input_frame_advance = "nul"
input_rewind = "nul"
input_reset = "nul"
input_screenshot = "nul"
input_toggle_fullscreen = "nul"
input_shader_next = "nul"
input_shader_prev = "nul"
input_movie_record_toggle = "nul"
input_netplay_game_watch = "nul"
input_volume_up = "nul"
input_volume_down = "nul"
input_audio_mute = "nul"
input_grab_mouse_toggle = "nul"
input_game_focus_toggle = "nul"
input_hold_slowmotion = "nul"
input_toggle_slowmotion = "nul"
input_ai_service = "nul"
input_osk_toggle = "nul"
input_fps_toggle = "nul"
input_close_content = "nul"
input_joypad_driver = "rwebpad"
input_player1_joypad_index = "0"
input_player2_joypad_index = "1"
`;
// Controles físicos (Gamepad API, mapeamento "standard"), pela POSIÇÃO do botão como no R36S: baixo = B, direita = A,
// esquerda = Y, cima = X, LB/RB = L/R, LT/RT = L2/R2, View/Back = Select, Menu/Start = Start (Select+Start sai: combo 4).
// Quem é P1/P2 decide a página do seletor (web/controls.js): ela reordena navigator.getGamepads() dentro deste iframe
// (play.html), então os índices daqui são fixos (0 = P1, 1 = P2). P2 também tem teclas (teclado numérico), usadas só
// quando o teclado vira o Jogador 2 (troca com Start+Select no seletor, 1 controle + teclado).
const PAD_BUTTONS = { b: 0, a: 1, y: 2, x: 3, l: 4, r: 5, l2: 6, r2: 7, select: 8, start: 9, l3: 10, r3: 11, up: 12, down: 13, left: 14, right: 15 };
const PAD_AXES = { l_x_plus: "+0", l_x_minus: "-0", l_y_plus: "+1", l_y_minus: "-1", r_x_plus: "+2", r_x_minus: "-2", r_y_plus: "+3", r_y_minus: "-3" };
const P2_KEYS = { up: "keypad8", down: "keypad2", left: "keypad4", right: "keypad6", a: "keypad3", b: "keypad1", x: "keypad9", y: "keypad7",
  l: "kp_divide", r: "kp_multiply", l2: "kp_minus", r2: "kp_plus", start: "kp_enter", select: "kp_period" };
const RETROARCH_PADS = [1, 2].map(n =>
  Object.entries(PAD_BUTTONS).map(([k, v]) => `input_player${n}_${k}_btn = "${v}"\n`).join("") +
  Object.entries(PAD_AXES).map(([k, v]) => `input_player${n}_${k}_axis = "${v}"\n`).join("")).join("") +
  Object.entries(P2_KEYS).map(([k, v]) => `input_player2_${k} = "${v}"\n`).join("");

function show(text, sub, err) {
  msg.className = err ? "err" : "";
  msg.innerHTML = "";
  msg.append(text);
  if (sub) { const s = document.createElement("small"); s.textContent = sub; msg.append(s); }
  msg.style.display = "flex";
}

function postParent(data) {
  if (host) host.post(data);
  else if (embedded) parent.postMessage(data, location.origin);
}

// ---------- saves: servidor + IndexedDB para o que não subiu ----------
const romName = rom.slice(rom.lastIndexOf("/") + 1);
const stem = romName.includes(".") ? romName.slice(0, romName.lastIndexOf(".")) : romName;
// nome do save: <rom sem extensão>.srm (SRAM do RetroArch); núcleos que gravam o próprio arquivo no savefile_directory
// usam outra extensão (cores.json "saveExt": melonDS grava .sav). Definido em main(), depois de saber o núcleo.
let srmName, srmPath, saveUrl, pendingKey;
function setSaveName(ext) {
  srmName = stem + ext;
  srmPath = `${SAVES_DIR}/${srmName}`;
  saveUrl = `../saves/${encodeURIComponent(system)}/${encodeURIComponent(srmName)}`;
  pendingKey = `${system}/${srmName}`;
}
setSaveName(".srm");

function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("r36s-saves", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("pending");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idbOp(mode, fn) {
  try {
    const db = await idb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("pending", mode);
      const req = fn(tx.objectStore("pending"));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) { console.warn("[play] IndexedDB", e); return undefined; }
}
const pendingGet = () => idbOp("readonly", s => s.get(pendingKey));
const pendingSet = data => idbOp("readwrite", s => s.put({ data, t: Date.now() }, pendingKey));
const pendingDel = () => idbOp("readwrite", s => s.delete(pendingKey));

function hash(u8) {   // FNV-1a 32 bits + tamanho: o .srm tem poucos KB
  let h = 0x811c9dc5;
  for (let i = 0; i < u8.length; i++) { h ^= u8[i]; h = Math.imul(h, 0x01000193); }
  return `${u8.length}:${h >>> 0}`;
}

async function putSave(data) {
  const r = await fetch(saveUrl, { method: "PUT", body: data, headers: { "Content-Type": "application/octet-stream" } });
  if (!r.ok) throw new Error(`PUT ${r.status}`);
}

const sync = { last: null, queued: null, busy: false, failures: 0, uploads: 0 };
state.sync = sync;

// fila com um envio por vez; falha -> guarda no IndexedDB e tenta de novo com backoff (1 s, 2 s, 4 s... até 30 s)
async function pump() {
  if (sync.busy) return;
  sync.busy = true;
  try {
    while (sync.queued) {
      const data = sync.queued;
      try {
        await putSave(data);
        sync.uploads++;
        if (sync.queued === data) { sync.queued = null; await pendingDel(); }
        sync.failures = 0;
        syncEl.style.display = "none";
        log("save enviado", data.length, "bytes");
      } catch (e) {
        sync.failures++;
        await pendingSet(data);
        syncEl.textContent = `save não enviado (${e.message}); guardado no navegador, tentando de novo…`;
        syncEl.style.display = "block";
        const wait = Math.min(30000, 1000 * 2 ** (sync.failures - 1));
        console.warn("[play] PUT falhou, nova tentativa em", wait, "ms", e);
        await new Promise(r => setTimeout(r, wait));
        if (state.finished && sync.failures >= 4) break;   // saindo: não segura o jogador para sempre
      }
    }
  } finally { sync.busy = false; }
}

// Save em árvore (PSP: memory stick em savefile_directory/PSP/SAVEDATA/<jogo>/...; EasyRPG: <rom>.save/Save01.lsd...): o servidor guarda um arquivo por
// jogo, então a árvore vai empacotada num blob só (<rom>.savedata): "R36T1\n" + por arquivo uma linha JSON {p,n} + n bytes.
let saveTree = null;   // caminho no MEMFS (cores.json "saveTree", relativo a SAVES_DIR)
function packTree(FS, root) {
  const files = [];
  const walk = d => { for (const n of FS.readdir(d)) { if (n === "." || n === "..") continue; const p = `${d}/${n}`;
    const st = FS.stat(p); if (FS.isDir(st.mode)) walk(p); else files.push(p); } };
  try { walk(root); } catch (e) { return null; }
  if (!files.length) return null;
  files.sort();
  const enc = new TextEncoder(), parts = [enc.encode("R36T1\n")];
  for (const p of files) { const d = FS.readFile(p); parts.push(enc.encode(JSON.stringify({ p: p.slice(root.length + 1), n: d.length }) + "\n"), d); }
  const out = new Uint8Array(parts.reduce((a, x) => a + x.length, 0));
  let o = 0; for (const x of parts) { out.set(x, o); o += x.length; }
  return out;
}
function unpackTree(FS, root, blob, mkdirp) {
  const dec = new TextDecoder();
  if (dec.decode(blob.subarray(0, 6)) !== "R36T1\n") throw new Error("save em árvore com formato desconhecido");
  let o = 6, n = 0;
  while (o < blob.length) {
    const nl = blob.indexOf(10, o); const h = JSON.parse(dec.decode(blob.subarray(o, nl))); o = nl + 1;
    if (h.p.split("/").includes("..")) throw new Error("caminho inválido no save");
    const p = `${root}/${h.p}`; mkdirp(p.slice(0, p.lastIndexOf("/"))); FS.writeFile(p, blob.subarray(o, o + h.n)); o += h.n; n++;
  }
  return n;
}
function readSave(FS) {
  if (saveTree) return packTree(FS, saveTree);
  try { return FS.readFile(srmPath); } catch (e) { return null; }   // ainda não existe
}

function checkSave() {
  const FS = state.module && state.module.FS;
  if (!FS) return;
  const data = readSave(FS);
  if (!data) return;
  const h = hash(data);
  if (h === sync.last) return;
  sync.last = h;
  sync.queued = data.slice();
  pump();
}

async function flushSaves(timeoutMs) {
  checkSave();
  const t0 = performance.now();
  while ((sync.queued || sync.busy) && performance.now() - t0 < timeoutMs) {
    if (!sync.busy) pump();
    await new Promise(r => setTimeout(r, 100));
  }
  return !sync.queued;
}

// ---------- saída ----------
async function finish(code, reason) {
  if (state.finished) return;
  state.finished = true;
  clearInterval(state.timer);
  log("saindo", code, reason || "");
  const saved = await flushSaves(10000);
  if (!saved) console.warn("[play] save final não subiu; fica no IndexedDB para a próxima vez");
  state.exitCode = code;
  if (embedded) postParent({ type: "r36s-exit", code, saved });
  else show("jogo encerrado", saved ? "save sincronizado" : "save guardado no navegador (servidor indisponível)", !saved);
}
state.quit = why => finish(0, why);   // aba isolada: a página do seletor pediu para fechar

// erro antes de iniciar: mostra e sai com qualquer tecla (ou em 8 s, dentro do seletor)
function fatal(text, detail) {
  console.error("[play]", text, detail || "");
  show(text, (detail ? detail + " — " : "") + "aperte qualquer tecla para voltar", true);
  const go = () => { removeEventListener("keydown", go); finish(2, text); };
  addEventListener("keydown", go);
  if (embedded) setTimeout(go, 8000);
}

// ---------- arquivos do cartão sob demanda ----------
const fsUrl = path => "../fs" + path.split("/").map(encodeURIComponent).join("/");
const dirOf = p => p.slice(0, p.lastIndexOf("/")) || "/";
const lazyStats = { files: 0, requests: 0, bytes: 0 };
state.lazy = lazyStats;

// manifesto do cartão (o seletor já tem; sozinho, baixa): lista das pastas e da BIOS sem perguntar ao servidor
async function loadManifest() {
  if (host && host.manifest) return host.manifest;
  try { if (embedded && parent.r36s && parent.r36s.io) return (await parent.r36s.io.loadIndex()).manifest; } catch (e) {}
  const r = await fetch("../data/manifest.json");
  if (!r.ok) throw new Error(`manifest HTTP ${r.status}`);
  return r.json();
}

// Arquivo inteiro por Range em pedaços paralelos, com progresso na tela
async function fetchParts(url, size, name) {
  const buf = new Uint8Array(size), mb = n => (n / 1e6).toFixed(0);
  let got = 0, next = 0;
  const label = () => show("Baixando o jogo…", `${name} · ${mb(got)} / ${mb(size)} MB`);
  label();
  const worker = async () => {
    while (next < size) {
      const from = next, to = Math.min(size, from + PART) - 1;
      next = to + 1;
      for (let attempt = 0; ; attempt++) {
        const r = await fetch(url, { headers: { Range: `bytes=${from}-${to}` } });
        if (r.status === 206 || (r.status === 200 && from === 0 && to === size - 1)) {
          const d = new Uint8Array(await r.arrayBuffer());
          buf.set(d.subarray(0, to - from + 1), from);
          got += Math.min(d.length, to - from + 1); lazyStats.requests++; lazyStats.bytes += d.length;
          label();
          break;
        }
        if (r.status === 200) {   // servidor sem Range: o arquivo inteiro de uma vez
          const d = new Uint8Array(await r.arrayBuffer());
          buf.set(d.subarray(0, size)); got = size; next = size; return;
        }
        if (attempt >= 3) throw new Error(r.status === 503 ? "cartão não montado" : `ROM HTTP ${r.status}`);
        await new Promise(res => setTimeout(res, 800 * (attempt + 1)));
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  return buf.buffer;
}

// Arquivo do MEMFS cujo conteúdo vem do servidor por Range, em pedaços de 4 MB, na hora da leitura. O núcleo lê com
// fread síncrono: XHR síncrono com charset x-user-defined (o modo arraybuffer síncrono não existe fora de worker).
function lazyFile(FS, path, url, size) {
  const chunks = new Map();
  const get = i => {
    let c = chunks.get(i);
    if (c) return c;
    const from = i * CHUNK, to = Math.min(size, from + CHUNK) - 1;
    const x = new XMLHttpRequest();
    x.open("GET", url, false);
    x.setRequestHeader("Range", `bytes=${from}-${to}`);
    x.overrideMimeType("text/plain; charset=x-user-defined");
    x.send();
    if (x.status !== 206 && x.status !== 200) { console.warn("[play] leitura falhou", url, x.status); throw new FS.ErrnoError(29); }
    const t = x.responseText;
    c = new Uint8Array(t.length);
    for (let k = 0; k < t.length; k++) c[k] = t.charCodeAt(k) & 0xff;
    if (x.status === 200 && c.length > to - from + 1) c = c.subarray(from, to + 1);   // servidor sem Range
    chunks.set(i, c);
    lazyStats.requests++; lazyStats.bytes += c.length;
    return c;
  };
  try { FS.unlink(path); } catch (e) {}
  const node = FS.createFile(dirOf(path), path.slice(path.lastIndexOf("/") + 1), {}, true, false);
  node.contents = null;
  Object.defineProperty(node, "usedBytes", { get: () => size });
  const ops = Object.assign({}, node.stream_ops);
  ops.read = (stream, buffer, offset, length, position) => {
    if (position >= size) return 0;
    const n = Math.min(length, size - position);
    let done = 0;
    while (done < n) {
      const pos = position + done, i = Math.floor(pos / CHUNK), c = get(i), a = pos - i * CHUNK;
      const take = Math.min(n - done, c.length - a);
      if (take <= 0) break;
      buffer.set(c.subarray(a, a + take), offset + done);
      done += take;
    }
    return done;
  };
  ops.write = () => { throw new FS.ErrnoError(2); };   // EACCES: cartão é só leitura
  ops.mmap = () => { throw new FS.ErrnoError(43); };
  node.stream_ops = ops;
  lazyStats.files++;
  return node;
}

// arquivos que um .cue/.m3u/.gdi/.ccd cita (faixas .bin, discos): nomes relativos à pasta dele
function companionsOf(name, text) {
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase(), out = [];
  if (ext === ".cue") for (const m of text.matchAll(/^\s*FILE\s+(?:"([^"]+)"|(\S+))/gmi)) out.push(m[1] || m[2]);
  else if (ext === ".m3u") for (const l of text.split(/\r?\n/)) { const t = l.trim(); if (t && !t.startsWith("#")) out.push(t); }
  else if (ext === ".gdi") for (const l of text.split(/\r?\n/).slice(1)) { const m = l.match(/^\s*\d+\s+\d+\s+\d+\s+\d+\s+(?:"([^"]+)"|(\S+))/); if (m) out.push(m[1] || m[2]); }
  else if (ext === ".ccd") { const stem = name.slice(0, name.lastIndexOf(".")); out.push(stem + ".img", stem + ".sub"); }
  return out;
}
const SHEET = /\.(cue|m3u|gdi|ccd)$/i;

async function headSize(path) {
  const r = await fetch(fsUrl(path), { method: "HEAD" });
  return r.ok ? Number(r.headers.get("Content-Length")) : -1;
}

// cfg "chave = valor" -> Map
function parseCfg(text) {
  const m = new Map();
  for (const l of (text || "").split(/\r?\n/)) { const x = l.match(/^\s*([A-Za-z0-9_\-.]+)\s*=\s*"?(.*?)"?\s*$/); if (x) m.set(x[1], x[2]); }
  return m;
}
const textOr404 = url => fetch(url).then(r => r.status === 200 ? r.text() : null, () => null);
// overrides do cartão que não podem valer na web: teclado/controle, caminhos, drivers
// opções de núcleo do cartão que não existem no núcleo web (recompiladores ARM): o picodrive web quebra com drc ligado
const CORE_OPT_BLOCK = /(_drc|_drc_thread|_dynarec|_dynarec_.*)$/;
const OVERRIDE_BLOCK = /^(input_|joypad_|.*_directory$|.*_path$|video_driver$|audio_driver$|menu_driver$|libretro_|core_options|global_core_options|config_save_on_exit|savefile|savestate|sort_|auto_)/;

// ---------- início ----------
async function main() {
  if (!/^[a-z0-9_-]+$/.test(system) || !/^[a-z0-9_]*$/.test(core) || !rom.startsWith("/roms/") || rom.split("/").includes(".."))
    return fatal("parâmetros inválidos", `system=${system} core=${core} rom=${rom}`);

  // 0. núcleo web do sistema (data/cores.json, data/mkcores.py)
  let sys = null, coresJson = {};
  try { coresJson = await fetch("../data/cores.json").then(r => r.json()); sys = coresJson.systems[system]; } catch (e) { console.warn("[play] cores.json", e); }
  if (sys && sys.core && !sys.cores.includes(core)) core = sys.core;
  if (!core) return fatal("sistema sem emulador no navegador", sys ? `${sys.fullname || system}: ${sys.note || ""}` : system);
  state.core = core;
  if (sys && sys.saveExt) setSaveName(sys.saveExt);
  state.directExit = !!(sys && sys.directExit);
  // "{rom}" = caminho da ROM (EasyRPG grava em <rom>.save/ ao lado do .zip, que é só leitura); senão relativo a SAVES_DIR
  if (sys && sys.saveTree) { saveTree = sys.saveTree.includes("{rom}") ? sys.saveTree.replace("{rom}", rom) : `${SAVES_DIR}/${sys.saveTree}`; setSaveName(".savedata"); }

  // 1. save pendente de uma sessão anterior que não subiu: reenvia antes de tudo
  const pending = await pendingGet();
  if (pending && pending.data) {
    log("reenviando save pendente do IndexedDB");
    try { await putSave(pending.data); await pendingDel(); }
    catch (e) { return fatal("save pendente não pôde ser enviado ao servidor", e.message); }
  }

  // 2. save do servidor (404 = sem save: tenta o .srm do cartão ao lado da ROM). Outra falha: não inicia
  show("carregando…", romName);
  let srm = null;
  try {
    const r = await fetch(saveUrl, { cache: "no-store" });
    if (r.status === 200) srm = new Uint8Array(await r.arrayBuffer());
    else if (r.status !== 404) throw new Error(`HTTP ${r.status}`);
  } catch (e) { return fatal("não deu para ler o save no servidor", e.message); }
  if (!srm && !saveTree) {
    const r = await fetch(fsUrl(`${dirOf(rom)}/${srmName}`)).catch(() => null);
    if (r && r.status === 200) { srm = new Uint8Array(await r.arrayBuffer()); state.srmFromCard = true; log("save inicial do cartão:", srm.length, "bytes"); }
  }
  // NDS: o DraStic do aparelho grava <pasta>/backup/<jogo>.dsv (formato DeSmuME: save cru + rodapé "|-DESMUME SAVE-|"
  // de 122 bytes); o melonDS lê o save cru (.sav). cores.json "cardSave" diz onde procurar.
  if (!srm && sys && sys.cardSave) {
    const cs = sys.cardSave;
    const r = await fetch(fsUrl(`${dirOf(rom)}/${cs.dir}/${stem}${cs.ext}`)).catch(() => null);
    if (r && r.status === 200) {
      let d = new Uint8Array(await r.arrayBuffer());
      const tail = new TextDecoder("latin1").decode(d.subarray(Math.max(0, d.length - 16)));
      if (cs.footer === "desmume" && tail === "|-DESMUME SAVE-|" && d.length > 122) d = d.slice(0, d.length - 122);
      srm = d; state.srmFromCard = true; log(`save inicial do cartão (${cs.dir}/${stem}${cs.ext}):`, srm.length, "bytes");
    }
  }

  // 3. manifesto, ROM (se pequena), núcleo e opções em paralelo
  let manifest, romData, factory, coreOpts, cardOverride;
  const lib = sys && sys.library;
  try {
    manifest = await loadManifest();
    const romEntry = manifest.files[rom];
    const romSize = romEntry ? romEntry.size : await headSize(rom);
    if (romSize < 0) throw new Error("ROM não encontrada no cartão");
    state.romSize = romSize;
    [romData, factory, coreOpts, cardOverride] = await Promise.all([
      romSize <= EAGER_MAX || SHEET.test(rom)
        ? fetch(fsUrl(rom)).then(r => { if (!r.ok) throw new Error(r.status === 503 ? "cartão não montado" : `ROM HTTP ${r.status}`); return r.arrayBuffer(); })
        : ARCHIVE.test(rom) && romSize <= ARCHIVE_MAX ? fetchParts(fsUrl(rom), romSize, romName) : null,
      import(`./${core}_libretro.js`).then(m => m.default),
      textOr404(`${CARD_RA}/retroarch-core-options.cfg`),
      lib ? Promise.all([`${lib}/${lib}.cfg`, `${lib}/${lib}.opt`, `${lib}/${stem}.cfg`, `${lib}/${stem}.opt`]
        .map(f => textOr404(`${CARD_RA}/config/${f.split("/").map(encodeURIComponent).join("/")}`))) : [],
    ]);
  } catch (e) { return fatal("não deu para carregar o jogo", e.message); }
  if (romData && !romData.byteLength) return fatal("ROM vazia", romName);

  const corePath = `${RA}/cores/${core}_libretro.core`;
  let Module;
  try {
    Module = await factory({
      noInitialRun: true,
      canvas,
      locateFile: f => f,
      preRun: [m => { m.ENV.LIBRARY_PATH = corePath; }],
      print: t => console.log("[ra]", t),
      printErr: t => console.log("[ra]", t),
      retroArchExit: () => finish(0, "retroarch saiu"),
    });
  } catch (e) { return fatal("o núcleo não iniciou", String(e)); }
  state.module = Module;
  const FS = Module.FS;
  const mkdirp = p => { let cur = ""; for (const part of p.split("/").filter(Boolean)) { cur += "/" + part; try { FS.mkdir(cur); } catch (e) {} } };
  const romDir = dirOf(rom);
  for (const d of [`${RA}/cores`, romDir, SAVES_DIR, STATES_DIR, SYSTEM_DIR]) mkdirp(d);
  FS.writeFile(corePath, new Uint8Array());   // o núcleo é ligado estaticamente; o RetroArch só confere o arquivo

  // ROM no caminho do aparelho; irmãs da pasta (arcade: BIOS/romset pai; multidisco) e BIOS sob demanda
  const have = new Set();
  for (const [p, f] of Object.entries(manifest.files)) {
    if (p === rom || !(f.kind === "empty" || f.kind === "lazy")) continue;
    if (dirOf(p) === romDir || p.startsWith(SYSTEM_DIR + "/")) { mkdirp(dirOf(p)); lazyFile(FS, p, fsUrl(p), f.size); have.add(p); }
  }
  // arquivos de apoio do núcleo (cores.json "assets": PPSSPP em system_directory/PPSSPP), sob demanda
  if (sys && sys.assets) {
    const idx = await fetch(`${sys.assets.url}/index.json`).then(r => r.ok ? r.json() : {}, () => ({}));
    for (const [rel, size] of Object.entries(idx)) {
      const p = `${sys.assets.mount}/${rel}`; mkdirp(dirOf(p));
      lazyFile(FS, p, `${sys.assets.url}/${rel.split("/").map(encodeURIComponent).join("/")}`, size);
    }
    log("assets do núcleo:", Object.keys(idx).length, "arquivos em", sys.assets.mount);
  }
  for (const [name, from] of Object.entries(coresJson.biosAliases || {})) {
    const src = manifest.files[`${SYSTEM_DIR}/${from}`];
    if (!src) continue;
    const dot = name.lastIndexOf(".");
    for (const n of new Set([name, name.slice(0, dot).toUpperCase() + name.slice(dot)]))   // pcsx_rearmed procura SCPH1001.bin
      if (!have.has(`${SYSTEM_DIR}/${n}`)) lazyFile(FS, `${SYSTEM_DIR}/${n}`, fsUrl(`${SYSTEM_DIR}/${from}`), src.size);
  }
  if (romData) FS.writeFile(rom, new Uint8Array(romData));
  else lazyFile(FS, rom, fsUrl(rom), state.romSize);
  have.add(rom);
  // .cue/.m3u: as faixas/discos citados (as .bin não estão no manifesto: não são extensão de jogo)
  const sheets = romData && SHEET.test(rom) ? [[rom, new TextDecoder().decode(romData)]] : [];
  for (let i = 0; i < sheets.length && i < 16; i++) {
    const [p, text] = sheets[i];
    for (const ref of companionsOf(p, text)) {
      const cp = ref.startsWith("/") ? ref : `${dirOf(p)}/${ref}`;
      if (cp.split("/").includes("..")) continue;
      if (SHEET.test(cp)) { const t = await textOr404(fsUrl(cp)); if (t !== null) { mkdirp(dirOf(cp)); FS.writeFile(cp, t); have.add(cp); sheets.push([cp, t]); } continue; }
      if (have.has(cp)) continue;
      const size = await headSize(cp);
      if (size >= 0) { mkdirp(dirOf(cp)); lazyFile(FS, cp, fsUrl(cp), size); have.add(cp); }
      else console.warn("[play] faixa citada não encontrada:", cp);
    }
  }

  // opções de núcleo do cartão (retroarch-core-options.cfg + .opt do núcleo/jogo) e overrides .cfg filtrados
  const opts = parseCfg(coreOpts);
  const [ovCore, optCore, ovGame, optGame] = cardOverride;
  for (const t of [optCore, optGame]) for (const [k, v] of parseCfg(t)) opts.set(k, v);
  for (const k of [...opts.keys()]) if (CORE_OPT_BLOCK.test(k)) opts.delete(k);
  for (const [k, v] of Object.entries((COARSE && MOBILE_CORE_DEFAULTS[core]) || {})) if (!opts.has(k)) { opts.set(k, v); log("celular:", k, "=", v); }
  for (const [k, v] of Object.entries((COARSE && MOBILE_CORE_FORCE[core]) || {})) { opts.set(k, v); log("celular (forçado):", k, "=", v); }
  FS.writeFile(CORE_OPTS, [...opts].map(([k, v]) => `${k} = "${v}"`).join("\n") + "\n");
  let cfg = RETROARCH_CFG + RETROARCH_PADS;
  // analógicos (aba Configurar do site, web/settings.js): a zona morta já vem aplicada no controle mapeado e no toque
  // (navigator.getGamepads do iframe), então a do RetroArch fica 0; a sensibilidade é a escolhida
  let prefs = null;
  try { prefs = JSON.parse(localStorage.getItem("r36s-controles-v1") || "null"); } catch (e) {}
  const sens = Math.min(2, Math.max(0.5, +(prefs && prefs.analog && prefs.analog.sensitivity) || 1));
  const wrapped = (() => { try { return parent !== window && !!parent.r36sPads; } catch (e) { return false; } })();
  const dz = wrapped ? 0 : Math.min(0.5, Math.max(0, prefs && prefs.analog && prefs.analog.deadzone != null ? +prefs.analog.deadzone : 0.15));
  cfg += `input_analog_deadzone = "${dz.toFixed(6)}"\ninput_analog_sensitivity = "${sens.toFixed(6)}"\n`;
  const applied = [];
  for (const t of [ovCore, ovGame]) for (const [k, v] of parseCfg(t)) if (!OVERRIDE_BLOCK.test(k)) { cfg += `${k} = "${v}"\n`; applied.push(k); }
  if (applied.length) log("overrides do cartão:", applied.join(", "));
  state.coreOptions = opts.size;
  FS.writeFile(CFG, cfg);
  if (srm && saveTree) { const n = unpackTree(FS, saveTree, srm, mkdirp); sync.last = hash(packTree(FS, saveTree)); log("save em árvore:", n, "arquivos"); }
  else if (srm) { FS.writeFile(srmPath, srm); sync.last = hash(srm); log("save:", srm.length, "bytes"); }

  msg.style.display = "none";
  canvas.focus();
  state.started = true;
  state.timer = setInterval(checkSave, SYNC_MS);
  postParent({ type: "r36s-started", core });
  Module.callMain(["-v", "-c", CFG, rom]);
}

// layout WASD+JKUI: Select+Start (Backspace+Enter) sai do jogo. O RetroArch só faz atalho de 2 teclas
// com "hotkey enable", que obrigaria segurar Select também no Esc (menu); então a combinação é detectada
// aqui e vira um F12 sintético (input_exit_emulator = f12, sem hotkey).
const held = new Set();
function sendKey(type, key) {
  canvas.dispatchEvent(new KeyboardEvent(type, { key, code: key, keyCode: 123, which: 123, bubbles: true, cancelable: true }));
}
addEventListener("keydown", e => {
  if (!e.isTrusted) return;
  held.add(e.code);
  if (held.has("Backspace") && held.has("Enter")) {
    held.clear();
    // núcleo que quebra ao descarregar (ppsspp: "memory access out of bounds" no unload com pthreads): sai direto, sem
    // passar pelo quit do RetroArch (o save dele já está nos arquivos do memory stick; o finish sobe o blob)
    if (state.directExit) { finish(0, "saída direta"); return; }
    // ainda baixando: o RetroArch não começou; avisa a página do seletor para fechar
    if (!state.started && embedded) { postParent({ type: "r36s-exit", code: 1, saved: true }); return; }
    sendKey("keydown", "F12");
    setTimeout(() => sendKey("keyup", "F12"), 120);
  }
}, true);
// erro fatal do núcleo depois de iniciado (trap do wasm no laço principal): não deixa o seletor esperando para sempre
const crashed = ev => {
  if (!state.started || state.finished) return;
  const m = String(ev.error || ev.reason || ev.message || ev);
  if (!/RuntimeError|unreachable|out of bounds|signature mismatch|abort/i.test(m)) return;
  console.error("[play] núcleo abortou:", m);
  finish(3, "núcleo abortou");
};
addEventListener("error", crashed);
addEventListener("unhandledrejection", crashed);
addEventListener("keyup", e => { if (e.isTrusted) held.delete(e.code); }, true);
addEventListener("blur", () => held.clear());

// teclas que o navegador usaria (F1 ajuda, F3 busca, setas rolando, Esc) ficam com o jogo
const BLOCK = new Set(["F1", "F2", "F3", "F4", "F6", "F7", "F5", "F12", "Tab", "Escape", "Enter", " ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Backspace"]);
addEventListener("keydown", e => { if (BLOCK.has(e.key)) e.preventDefault(); }, true);
addEventListener("pointerdown", () => canvas.focus());
// aba/janela fechando com o jogo aberto: última tentativa de subir o save
addEventListener("pagehide", () => {
  if (state.finished || !state.module) return;
  try { const d = readSave(state.module.FS); if (d && hash(d) !== sync.last) { pendingSet(d.slice()); fetch(saveUrl, { method: "PUT", body: d, keepalive: true }); } } catch (e) {}
});

main().catch(e => fatal("erro inesperado", String(e && e.stack || e)));
