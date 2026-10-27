'use strict';
// Artwork for every game, in this order per kind (cover / hero / logo):
//   1. art the user set (copied into our own folder, so moving the original
//      file doesn't break it)
//   2. the launcher's local art (Steam library cache, Lutris covers)
//   3. SteamGridDB, when the user added an API key (cached on disk)
//   4. the launcher's remote art (Heroic's CDN links), cached on first use
// Nothing is fetched without a reason: SteamGridDB only for games missing art,
// and each miss is remembered for a week.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KINDS = ['cover', 'hero', 'logo'];
const SGDB_BASE = 'https://www.steamgriddb.com/api/v2';
const SGDB_ROUTE = { cover: 'grids', hero: 'heroes', logo: 'logos' };
const MAX_BYTES = 20 * 1024 * 1024;
const IMG_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };
const MISS_TTL = 7 * 864e5;

const sha = (s) => crypto.createHash('sha1').update(String(s)).digest('hex');

function normTitle(s) { return String(s || '').toLowerCase().replace(/[™®©]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }

class ArtManager {
  constructor({ dir, fetch, getKey, base }) {
    this.dir = dir;
    this.fetch = fetch;
    this.getKey = getKey;
    this.base = base || SGDB_BASE;
    this.indexFile = path.join(dir, 'index.json');
    this.index = { sgdb: {}, remote: {}, user: {}, misses: {}, sgdbIds: {} };
    try { Object.assign(this.index, JSON.parse(fs.readFileSync(this.indexFile, 'utf8'))); } catch {}
    this.inflight = new Map();
    this.options = new Map(); // `${gameId}|${kind}` → last options list shown to the user
  }

  save() {
    try { fs.mkdirSync(this.dir, { recursive: true }); fs.writeFileSync(this.indexFile + '.tmp', JSON.stringify(this.index)); fs.renameSync(this.indexFile + '.tmp', this.indexFile); } catch {}
  }

  exists(p) { try { return !!p && fs.statSync(p).isFile(); } catch { return false; } }

  // the art a game shows, after every source has had its say
  resolve(game) {
    const a = game.art || {};
    const user = this.index.user[game.id] || {};
    const sg = this.index.sgdb[game.id] || {};
    const out = { ...a, userSet: {} };
    for (const k of KINDS) {
      const launcherLocal = a[k] && !/^https:/.test(a[k]) ? a[k] : null;
      const launcherRemote = a[k] && /^https:/.test(a[k]) ? a[k] : null;
      const cachedRemote = launcherRemote && this.index.remote[launcherRemote];
      if (this.exists(user[k])) { out[k] = user[k]; out.userSet[k] = true; }
      else if (launcherLocal) out[k] = launcherLocal;
      else if (this.exists(sg[k])) out[k] = sg[k];
      else if (this.exists(cachedRemote)) out[k] = cachedRemote;
      else out[k] = launcherRemote || undefined;
    }
    return out;
  }

  // ---------- downloading ----------
  async download(url, sub) {
    if (!/^https:\/\//.test(url) && !(this.base.startsWith('http://127.0.0.1') && url.startsWith('http://127.0.0.1'))) throw new Error('only https images');
    if (this.inflight.has(url)) return this.inflight.get(url);
    const p = (async () => {
      const res = await this.fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const type = String(res.headers.get('content-type') || '').split(';')[0].trim();
      const ext = IMG_EXT[type];
      if (!ext) throw new Error('not an image (' + type + ')');
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_BYTES) throw new Error('image too large');
      const file = path.join(this.dir, sub, sha(url) + ext);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, buf);
      return file;
    })();
    this.inflight.set(url, p);
    try { return await p; } finally { this.inflight.delete(url); }
  }

  // Heroic's CDN art: cache once, then always local
  async cacheRemote(url) {
    if (this.exists(this.index.remote[url])) return this.index.remote[url];
    const file = await this.download(url, 'remote');
    this.index.remote[url] = file;
    this.save();
    return file;
  }

  // ---------- SteamGridDB ----------
  async sgdb(route) {
    const key = this.getKey();
    if (!key) throw Object.assign(new Error('no SteamGridDB key'), { code: 'NO_KEY' });
    const res = await this.fetch(this.base + route, { headers: { Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(15000) });
    if (res.status === 401 || res.status === 403) throw Object.assign(new Error('SteamGridDB rejected the API key'), { code: 'BAD_KEY' });
    if (res.status === 404) return [];
    if (!res.ok) throw new Error('SteamGridDB HTTP ' + res.status);
    const j = await res.json();
    if (!j || j.success === false) return [];
    return Array.isArray(j.data) ? j.data : [];
  }

  async checkKey() {
    await this.sgdb('/search/autocomplete/' + encodeURIComponent('portal'));
    return true;
  }

  // Steam games are looked up by app id; everything else by title, preferring
  // an exact (normalized) title match
  async sgdbTarget(game) {
    if (game.ids && game.ids.steam) return { platform: 'steam', id: game.ids.steam };
    const cached = this.index.sgdbIds[game.id];
    if (cached) return { platform: 'game', id: cached };
    const hits = await this.sgdb('/search/autocomplete/' + encodeURIComponent(game.title));
    if (!hits.length) return null;
    const want = normTitle(game.title);
    const hit = hits.find((h) => normTitle(h.name) === want) || hits[0];
    this.index.sgdbIds[game.id] = hit.id;
    this.save();
    return { platform: 'game', id: hit.id };
  }

  async sgdbOptions(game, kind) {
    const t = await this.sgdbTarget(game);
    if (!t) return [];
    const q = kind === 'cover' ? '?dimensions=600x900&nsfw=false&humor=false' : '?nsfw=false&humor=false';
    const list = await this.sgdb('/' + SGDB_ROUTE[kind] + '/' + t.platform + '/' + encodeURIComponent(t.id) + q);
    return list.filter((x) => x && typeof x.url === 'string').slice(0, 12).map((x) => ({ url: x.url, thumb: x.thumb || x.url, width: x.width, height: x.height }));
  }

  // options for the picker; the renderer gets thumbnails and picks by index,
  // so it can never make us download an arbitrary URL
  async listOptions(game, kind) {
    const opts = await this.sgdbOptions(game, kind);
    this.options.set(game.id + '|' + kind, opts);
    return opts.map((o, i) => ({ index: i, thumb: o.thumb, width: o.width, height: o.height }));
  }

  async pick(game, kind, index) {
    const opts = this.options.get(game.id + '|' + kind) || [];
    const o = opts[index];
    if (!o) throw new Error('that option is gone; open the picker again');
    const file = await this.download(o.url, 'user');
    this.setUserFile(game.id, kind, file);
    return file;
  }

  // a file the user chose on disk: checked, then copied in
  importFile(gameId, kind, src) {
    const ext = path.extname(src).toLowerCase();
    if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) throw new Error('pick a PNG, JPG or WebP image');
    const st = fs.statSync(src);
    if (!st.isFile() || st.size > MAX_BYTES) throw new Error('that file is too large or not a file');
    const dst = path.join(this.dir, 'user', sha(gameId + '|' + kind + '|' + Date.now()) + ext);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    this.setUserFile(gameId, kind, dst);
    return dst;
  }

  setUserFile(gameId, kind, file) {
    const u = this.index.user[gameId] || {};
    const old = u[kind];
    u[kind] = file;
    this.index.user[gameId] = u;
    this.save();
    if (old && old !== file && old.startsWith(path.join(this.dir, 'user'))) { try { fs.unlinkSync(old); } catch {} }
  }

  reset(gameId, kind) {
    const u = this.index.user[gameId] || {};
    const old = u[kind];
    delete u[kind];
    this.index.user[gameId] = u;
    this.save();
    if (old && old.startsWith(path.join(this.dir, 'user'))) { try { fs.unlinkSync(old); } catch {} }
  }

  // ---------- background fill ----------
  // games: raw game objects. Fills missing covers for everything and missing
  // heroes for the given ids (the Continue row), two at a time.
  async autoFill(games, { heroFor = new Set(), onChange } = {}) {
    const jobs = [];
    for (const g of games) {
      const r = this.resolve(g);
      // launcher remote art gets cached even without a key
      for (const k of KINDS) {
        const u = g.art && g.art[k];
        if (u && /^https:/.test(u) && r[k] === u) jobs.push({ g, run: () => this.cacheRemote(u) });
      }
      if (!this.getKey()) continue;
      const want = [];
      if (!r.cover) want.push('cover');
      if (heroFor.has(g.id) && !r.hero) want.push('hero');
      for (const k of want) {
        const mk = g.id + '|' + k;
        if (this.index.misses[mk] && Date.now() - this.index.misses[mk] < MISS_TTL) continue;
        jobs.push({ g, run: async () => {
          const opts = await this.sgdbOptions(g, k);
          if (!opts.length) { this.index.misses[mk] = Date.now(); this.save(); return null; }
          const file = await this.download(opts[0].url, 'sgdb');
          const s = this.index.sgdb[g.id] || {};
          s[k] = file;
          this.index.sgdb[g.id] = s;
          this.save();
          return file;
        } });
      }
    }
    let changed = 0;
    let stop = false;
    const worker = async () => {
      while (jobs.length && !stop) {
        const j = jobs.shift();
        try { if (await j.run()) { changed++; if (onChange) onChange(j.g); } }
        catch (e) { if (e.code === 'BAD_KEY' || e.code === 'NO_KEY') stop = true; }
      }
    };
    await Promise.all([worker(), worker()]);
    return changed;
  }
}

module.exports = { ArtManager, KINDS, SGDB_BASE, normTitle };
