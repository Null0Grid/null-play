'use strict';
// Heroic Games Launcher: Epic (Legendary), GOG, Amazon Prime Gaming (Nile)
// and games sideloaded into Heroic. Reads Heroic's own cache files, so
// nothing is fetched and no account details are touched. Launch goes through
// Heroic (heroic://launch/<runner>/<appName>), which handles Wine/Proton.
const fs = require('fs');
const path = require('path');

function heroicRoots(home) {
  return [
    { dir: path.join(home, '.config', 'heroic'), flatpakApp: null },
    { dir: path.join(home, '.var', 'app', 'com.heroicgameslauncher.hgl', 'config', 'heroic'), flatpakApp: 'com.heroicgameslauncher.hgl' },
  ].filter((r) => fs.existsSync(r.dir));
}

function readJSON(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }

// Heroic's library caches have changed shape between versions:
// { library: [...] }, { games: [...] } or a bare array
function listOf(j) {
  if (!j) return [];
  if (Array.isArray(j)) return j;
  if (Array.isArray(j.library)) return j.library;
  if (Array.isArray(j.games)) return j.games;
  return [];
}

const RUNNERS = [
  { runner: 'legendary', label: 'EPIC', library: 'store_cache/legendary_library.json' },
  { runner: 'gog', label: 'GOG', library: 'store_cache/gog_library.json' },
  { runner: 'nile', label: 'AMAZON', library: 'store_cache/nile_library.json' },
  { runner: 'sideload', label: 'HEROIC', library: 'sideload_apps/library.json' },
];

function installedSets(dir) {
  const sets = { legendary: {}, gog: {}, nile: {} };
  const leg = readJSON(path.join(dir, 'legendaryConfig', 'legendary', 'installed.json')) || {};
  for (const [k, v] of Object.entries(leg)) sets.legendary[k] = { size: (v && v.install_size) || 0 };
  const gog = readJSON(path.join(dir, 'gog_store', 'installed.json'));
  for (const g of (gog && gog.installed) || []) if (g && g.appName) sets.gog[String(g.appName)] = { size: g.install_size || 0 };
  const nile = readJSON(path.join(dir, 'nile_config', 'nile', 'installed.json'));
  for (const g of Array.isArray(nile) ? nile : []) if (g && g.id) sets.nile[g.id] = { size: g.size || 0 };
  return sets;
}

function toUnix(v) {
  if (!v) return 0;
  if (typeof v === 'number') return v > 1e12 ? Math.floor(v / 1000) : v;
  const t = Date.parse(v);
  return isNaN(t) ? 0 : Math.floor(t / 1000);
}

// strip CDN resize params so we get a usable image; keep only https
function artUrl(u) {
  if (typeof u !== 'string' || !/^https:\/\//.test(u)) return undefined;
  return u;
}

function scanHeroic(home) {
  const games = [];
  const seen = new Set();
  for (const { dir, flatpakApp } of heroicRoots(home)) {
    const inst = installedSets(dir);
    const times = readJSON(path.join(dir, 'store', 'timestamp.json')) || {};
    for (const r of RUNNERS) {
      for (const g of listOf(readJSON(path.join(dir, r.library)))) {
        const appName = String(g.app_name || g.appName || g.id || '');
        if (!appName || !g.title) continue;
        const id = 'heroic:' + r.runner + ':' + appName;
        if (seen.has(id)) continue;
        // DLC and other non-game entries Heroic keeps in the cache
        if (g.is_dlc || g.isDLC) continue;
        seen.add(id);
        const installed = r.runner === 'sideload' ? g.is_installed !== false : !!inst[r.runner][appName] || g.is_installed === true;
        const t = times[appName] || {};
        games.push({
          id,
          source: 'heroic',
          store: r.label,              // EPIC / GOG / AMAZON / HEROIC
          title: g.title,
          installed,
          launch: installed
            ? { kind: 'url', url: 'heroic://launch/' + r.runner + '/' + encodeURIComponent(appName), flatpakApp }
            : { kind: 'launcher', app: 'heroic', flatpakApp },
          art: { cover: artUrl(g.art_square) || artUrl(g.art_cover), hero: artUrl(g.art_background) || artUrl(g.art_cover), logo: artUrl(g.art_logo) },
          playtimeMin: Math.round(Number(t.totalPlayed) || 0),
          lastPlayed: toUnix(t.lastPlayed),
          sizeBytes: (inst[r.runner] && inst[r.runner][appName] && Number(inst[r.runner][appName].size)) || 0,
          ids: { heroic: appName, runner: r.runner, epicSlug: r.runner === 'legendary' ? (g.store_url || '').split('/').filter(Boolean).pop() || null : null },
        });
      }
    }
  }
  return games;
}

module.exports = { scanHeroic, heroicRoots };
