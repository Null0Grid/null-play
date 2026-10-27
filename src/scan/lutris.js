'use strict';
// Lutris: installed games through Lutris's own CLI (`lutris -l -o -j`), which
// keeps working across Lutris database changes and needs no native SQLite
// module. Lutris also covers EA app, Ubisoft Connect, Battle.net, itch.io and
// Humble installs. Launch goes through Lutris (lutris:rungameid/<id>).
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

function run(cmd, args, env, timeoutMs) {
  return new Promise((resolve) => {
    execFile(cmd, args, { env, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
      resolve(err && !stdout ? null : String(stdout || ''));
    });
  });
}

// Lutris sometimes logs lines before the JSON; take the outermost array.
function extractJSON(out) {
  if (!out) return null;
  const a = out.indexOf('[');
  const b = out.lastIndexOf(']');
  if (a < 0 || b < a) return null;
  try { return JSON.parse(out.slice(a, b + 1)); } catch { return null; }
}

// "12.5", 12.5, "3 hours 20 minutes", "45 minutes" → minutes
function parsePlaytime(v) {
  if (typeof v === 'number') return Math.round(v * 60);
  if (!v) return 0;
  const s = String(v);
  if (/^\d+(\.\d+)?$/.test(s.trim())) return Math.round(parseFloat(s) * 60);
  let m = 0;
  const h = s.match(/(\d+(?:\.\d+)?)\s*h/i); if (h) m += parseFloat(h[1]) * 60;
  const mm = s.match(/(\d+)\s*m/i); if (mm) m += parseInt(mm[1], 10);
  return Math.round(m);
}

function parseLast(v) {
  if (!v) return 0;
  if (typeof v === 'number') return v > 1e12 ? Math.floor(v / 1000) : v;
  if (/^\d+$/.test(String(v))) return parseInt(v, 10);
  const t = Date.parse(String(v).replace(' ', 'T'));
  return isNaN(t) ? 0 : Math.floor(t / 1000);
}

function lutrisArt(home, slug) {
  const roots = [
    path.join(home, '.local', 'share', 'lutris'),
    path.join(home, '.cache', 'lutris'),
    path.join(home, '.var', 'app', 'net.lutris.Lutris', 'data', 'lutris'),
    path.join(home, '.var', 'app', 'net.lutris.Lutris', 'cache', 'lutris'),
  ];
  const find = (sub) => {
    for (const r of roots) for (const ext of ['.jpg', '.png']) {
      const p = path.join(r, sub, slug + ext);
      if (fs.existsSync(p)) return p;
    }
    return undefined;
  };
  return { cover: find('coverart'), header: find('banners') };
}

const RUNNER_STORE = { steam: 'STEAM', wine: 'LUTRIS', linux: 'LUTRIS' };

async function scanLutris(home, env, { lutrisCmd } = {}) {
  // native first, then the Flatpak
  const tries = lutrisCmd ? [lutrisCmd] : [['lutris', []], ['flatpak', ['run', 'net.lutris.Lutris']]];
  let list = null;
  let flatpakApp = null;
  for (const [cmd, pre] of tries) {
    list = extractJSON(await run(cmd, [...pre, '-l', '-o', '-j'], env, 20000));
    if (list) { flatpakApp = cmd === 'flatpak' ? 'net.lutris.Lutris' : null; break; }
  }
  if (!Array.isArray(list)) return [];
  const games = [];
  for (const g of list) {
    if (!g || g.id == null || !g.name) continue;
    // games Lutris imported from Steam are already listed by the Steam scan
    if (g.runner === 'steam') continue;
    games.push({
      id: 'lutris:' + g.id,
      source: 'lutris',
      store: RUNNER_STORE[g.runner] || 'LUTRIS',
      title: g.name,
      installed: true,
      launch: { kind: 'url', url: 'lutris:rungameid/' + g.id, flatpakApp },
      art: lutrisArt(home, g.slug || ''),
      playtimeMin: parsePlaytime(g.playtime),
      lastPlayed: parseLast(g.lastplayed),
      sizeBytes: 0,
      ids: { lutris: String(g.id), slug: g.slug || null, runner: g.runner || null, platform: g.platform || null },
    });
  }
  return games;
}

module.exports = { scanLutris, parsePlaytime, parseLast, extractJSON };
