'use strict';
// Installed games from .desktop files (Categories=Game): distro packages,
// Flathub apps and anything else that registers itself as a game. Entries
// that Steam, Heroic or Lutris generated are skipped (those scans cover them),
// as are the launchers themselves.
const fs = require('fs');
const path = require('path');

function dataDirs(home, env) {
  const xdgHome = env.XDG_DATA_HOME || path.join(home, '.local', 'share');
  const sys = (env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':').filter(Boolean);
  const dirs = [xdgHome, path.join(xdgHome, 'flatpak', 'exports', 'share'), ...sys, '/var/lib/flatpak/exports/share'];
  return [...new Set(dirs)];
}

function parseDesktop(text) {
  const out = {};
  let inMain = false;
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line || line[0] === '#') continue;
    if (line[0] === '[') { inMain = line === '[Desktop Entry]'; continue; }
    if (!inMain) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    if (!(k in out)) out[k] = line.slice(eq + 1).trim();
  }
  return out;
}

// Desktop Entry spec quoting; field codes (%f %U …) are dropped, %% → %
function splitExec(exec) {
  const args = [];
  let cur = '';
  let quoted = false;
  let had = false;
  for (let i = 0; i < exec.length; i++) {
    const c = exec[i];
    if (quoted) {
      if (c === '\\' && i + 1 < exec.length && '"`$\\'.includes(exec[i + 1])) { cur += exec[++i]; continue; }
      if (c === '"') { quoted = false; continue; }
      cur += c;
      continue;
    }
    if (c === '"') { quoted = true; had = true; continue; }
    if (c === ' ' || c === '\t') { if (cur || had) args.push(cur); cur = ''; had = false; continue; }
    cur += c;
  }
  if (cur || had) args.push(cur);
  return args
    .filter((a) => !/^%[fFuUdDnNickvm]$/.test(a))
    .map((a) => a.replace(/%%/g, '\u0000').replace(/%[fFuUdDnNickvm]/g, '').replace(/\u0000/g, '%'));
}

const SKIP_IDS = new Set([
  'steam', 'com.valvesoftware.steam', 'heroic', 'com.heroicgameslauncher.hgl',
  'lutris', 'net.lutris.lutris', 'null-play', 'dev.nullgrid.nullplay',
]);
const DUPE_EXEC = /steam:\/\/rungameid|heroic:\/\/launch|lutris:rungameid/i;

const ICON_SIZES = ['512x512', '256x256', '192x192', '128x128', 'scalable', '96x96', '64x64'];
function findIcon(icon, dirs) {
  if (!icon) return undefined;
  if (path.isAbsolute(icon)) return fs.existsSync(icon) ? icon : undefined;
  for (const d of dirs) {
    for (const size of ICON_SIZES) {
      for (const ext of ['.png', '.svg']) {
        const p = path.join(d, 'icons', 'hicolor', size, 'apps', icon + ext);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  for (const d of dirs) for (const ext of ['.png', '.svg', '.xpm']) {
    const p = path.join(d, 'pixmaps', icon + ext);
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

function scanDesktop(home, env) {
  const dirs = dataDirs(home, env);
  const byId = new Map();
  for (const d of dirs) {
    const appDir = path.join(d, 'applications');
    let files = [];
    try { files = fs.readdirSync(appDir).filter((f) => f.endsWith('.desktop')); } catch { continue; }
    for (const f of files) {
      const deskId = f.replace(/\.desktop$/, '');
      if (byId.has(deskId)) continue; // earlier data dirs win, per XDG
      let txt;
      try { txt = fs.readFileSync(path.join(appDir, f), 'utf8'); } catch { continue; }
      byId.set(deskId, { file: path.join(appDir, f), e: parseDesktop(txt) });
    }
  }
  const games = [];
  for (const [deskId, { file, e }] of byId) {
    if (e.Type && e.Type !== 'Application') continue;
    const cats = (e.Categories || '').split(';').filter(Boolean);
    if (!cats.includes('Game')) continue;
    if (/^true$/i.test(e.NoDisplay || '') || /^true$/i.test(e.Hidden || '')) continue;
    if (SKIP_IDS.has(deskId.toLowerCase())) continue;
    if (!e.Exec || DUPE_EXEC.test(e.Exec)) continue;
    const argv = splitExec(e.Exec);
    if (!argv.length) continue;
    const flatpak = !!e['X-Flatpak'] || /\/flatpak$/.test(argv[0]) || argv[0] === 'flatpak';
    const emu = cats.includes('Emulator');
    games.push({
      id: 'desktop:' + deskId,
      source: 'desktop',
      store: emu ? 'EMULATION' : flatpak ? 'FLATHUB' : 'INSTALLED',
      title: e.Name || deskId,
      installed: true,
      launch: { kind: 'exec', argv, cwd: e.Path || null, terminal: /^true$/i.test(e.Terminal || '') },
      art: { icon: findIcon(e.Icon, dirs) },
      playtimeMin: 0,
      lastPlayed: 0,
      sizeBytes: 0,
      ids: { desktop: deskId, flatpak: e['X-Flatpak'] || null, file },
    });
  }
  return games;
}

module.exports = { scanDesktop, splitExec, parseDesktop, findIcon };
