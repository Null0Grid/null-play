'use strict';
// Steam: installed games from every library folder, play time / last played
// from the most recent user's localconfig.vdf, and art from Steam's own
// library cache. Launch goes through Steam itself (steam://rungameid/<id>).
const fs = require('fs');
const path = require('path');
const vdf = require('./vdf');

// Native and Flatpak installs; the first one that exists wins (they are
// usually the same folder behind a symlink).
function steamRoots(home) {
  const cands = [
    path.join(home, '.steam', 'steam'),
    path.join(home, '.local', 'share', 'Steam'),
    path.join(home, '.var', 'app', 'com.valvesoftware.Steam', '.local', 'share', 'Steam'),
    path.join(home, '.var', 'app', 'com.valvesoftware.Steam', 'data', 'Steam'),
  ];
  const seen = new Set();
  const out = [];
  for (const c of cands) {
    let real;
    try { real = fs.realpathSync(c); } catch { continue; }
    if (seen.has(real)) continue;
    if (!fs.existsSync(path.join(real, 'steamapps'))) continue;
    seen.add(real);
    out.push({ root: real, flatpak: c.includes('com.valvesoftware.Steam') });
  }
  return out;
}

// Tools Steam installs alongside games; never shown as games.
const TOOL_IDS = new Set(['228980', '1070560', '1391110', '1628350', '1493710', '2180100', '1826330', '1580130', '2805730', '3658110']);
const TOOL_NAME = /^(Proton\b|Steam Linux Runtime|Steamworks Common|SteamVR\b)/i;

function readText(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } }

function libraryFolders(root) {
  const out = new Set([path.join(root, 'steamapps')]);
  const txt = readText(path.join(root, 'steamapps', 'libraryfolders.vdf')) || readText(path.join(root, 'config', 'libraryfolders.vdf'));
  if (txt) {
    const lf = vdf.parse(txt).libraryfolders || {};
    for (const k of Object.keys(lf)) {
      const v = lf[k];
      const p = typeof v === 'string' ? v : v && v.path;
      if (p && /^\//.test(p)) out.add(path.join(p, 'steamapps'));
    }
  }
  return [...out].filter((p) => fs.existsSync(p));
}

// play time + last played, keyed by appid; merges every local user and keeps
// the largest numbers (one Steam account is the normal case)
function userStats(root) {
  const stats = {};
  let users = [];
  try { users = fs.readdirSync(path.join(root, 'userdata')).filter((d) => /^\d+$/.test(d) && d !== '0'); } catch {}
  for (const u of users) {
    const txt = readText(path.join(root, 'userdata', u, 'config', 'localconfig.vdf'));
    if (!txt) continue;
    const cfg = vdf.parse(txt);
    const store = cfg.userlocalconfigstore || {};
    const sw = store.software || {};
    const apps = ((sw.valve || {}).steam || {}).apps || ((sw.valve || {}).steam || {}).Apps || {};
    for (const id of Object.keys(apps)) {
      const a = apps[id] || {};
      const pt = parseInt(a.playtime, 10) || 0;          // minutes
      const lp = parseInt(a.lastplayed, 10) || 0;        // unix seconds
      const cur = stats[id] || { playtimeMin: 0, lastPlayed: 0 };
      stats[id] = { playtimeMin: Math.max(cur.playtimeMin, pt), lastPlayed: Math.max(cur.lastPlayed, lp) };
    }
  }
  return stats;
}

// Steam's library cache has two layouts: the old flat one
// (<id>_library_600x900.jpg) and the newer per-app folders, which may keep
// the images one hashed subfolder deeper.
function findArt(root, appid) {
  const dir = path.join(root, 'appcache', 'librarycache');
  const want = { cover: 'library_600x900', hero: 'library_hero', logo: 'logo', header: 'header' };
  const art = {};
  for (const [k, base] of Object.entries(want)) {
    for (const ext of ['.jpg', '.png']) {
      const flat = path.join(dir, appid + '_' + base + ext);
      if (fs.existsSync(flat)) { art[k] = flat; break; }
    }
  }
  const appDir = path.join(dir, appid);
  const scan = (d, depth) => {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) { if (depth < 2) scan(full, depth + 1); continue; }
      const stem = e.name.replace(/\.(jpg|png)$/i, '');
      for (const [k, base] of Object.entries(want)) if (!art[k] && stem === base) art[k] = full;
    }
  };
  scan(appDir, 0);
  return art;
}

function scanSteam(home) {
  const games = [];
  const seen = new Set();
  for (const { root, flatpak } of steamRoots(home)) {
    const stats = userStats(root);
    for (const lib of libraryFolders(root)) {
      let files = [];
      try { files = fs.readdirSync(lib).filter((f) => /^appmanifest_\d+\.acf$/.test(f)); } catch {}
      for (const f of files) {
        const st = (vdf.parse(readText(path.join(lib, f)) || '').appstate) || {};
        const appid = String(st.appid || f.match(/\d+/)[0]);
        const name = st.name || ('Steam app ' + appid);
        if (seen.has(appid) || TOOL_IDS.has(appid) || TOOL_NAME.test(name)) continue;
        seen.add(appid);
        // StateFlags 4 = fully installed; anything else is updating / partial
        const flags = parseInt(st.stateflags, 10) || 0;
        const s = stats[appid] || {};
        games.push({
          id: 'steam:' + appid,
          source: 'steam',
          title: name,
          installed: (flags & 4) === 4,
          launch: { kind: 'url', url: 'steam://rungameid/' + appid, flatpakApp: flatpak ? 'com.valvesoftware.Steam' : null },
          art: findArt(root, appid),
          playtimeMin: s.playtimeMin || 0,
          lastPlayed: s.lastPlayed || parseInt(st.lastplayed, 10) || 0,
          sizeBytes: parseInt(st.sizeondisk, 10) || 0,
          ids: { steam: appid },
        });
      }
    }
  }
  return games;
}

module.exports = { scanSteam, steamRoots, findArt, userStats };
