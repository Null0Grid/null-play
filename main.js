'use strict';
// NULL // PLAY: full-screen game launcher for Null OS.
//   null-play              full screen (what `gamemode` runs)
//   null-play --windowed   in a window, for development
const { app, BrowserWindow, ipcMain, protocol, net, screen, dialog, safeStorage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { scanAll } = require('./src/scan');
const { AntiCheat, loadSnapshot, compact, RAW_URL } = require('./src/anticheat');
const { launch, openLauncher } = require('./src/launch');
const { ArtManager, KINDS } = require('./src/art');
const { System } = require('./src/system');

const WINDOWED = process.argv.includes('--windowed') || process.env.NULLPLAY_WINDOWED === '1';
const HOME = process.env.NULLPLAY_HOME || os.homedir();

app.setName('null-play');
// fixed folder name (the product name has slashes in it)
app.setPath('userData', path.join(app.getPath('appData'), 'null-play'));
if (process.env.NULLPLAY_USER_DATA) app.setPath('userData', process.env.NULLPLAY_USER_DATA);

if (!app.requestSingleInstanceLock()) { app.quit(); }

protocol.registerSchemesAsPrivileged([{ scheme: 'np-art', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

// ---------- small JSON stores in the user data folder ----------
function store(name, fallback) {
  const file = path.join(app.getPath('userData'), name);
  let data = fallback;
  try { data = { ...fallback, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch {}
  let timer = null;
  return {
    get data() { return data; },
    save() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify(data)); fs.renameSync(file + '.tmp', file); } catch {}
      }, 150);
    },
  };
}

let settings, history;
let win = null;
let library = { games: [], report: {}, scannedAt: 0 };
let byId = new Map();
let anticheat = new AntiCheat([]);
let acInfo = { fetched: null, count: 0 };
let art = null;

// local art is served only for paths a scan returned, behind opaque tokens
const artTokens = new Map();
function artRef(p) {
  if (!p) return undefined;
  if (/^https:\/\//.test(p)) return p;
  const t = crypto.createHash('sha1').update(p).digest('hex').slice(0, 20) + path.extname(p).toLowerCase();
  artTokens.set(t, p);
  return 'np-art://img/' + t;
}

// what the renderer sees: no launch commands or file paths
function gameOpts(id) { return (settings.data.games && settings.data.games[id]) || {}; }

function publicGame(g) {
  const a = art ? art.resolve(g) : (g.art || {});
  const o = gameOpts(g.id);
  return {
    id: g.id, title: g.title, source: g.source, store: g.store, installed: g.installed,
    playtimeMin: g.playtimeMin, lastPlayed: g.lastPlayed, sizeBytes: g.sizeBytes,
    favorite: g.favorite, anticheat: g.anticheat,
    art: { cover: artRef(a.cover), hero: artRef(a.hero), logo: artRef(a.logo), header: artRef(a.header), icon: artRef(a.icon), userSet: a.userSet || {} },
    // GameMode: our own switch only applies where we start the game (installed
    // games) or can find its process (Steam); Heroic / Lutris have their own
    gamemodeHere: g.source === 'desktop' || g.source === 'steam',
    gamemode: o.gamemode !== undefined ? !!o.gamemode : settings.data.gamemode !== false,
    hideFromContinue: !!o.hideFromContinue,
    canOpenLauncher: g.source !== 'desktop',
  };
}

// ---------- SteamGridDB key (kept with the OS keyring when one is available) ----------
function getSgdbKey() {
  if (process.env.NULLPLAY_SGDB_KEY) return process.env.NULLPLAY_SGDB_KEY;
  const k = settings.data.sgdbKey;
  if (!k) return '';
  if (k.enc) { try { return safeStorage.decryptString(Buffer.from(k.enc, 'base64')); } catch { return ''; } }
  return k.plain || '';
}
function setSgdbKey(key) {
  if (!key) { delete settings.data.sgdbKey; settings.save(); return; }
  let enc = null;
  try { if (safeStorage.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend() !== 'basic_text') enc = safeStorage.encryptString(key).toString('base64'); } catch {}
  settings.data.sgdbKey = enc ? { enc } : { plain: key };
  settings.save();
}

// fill in missing art in the background; repaint as pieces arrive
let fillTimer = null;
function scheduleArtFill() {
  clearTimeout(fillTimer);
  fillTimer = setTimeout(async () => {
    if (!art) return;
    const recent = library.games.filter((g) => g.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, 10);
    let pending = false;
    let t = null;
    const n = await art.autoFill(library.games, {
      heroFor: new Set(recent.map((g) => g.id)),
      onChange: () => { pending = true; clearTimeout(t); t = setTimeout(() => { pending = false; send('library:changed', snapshot()); }, 400); },
    });
    if (n && pending) { clearTimeout(t); send('library:changed', snapshot()); }
  }, 300);
}

async function rescan() {
  library = await scanAll({
    home: HOME,
    env: process.env,
    anticheat,
    history: history.data.games,
    favorites: settings.data.favorites,
    onProgress: (source, found) => send('scan:progress', { source, found }),
  });
  byId = new Map(library.games.map((g) => [g.id, g]));
  if (process.env.NULLPLAY_OFFLINE !== '1' || process.env.NULLPLAY_SGDB_BASE) scheduleArtFill();
  return snapshot();
}

function snapshot() {
  return {
    games: library.games.map(publicGame),
    report: library.report,
    scannedAt: library.scannedAt,
    ms: library.ms,
    anticheat: acInfo,
  };
}

// weekly refresh of the anti-cheat list, in the background, never blocking
async function refreshAntiCheat() {
  const cache = path.join(app.getPath('userData'), 'anticheat.json');
  const snap = loadSnapshot(cache);
  anticheat.load(snap.games);
  acInfo = { fetched: snap.fetched, count: snap.games.length };
  if (process.env.NULLPLAY_OFFLINE === '1') return;
  const age = snap.fetched ? Date.now() - Date.parse(snap.fetched) : Infinity;
  if (snap.from === cache && age < 7 * 864e5) return;
  try {
    const res = await net.fetch(RAW_URL, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return;
    const games = compact(await res.json());
    if (games.length < 100) return;
    const out = { source: 'https://github.com/AreWeAntiCheatYet/AreWeAntiCheatYet', license: 'MIT', fetched: new Date().toISOString(), games };
    fs.writeFileSync(cache, JSON.stringify(out));
    anticheat.load(games);
    acInfo = { fetched: out.fetched, count: games.length };
    for (const g of library.games) g.anticheat = anticheat.lookup(g);
    if (win && !win.isDestroyed()) win.webContents.send('library:changed', snapshot());
  } catch {}
}

function createWindow() {
  // full screen asks the window manager; also size the window to the whole
  // display so it fills the screen even where there is no window manager
  const b = WINDOWED ? null : screen.getPrimaryDisplay().bounds;
  win = new BrowserWindow({
    x: b ? b.x : undefined,
    y: b ? b.y : undefined,
    width: b ? b.width : 1440,
    height: b ? b.height : 810,
    fullscreen: !WINDOWED,
    frame: WINDOWED,
    autoHideMenuBar: true,
    backgroundColor: '#0a0a0f',
    title: 'NULL // PLAY',
    icon: path.join(__dirname, 'build', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  win.removeMenu();
  win.once('ready-to-show', () => { win.show(); win.focus(); });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // nothing navigates away from the launcher; links open in the system handler
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('closed', () => { win = null; });
}

function send(ch, payload) { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); }

app.on('second-instance', () => {
  // `gamemode` typed again: bring the running launcher to the front
  if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
});

app.whenReady().then(async () => {
  settings = store('settings.json', { favorites: [], gamemode: true, games: {} });
  if (!settings.data.games) settings.data.games = {};
  art = new ArtManager({
    dir: path.join(app.getPath('userData'), 'art'),
    fetch: (u, o) => net.fetch(u, o),
    getKey: getSgdbKey,
    base: process.env.NULLPLAY_SGDB_BASE,
  });
  history = store('history.json', { games: {} });

  protocol.handle('np-art', (req) => {
    const u = new URL(req.url);
    const p = artTokens.get(u.pathname.replace(/^\//, ''));
    if (!p) return new Response('not found', { status: 404 });
    return net.fetch(pathToFileURL(p).toString());
  });

  ipcMain.handle('library:get', () => (library.scannedAt ? snapshot() : rescan()));
  ipcMain.handle('library:rescan', () => rescan());

  ipcMain.handle('game:favorite', (_e, id, on) => {
    const g = byId.get(String(id));
    if (!g) return false;
    const fav = new Set(settings.data.favorites);
    if (on) fav.add(g.id); else fav.delete(g.id);
    settings.data.favorites = [...fav];
    settings.save();
    g.favorite = !!on;
    return true;
  });

  ipcMain.handle('game:launch', (_e, id) => {
    const g = byId.get(String(id));
    if (!g) return { ok: false, error: 'Game not found. Try rescanning.' };
    const now = Math.floor(Date.now() / 1000);
    const h = history.data.games[g.id] || { playtimeMin: 0, lastPlayed: 0, launches: 0 };
    try {
      const o = gameOpts(g.id);
      const r = launch(g, {
        env: process.env,
        gamemode: o.gamemode !== undefined ? !!o.gamemode : settings.data.gamemode !== false,
        onExit: ({ ms, tracked, error }) => {
          if (error) { send('game:status', { id: g.id, state: 'error', error }); return; }
          if (tracked) {
            const cur = history.data.games[g.id] || h;
            cur.playtimeMin = (cur.playtimeMin || 0) + Math.round(ms / 60000);
            history.data.games[g.id] = cur;
            history.save();
            g.playtimeMin = Math.max(g.playtimeMin, cur.playtimeMin);
            send('game:status', { id: g.id, state: 'ended', playtimeMin: g.playtimeMin });
          }
        },
      });
      h.lastPlayed = now;
      h.launches = (h.launches || 0) + 1;
      history.data.games[g.id] = h;
      history.save();
      g.lastPlayed = Math.max(g.lastPlayed, now);
      return { ok: true, gamemode: r.gamemode, handoff: g.launch.kind !== 'exec', lastPlayed: g.lastPlayed, launcherOnly: g.launch.kind === 'launcher' };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // per-game options from the game page
  ipcMain.handle('game:options', (_e, id, patch) => {
    const g = byId.get(String(id));
    if (!g || !patch || typeof patch !== 'object') return null;
    const o = { ...gameOpts(g.id) };
    if ('gamemode' in patch) o.gamemode = !!patch.gamemode;
    if ('hideFromContinue' in patch) o.hideFromContinue = !!patch.hideFromContinue;
    settings.data.games[g.id] = o;
    settings.save();
    return publicGame(g);
  });

  ipcMain.handle('game:open-launcher', (_e, id) => {
    const g = byId.get(String(id));
    if (!g) return { ok: false, error: 'Game not found' };
    try { openLauncher(g, process.env); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
  });

  // ---------- artwork ----------
  const kindOk = (k) => KINDS.includes(k);
  const artErr = (e) => ({ ok: false, code: e.code || null, error: e.message });
  ipcMain.handle('art:status', () => ({ hasKey: !!getSgdbKey() }));
  ipcMain.handle('art:set-key', async (_e, key) => {
    key = String(key || '').trim();
    if (!/^[A-Za-z0-9]{16,64}$/.test(key)) return { ok: false, error: 'That doesn\u2019t look like a SteamGridDB API key.' };
    const prev = getSgdbKey();
    setSgdbKey(key);
    try { await art.checkKey(); scheduleArtFill(); return { ok: true }; }
    catch (e) { if (e.code === 'BAD_KEY') { setSgdbKey(prev); return { ok: false, error: 'SteamGridDB didn\u2019t accept that key.' }; } return { ok: true, warning: 'Saved, but SteamGridDB couldn\u2019t be reached right now.' }; }
  });
  ipcMain.handle('art:options', async (_e, id, kind) => {
    const g = byId.get(String(id));
    if (!g || !kindOk(kind)) return { ok: false, error: 'bad request' };
    if (!getSgdbKey()) return { ok: false, code: 'NO_KEY' };
    try { return { ok: true, options: await art.listOptions(g, kind) }; } catch (e) { return artErr(e); }
  });
  ipcMain.handle('art:pick', async (_e, id, kind, index) => {
    const g = byId.get(String(id));
    if (!g || !kindOk(kind)) return { ok: false, error: 'bad request' };
    try { await art.pick(g, kind, Number(index)); return { ok: true, game: publicGame(g) }; } catch (e) { return artErr(e); }
  });
  ipcMain.handle('art:file', async (_e, id, kind) => {
    const g = byId.get(String(id));
    if (!g || !kindOk(kind)) return { ok: false, error: 'bad request' };
    const pickPath = process.env.NULLPLAY_TEST_PICK_FILE; // tests can't click a native dialog
    let file = pickPath;
    if (!file) {
      const r = await dialog.showOpenDialog(win, { title: 'Choose ' + kind + ' art for ' + g.title, properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
      if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
      file = r.filePaths[0];
    }
    try { art.importFile(g.id, kind, file); return { ok: true, game: publicGame(g) }; } catch (e) { return artErr(e); }
  });
  ipcMain.handle('art:reset', (_e, id, kind) => {
    const g = byId.get(String(id));
    if (!g || !kindOk(kind)) return { ok: false, error: 'bad request' };
    art.reset(g.id, kind);
    return { ok: true, game: publicGame(g) };
  });

  // ---------- quick settings ----------
  const sys = new System({ env: process.env, backlightDir: process.env.NULLPLAY_BACKLIGHT_DIR || '/sys/class/backlight' });
  ipcMain.handle('sys:status', () => sys.status());
  ipcMain.handle('sys:wifi-list', () => sys.wifiList());
  ipcMain.handle('sys:wifi-connect', (_e, ssid, password) => sys.wifiConnect(String(ssid || ''), password == null ? null : String(password)));
  ipcMain.handle('sys:wifi-radio', (_e, on) => sys.wifiRadio(!!on));
  ipcMain.handle('sys:volume', (_e, level) => sys.setVolume(Number(level)));
  ipcMain.handle('sys:mute', () => sys.toggleMute());
  ipcMain.handle('sys:brightness', (_e, level) => sys.setBrightness(Number(level)));
  ipcMain.handle('sys:controllers', () => sys.controllers());
  ipcMain.handle('sys:bt-scan', () => sys.btScan(Number(process.env.NULLPLAY_BT_SCAN_SECS) || 12));
  ipcMain.handle('sys:bt-pair', (_e, mac) => sys.btPair(String(mac || '')));
  ipcMain.handle('sys:bt-connect', (_e, mac, on) => sys.btConnect(String(mac || ''), !!on));
  ipcMain.handle('sys:bt-forget', (_e, mac) => sys.btForget(String(mac || '')));
  ipcMain.handle('sys:power', (_e, action) => sys.power(String(action || '')));

  ipcMain.handle('app:quit', () => app.quit());
  ipcMain.handle('app:info', () => ({ version: app.getVersion(), windowed: WINDOWED }));

  // loads the cached / bundled list synchronously, then refreshes in the background
  refreshAntiCheat().catch(() => {});
  createWindow();
});

app.on('window-all-closed', () => app.quit());
