'use strict';
// NULL // PLAY: full-screen game launcher for Null OS.
//   null-play              full screen (what `gamemode` runs)
//   null-play --windowed   in a window, for development
const { app, BrowserWindow, ipcMain, protocol, net, screen } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { scanAll } = require('./src/scan');
const { AntiCheat, loadSnapshot, compact, RAW_URL } = require('./src/anticheat');
const { launch } = require('./src/launch');

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
function publicGame(g) {
  const a = g.art || {};
  return {
    id: g.id, title: g.title, source: g.source, store: g.store, installed: g.installed,
    playtimeMin: g.playtimeMin, lastPlayed: g.lastPlayed, sizeBytes: g.sizeBytes,
    favorite: g.favorite, anticheat: g.anticheat,
    art: { cover: artRef(a.cover), hero: artRef(a.hero), logo: artRef(a.logo), header: artRef(a.header), icon: artRef(a.icon) },
  };
}

async function rescan() {
  library = await scanAll({
    home: HOME,
    env: process.env,
    anticheat,
    history: history.data.games,
    favorites: settings.data.favorites,
  });
  byId = new Map(library.games.map((g) => [g.id, g]));
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
  settings = store('settings.json', { favorites: [], gamemode: true });
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
      const r = launch(g, {
        env: process.env,
        gamemode: settings.data.gamemode !== false,
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

  ipcMain.handle('app:quit', () => app.quit());
  ipcMain.handle('app:info', () => ({ version: app.getVersion(), windowed: WINDOWED }));

  // loads the cached / bundled list synchronously, then refreshes in the background
  refreshAntiCheat().catch(() => {});
  createWindow();
});

app.on('window-all-closed', () => app.quit());
