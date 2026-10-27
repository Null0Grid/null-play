'use strict';
// Runs every library scan, merges the results with NULL // PLAY's own history
// and favorites, and attaches anti-cheat flags.
const { scanSteam } = require('./steam');
const { scanHeroic } = require('./heroic');
const { scanLutris } = require('./lutris');
const { scanDesktop } = require('./desktop');

const STORE_OF = { steam: 'STEAM', heroic: 'HEROIC', lutris: 'LUTRIS', desktop: 'INSTALLED' };

async function scanAll({ home, env, anticheat, history = {}, favorites = [], lutrisCmd } = {}) {
  const t0 = Date.now();
  const report = {};
  const safe = async (name, fn) => {
    try { const g = await fn(); report[name] = { found: g.length }; return g; }
    catch (e) { report[name] = { found: 0, error: String(e && e.message || e) }; return []; }
  };
  const [steam, heroic, lutris, desktop] = await Promise.all([
    safe('steam', () => scanSteam(home)),
    safe('heroic', () => scanHeroic(home)),
    safe('lutris', () => scanLutris(home, env, { lutrisCmd })),
    safe('desktop', () => scanDesktop(home, env)),
  ]);
  const fav = new Set(favorites);
  const games = [...steam, ...heroic, ...lutris, ...desktop].map((g) => {
    const h = history[g.id] || {};
    const out = {
      ...g,
      store: g.store || STORE_OF[g.source],
      // the launcher's own numbers win; ours fill the gaps (desktop games)
      playtimeMin: Math.max(g.playtimeMin || 0, h.playtimeMin || 0),
      lastPlayed: Math.max(g.lastPlayed || 0, h.lastPlayed || 0),
      favorite: fav.has(g.id),
      anticheat: anticheat ? anticheat.lookup(g) : null,
    };
    return out;
  });
  games.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }));
  return { games, report, ms: Date.now() - t0, scannedAt: Date.now() };
}

module.exports = { scanAll };
