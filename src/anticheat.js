'use strict';
// Anti-cheat flags from AreWeAntiCheatYet (MIT, github.com/AreWeAntiCheatYet).
// A snapshot ships in data/anticheat.json; main.js refreshes it weekly when
// online. Matching is by Steam app id, then Epic slug, then exact normalized
// title, so a game is never flagged on a loose name match.
const fs = require('fs');
const path = require('path');

const SNAPSHOT = path.join(__dirname, '..', 'data', 'anticheat.json');
const RAW_URL = 'https://raw.githubusercontent.com/AreWeAntiCheatYet/AreWeAntiCheatYet/master/games.json';

// what NULL // PLAY does with each upstream status
const LEVEL = {
  Denied: { level: 'blocked', label: 'ANTI-CHEAT BLOCKS LINUX', detail: 'The developer has chosen not to allow this game’s anti-cheat on Linux. It will most likely refuse to start or kick you from online play.' },
  Broken: { level: 'blocked', label: 'ANTI-CHEAT BROKEN ON LINUX', detail: 'This game’s anti-cheat doesn’t work under Linux / Proton right now. It will most likely refuse to start or kick you from online play.' },
  Planned: { level: 'warn', label: 'ANTI-CHEAT: LINUX PLANNED', detail: 'Linux support for this game’s anti-cheat is announced but not live yet. Online play may not work.' },
  Running: { level: 'warn', label: 'ONLINE MAY NOT WORK', detail: 'The game runs on Linux, but its anti-cheat isn’t enabled for Linux, so some online modes may be blocked.' },
  Supported: { level: 'ok', label: 'ANTI-CHEAT WORKS', detail: 'The developer enabled this game’s anti-cheat for Linux / Proton.' },
};

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[™®©]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^the /, '')
    .trim();
}

// upstream games.json → the compact form we store
function compact(upstream) {
  const out = [];
  for (const g of Array.isArray(upstream) ? upstream : []) {
    if (!g || !g.name || !LEVEL[g.status]) continue;
    const s = g.storeIds || {};
    const e = { n: g.name, s: g.status, a: Array.isArray(g.anticheats) ? g.anticheats : [] };
    if (s.steam) e.steam = String(s.steam);
    if (s.epic && s.epic.slug) e.epic = String(s.epic.slug);
    out.push(e);
  }
  return out;
}

class AntiCheat {
  constructor(games) { this.load(games); }

  load(games) {
    this.bySteam = new Map();
    this.byEpic = new Map();
    this.byName = new Map();
    for (const g of games || []) {
      if (g.steam) this.bySteam.set(g.steam, g);
      if (g.epic) this.byEpic.set(g.epic, g);
      const k = norm(g.n);
      if (k && !this.byName.has(k)) this.byName.set(k, g);
    }
    this.count = (games || []).length;
  }

  lookup(game) {
    const ids = game.ids || {};
    let hit = (ids.steam && this.bySteam.get(String(ids.steam)))
      || (ids.epicSlug && this.byEpic.get(ids.epicSlug))
      || this.byName.get(norm(game.title));
    if (!hit) return null;
    const lv = LEVEL[hit.s];
    return { status: hit.s, level: lv.level, label: lv.label, detail: lv.detail, anticheats: hit.a, matched: hit.n };
  }
}

function loadSnapshot(cachePath) {
  for (const p of [cachePath, SNAPSHOT]) {
    if (!p) continue;
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (Array.isArray(j.games) && j.games.length > 100) return { games: j.games, fetched: j.fetched || null, from: p };
    } catch {}
  }
  return { games: [], fetched: null, from: null };
}

module.exports = { AntiCheat, loadSnapshot, compact, norm, RAW_URL, LEVEL };
