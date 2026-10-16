// Player do RetroArch web para o R36S no navegador (ver play.html e docs/port-notes.md, seção RetroArch).
// Fluxo: valida parâmetros -> reenvia save pendente do IndexedDB -> baixa save do servidor (404 = sem save;
// erro de rede = NÃO inicia) -> baixa ROM (fs/roms/...) -> sobe o núcleo (snes9x_libretro.js) com MEMFS e
// um retroarch.cfg derivado do dArkOS -> a cada 2 s sobe o .srm se mudou -> na saída, PUT final e avisa o pai.

const RA = "/home/web_user/retroarch";
const CFG = `${RA}/userdata/retroarch.cfg`;
const CONTENT_DIR = `${RA}/userdata/content`;
const SAVES_DIR = `${RA}/userdata/saves`;
const STATES_DIR = `${RA}/userdata/states`;
const SYSTEM_DIR = `${RA}/userdata/system`;
const SYNC_MS = 2000;

const params = new URLSearchParams(location.search);
const system = params.get("system") || "";
const core = params.get("core") || "";
const rom = params.get("rom") || "";
const embedded = window.parent !== window;
const msg = document.getElementById("msg");
const syncEl = document.getElementById("sync");
const canvas = document.getElementById("canvas");
const log = (...a) => console.log("[play]", ...a);
const state = { module: null, finished: false, started: false };
window.r36sPlay = state;   // inspeção nos testes

// teclado: mesmo do ES (setas, Enter=A, Esc=B, F1=Start, F2=Select) + X=S, Y=A, L=Q, R=W (as teclas do retroarch.cfg
// real do dArkOS para X/Y/L/R). Atalhos com Select (F2) segurado, como no aparelho (Select = hotkey):
// Select+Start = sair, Select+Esc(B) = salvar estado, Select+Enter(A) = carregar estado, Select+F3 = menu do RetroArch.
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
input_player1_a = "k"
input_player1_b = "j"
input_player1_x = "i"
input_player1_y = "u"
input_player1_l = "q"
input_player1_r = "e"
input_player1_l2 = "nul"
input_player1_r2 = "nul"
input_player1_l3 = "nul"
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
`;

function show(text, sub, err) {
  msg.className = err ? "err" : "";
  msg.innerHTML = "";
  msg.append(text);
  if (sub) { const s = document.createElement("small"); s.textContent = sub; msg.append(s); }
  msg.style.display = "flex";
}

function postParent(data) {
  if (embedded) parent.postMessage(data, location.origin);
}

// ---------- saves: servidor + IndexedDB para o que não subiu ----------
const romName = rom.slice(rom.lastIndexOf("/") + 1);
const stem = romName.includes(".") ? romName.slice(0, romName.lastIndexOf(".")) : romName;
const srmName = stem + ".srm";
const srmPath = `${SAVES_DIR}/${srmName}`;
const saveUrl = `../saves/${encodeURIComponent(system)}/${encodeURIComponent(srmName)}`;
const pendingKey = `${system}/${srmName}`;

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

function checkSave() {
  const FS = state.module && state.module.FS;
  if (!FS) return;
  let data;
  try { data = FS.readFile(srmPath); } catch (e) { return; }   // ainda não existe
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

// erro antes de iniciar: mostra e sai com qualquer tecla (ou em 8 s, dentro do ES)
function fatal(text, detail) {
  console.error("[play]", text, detail || "");
  show(text, (detail ? detail + " — " : "") + "aperte qualquer tecla para voltar", true);
  const go = () => { removeEventListener("keydown", go); finish(2, text); };
  addEventListener("keydown", go);
  if (embedded) setTimeout(go, 8000);
}

// ---------- início ----------
async function main() {
  if (!/^[a-z0-9_-]+$/.test(system) || !/^[a-z0-9_]+$/.test(core) || !rom.startsWith("/roms/") || rom.split("/").includes(".."))
    return fatal("parâmetros inválidos", `system=${system} core=${core} rom=${rom}`);

  // 1. save pendente de uma sessão anterior que não subiu: reenvia antes de tudo
  const pending = await pendingGet();
  if (pending && pending.data) {
    log("reenviando save pendente do IndexedDB");
    try { await putSave(pending.data); await pendingDel(); }
    catch (e) { return fatal("save pendente não pôde ser enviado ao servidor", e.message); }
  }

  // 2. save do servidor (404 = sem save). Qualquer outra falha: não inicia (não sobrescrever progresso)
  show("carregando…", romName);
  let srm = null;
  try {
    const r = await fetch(saveUrl, { cache: "no-store" });
    if (r.status === 200) srm = new Uint8Array(await r.arrayBuffer());
    else if (r.status !== 404) throw new Error(`HTTP ${r.status}`);
  } catch (e) { return fatal("não deu para ler o save no servidor", e.message); }

  // 3. ROM + núcleo em paralelo
  const romUrl = "../fs" + rom.split("/").map(encodeURIComponent).join("/");
  let romData, factory;
  try {
    [romData, factory] = await Promise.all([
      fetch(romUrl).then(r => { if (!r.ok) throw new Error(`ROM HTTP ${r.status}`); return r.arrayBuffer(); }),
      import(`./${core}_libretro.js`).then(m => m.default),
    ]);
  } catch (e) { return fatal("não deu para carregar o jogo", e.message); }
  if (!romData.byteLength) return fatal("ROM vazia", romName);

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
  for (const d of [`${RA}/cores`, CONTENT_DIR, SAVES_DIR, STATES_DIR, SYSTEM_DIR]) mkdirp(d);
  FS.writeFile(corePath, new Uint8Array());   // o núcleo é ligado estaticamente; o RetroArch só confere o arquivo
  FS.writeFile(CFG, RETROARCH_CFG);
  const contentPath = `${CONTENT_DIR}/${romName}`;
  FS.writeFile(contentPath, new Uint8Array(romData));
  if (srm) { FS.writeFile(srmPath, srm); sync.last = hash(srm); log("save do servidor:", srm.length, "bytes"); }

  msg.style.display = "none";
  canvas.focus();
  state.started = true;
  state.timer = setInterval(checkSave, SYNC_MS);
  postParent({ type: "r36s-started" });
  Module.callMain(["-v", "-c", CFG, contentPath]);
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
    sendKey("keydown", "F12");
    setTimeout(() => sendKey("keyup", "F12"), 120);
  }
}, true);
addEventListener("keyup", e => { if (e.isTrusted) held.delete(e.code); }, true);
addEventListener("blur", () => held.clear());

// teclas que o navegador usaria (F1 ajuda, F3 busca, setas rolando, Esc) ficam com o jogo
const BLOCK = new Set(["F1", "F2", "F3", "F4", "F6", "F7", "F5", "F12", "Tab", "Escape", "Enter", " ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Backspace"]);
addEventListener("keydown", e => { if (BLOCK.has(e.key)) e.preventDefault(); }, true);
addEventListener("pointerdown", () => canvas.focus());
// aba/janela fechando com o jogo aberto: última tentativa de subir o save
addEventListener("pagehide", () => {
  if (state.finished || !state.module) return;
  try { const d = state.module.FS.readFile(srmPath); if (hash(d) !== sync.last) { pendingSet(d.slice()); fetch(saveUrl, { method: "PUT", body: d, keepalive: true }); } } catch (e) {}
});

main().catch(e => fatal("erro inesperado", String(e && e.stack || e)));
