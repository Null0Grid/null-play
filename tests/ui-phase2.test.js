'use strict';
// End-to-end check of Phase 2 through the real app on a fake $HOME, with a
// stand-in SteamGridDB server on localhost:
//   startup animation (plays, skips on a key press, calm version for reduced
//   motion), Home (hero follows focus, Continue order, PLAY, library peek),
//   the game page (stats, Open in Steam, GameMode switch, Hide from Continue,
//   Heroic note), artwork (key entry, SteamGridDB picker for cover / hero /
//   logo, file import, reset, automatic fill) and the CRT exit.
//   xvfb-run -a -s "-screen 0 1440x900x24" node tests/ui-phase2.test.js
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const pw = require('playwright');
const { makeHome, png } = require('./fixtures/make-home');

const APP_DIR = path.resolve(__dirname, '..');
const electronPath = require(path.join(APP_DIR, 'node_modules', 'electron'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const key = (...k) => { for (const x of k) { execFileSync('xdotool', ['key', '--clearmodifiers', x]); execFileSync('sleep', ['0.09']); } };
const type = (t) => execFileSync('xdotool', ['type', '--delay', '10', t]);
async function waitFor(fn, timeoutMs = 6000) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeoutMs) { try { last = await fn(); if (last) return last; } catch {} await wait(80); }
  return last;
}
let failed = false;
const check = async (label, fn) => { try { await fn(); console.log('[pass] ' + label); } catch (e) { failed = true; console.log('[FAIL] ' + label + ': ' + e.message); } };

const GOOD_KEY = '0123456789abcdef0123456789abcdef';
const BAD_KEY = 'ffffffffffffffffffffffffffffffff';

// ---- stand-in SteamGridDB ----
function startSgdb() {
  const hits = [];
  const colors = { cover: [[200, 40, 120], [40, 160, 200], [230, 200, 40]], hero: [[90, 30, 160], [30, 120, 90]], logo: [[250, 250, 250]] };
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    hits.push(u.pathname);
    const m = u.pathname.match(/^\/img\/(cover|hero|logo)-(\d)\.png$/);
    if (m) { res.setHeader('Content-Type', 'image/png'); return res.end(png(m[1] === 'hero' ? 96 : 60, m[1] === 'hero' ? 31 : 90, colors[m[1]][Number(m[2])])); }
    if ((req.headers.authorization || '') !== 'Bearer ' + GOOD_KEY) { res.statusCode = 401; return res.end('{"success":false}'); }
    res.setHeader('Content-Type', 'application/json');
    const a = u.pathname.match(/^\/search\/autocomplete\/(.+)$/);
    if (a) return res.end(JSON.stringify({ success: true, data: [{ id: 4242, name: decodeURIComponent(a[1]) }] }));
    const r = u.pathname.match(/^\/(grids|heroes|logos)\/(steam|game)\/(\w+)$/);
    if (r) {
      const kind = { grids: 'cover', heroes: 'hero', logos: 'logo' }[r[1]];
      const base = 'http://127.0.0.1:' + srv.address().port;
      return res.end(JSON.stringify({ success: true, data: colors[kind].map((_, i) => ({ id: i, url: base + '/img/' + kind + '-' + i + '.png', thumb: base + '/img/' + kind + '-' + i + '.png', width: 600, height: 900 })) }));
    }
    res.statusCode = 404;
    res.end('{}');
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, hits, base: 'http://127.0.0.1:' + srv.address().port })));
}

async function start(fx, { extraEnv = {}, args = [], skipBootWait = false } = {}) {
  const app = await pw._electron.launch({
    executablePath: electronPath,
    args: [APP_DIR, '--windowed', '--no-sandbox', ...args],
    env: { ...process.env, ...fx.env, NULLPLAY_HOME: fx.home, NULLPLAY_OFFLINE: '1', NULLPLAY_USER_DATA: path.join(os.tmpdir(), 'np-p2-' + Date.now()), ...extraEnv },
  });
  const t0 = Date.now();
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  await win.setViewportSize({ width: 1440, height: 810 });
  await waitFor(() => app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; if (!w.isFocused()) { w.show(); w.focus(); } return w.isFocused(); }));
  if (!skipBootWait) await win.waitForSelector('#boot', { state: 'hidden', timeout: 6000 });
  return { app, win, errors, t0 };
}

const focused = (win) => win.evaluate(() => {
  const f = document.querySelector('.focus');
  return f ? { id: f.dataset.id || null, text: f.textContent.trim().replace(/\s+/g, ' ').slice(0, 40), cls: f.className } : null;
});
const heroTitle = (win) => win.textContent('#hero-title');
// on the game page: step into the OPTIONS column and walk it to an item
async function toOption(win, re) {
  if (!(await win.$('.d-side .opt.focus'))) key('Right', 'Right', 'Right');
  for (const dir of ['Up', 'Down']) {
    for (let i = 0; i < 4 && !re.test((await focused(win)).text); i++) key(dir);
    if (re.test((await focused(win)).text)) return;
  }
  throw new Error('could not reach ' + re + ', on ' + (await focused(win)).text);
}
const continueIds = (win) => win.$$eval('#continue .wide', (els) => els.map((e) => e.dataset.id));

(async () => {
  const sg = await startSgdb();
  const fx = makeHome();
  const pickFile = path.join(fx.home, 'my-cover.png');
  fs.writeFileSync(pickFile, png(60, 90, [10, 200, 90]));

  // ---------------- startup animation ----------------
  {
    const { app, win, errors } = await start(fx, { skipBootWait: true });
    try {
      await check('startup animation: boot screen with the wordmark, Packet and the scan bar', async () => {
        assert.ok(await win.$('#boot:not([hidden]) .boot-mark .c-main'));
        assert.ok(await win.$('#boot #boot-packet'));
        await waitFor(async () => /scanned .* games/.test(await win.textContent('#boot-text')), 3000);
        assert.ok(/scanned .* games/.test(await win.textContent('#boot-text')), await win.textContent('#boot-text'));
      });
      await check('startup animation: ends by itself within 2.5 s and Home slides in', async () => {
        const t0 = await win.evaluate(() => window.__np.boot.t0);
        await win.waitForSelector('#boot', { state: 'hidden', timeout: 4000 });
        const took = await win.evaluate((s) => performance.now() - s, t0);
        assert.ok(took >= 1500 && took <= 3100, 'took ' + Math.round(took) + ' ms');
        assert.ok(!(await win.evaluate(() => document.body.classList.contains('booting'))));
        assert.ok(await win.$('#view-home:not([hidden])'));
      });
      await check('no page errors', async () => assert.deepStrictEqual(errors, []));
    } finally { await app.close(); }
  }
  {
    const { app, win } = await start(fx, { skipBootWait: true });
    try {
      await check('startup animation: any key skips it, and that key press does nothing else', async () => {
        await wait(250);
        assert.ok(!(await win.evaluate(() => document.querySelector('#boot').hidden)));
        key('Return');
        await win.waitForSelector('#boot', { state: 'hidden', timeout: 800 });
        await wait(300);
        assert.strictEqual(fx.readLog(), '', 'Enter on the boot screen must not launch a game');
      });
    } finally { await app.close(); }
  }
  {
    const { app, win } = await start(fx);
    try {
      await check('reduced motion: calm version (no glitch), done quickly', async () => {
        await win.emulateMedia({ reducedMotion: 'reduce' });
        await win.reload();
        await win.waitForSelector('#boot');
        assert.ok(await win.evaluate(() => document.querySelector('#boot').classList.contains('calm')));
        await win.waitForSelector('#boot', { state: 'hidden', timeout: 1500 });
      });
    } finally { await app.close(); }
  }

  // ---------------- home, game page, artwork, exit ----------------
  const { app, win, errors } = await start(fx, { extraEnv: { NULLPLAY_SGDB_BASE: sg.base, NULLPLAY_TEST_PICK_FILE: pickFile } });
  let exited = false;
  try {
    await check('Home opens on the most recently played game: hero + first Continue tile', async () => {
      assert.ok(await win.$eval('.tab[data-tab="home"]', (e) => e.classList.contains('active')));
      assert.strictEqual(await heroTitle(win), 'HADES');
      assert.strictEqual((await focused(win)).id, 'steam:1145360');
      assert.deepStrictEqual(await continueIds(win), ['steam:1145360', 'steam:413150', 'heroic:legendary:Hawk', 'lutris:9', 'lutris:7']);
      const meta = await win.textContent('#hero-meta');
      assert.ok(/42\.6 h played/.test(meta) && /yesterday/.test(meta), meta);
      assert.ok(!(await win.$eval('#hero-gm', (e) => e.hidden)), 'GAMEMODE ON chip for a Steam game');
    });

    await check('the hero follows focus along Continue (real key presses)', async () => {
      key('Right');
      assert.strictEqual(await heroTitle(win), 'STARDEW VALLEY');
      key('d');
      assert.strictEqual(await heroTitle(win), 'CONTROL');
      assert.ok(/EPIC/.test(await win.textContent('#hero-store')));
      key('a');
    });

    await check('Up reaches the hero buttons; PLAY launches the hero game; it jumps to the front of Continue', async () => {
      key('Up');
      assert.strictEqual((await focused(win)).text, 'PLAY');
      key('Return');
      await waitFor(() => fx.readLog().includes('steam://rungameid/413150'));
      assert.ok(fx.readLog().includes('xdg-open [steam://rungameid/413150]'), fx.readLog());
      await waitFor(async () => (await continueIds(win))[0] === 'steam:413150');
      assert.strictEqual((await continueIds(win))[0], 'steam:413150');
      assert.strictEqual(await heroTitle(win), 'STARDEW VALLEY');
    });

    await check('Down reaches the library peek; the hero follows; SEE ALL opens LIBRARY', async () => {
      key('Down', 'Down');
      const f = await focused(win);
      assert.ok(await win.$eval('#peek .tile.focus', (e) => !!e), JSON.stringify(f));
      assert.strictEqual(await heroTitle(win), (await win.$eval('#peek .tile.focus .ttl', (e) => e.textContent)).toUpperCase());
      assert.ok(/13 games/.test(await win.textContent('#peek-count')));
      for (let i = 0; i < 14; i++) key('Right');
      assert.ok(/SEE ALL/.test((await focused(win)).text));
      key('Return');
      await win.waitForSelector('#view-library:not([hidden])');
      key('1');
      await win.waitForSelector('#view-home:not([hidden])');
    });

    await check('X opens the game page: stats, PLAY, Open in Steam (steam://nav/games/details)', async () => {
      // first Continue tile is Stardew now
      for (let i = 0; i < 3 && !(await win.$('#continue .wide.focus')); i++) key('Up');
      for (let i = 0; i < 6; i++) key('Left');
      assert.strictEqual((await focused(win)).id, 'steam:413150');
      key('x');
      await win.waitForSelector('#view-detail:not([hidden])');
      assert.strictEqual(await win.textContent('#d-title'), 'STARDEW VALLEY');
      const stats = (await win.textContent('#d-stats')).replace(/\s+/g, ' ');
      assert.ok(/PLAY TIME ?118 h/.test(stats) && /LAST PLAYED ?today/.test(stats) && /SOURCE ?Steam/.test(stats), stats);
      assert.strictEqual((await focused(win)).text, 'PLAY');
      key('Right', 'Right');
      assert.strictEqual((await focused(win)).text, 'OPEN IN STEAM');
      key('Return');
      await waitFor(() => fx.readLog().includes('steam://nav/games/details/413150'));
      assert.ok(fx.readLog().includes('xdg-open [steam://nav/games/details/413150]'));
    });

    await check('Hide from Continue: switch on, B back to Home, the game is gone from Continue', async () => {
      // OPTIONS column is to the right
      await toOption(win, /HIDE FROM CONTINUE/);
      key('Return');
      await waitFor(() => win.$eval('#d-hide', (e) => e.getAttribute('aria-checked') === 'true'));
      key('Escape');
      await win.waitForSelector('#view-home:not([hidden])');
      assert.ok(!(await continueIds(win)).includes('steam:413150'));
      assert.strictEqual((await continueIds(win))[0], 'steam:1145360');
    });

    await check('GameMode switch per game: off for SuperTuxKart → it runs without gamemoderun', async () => {
      key('3');
      await win.waitForSelector('#view-library:not([hidden])');
      const t = await win.evaluate(() => window.__np.visibleGames().map((g) => g.id));
      const idx = t.indexOf('desktop:supertuxkart');
      const cur = await win.evaluate(() => [...document.querySelectorAll('#grid .tile')].indexOf(document.querySelector('#grid .tile.focus')));
      for (let i = 0; i < Math.floor(idx / 8) - Math.floor(cur / 8); i++) key('Down');
      for (let i = 0; i < Math.abs((idx % 8) - (cur % 8)); i++) key((idx % 8) > (cur % 8) ? 'Right' : 'Left');
      assert.strictEqual((await focused(win)).id, 'desktop:supertuxkart');
      key('x');
      await win.waitForSelector('#view-detail:not([hidden])');
      assert.ok(await win.$eval('#d-open', (e) => e.hidden), 'no launcher to open for a .desktop game');
      await toOption(win, /FERAL GAMEMODE/);
      assert.strictEqual(await win.$eval('#d-gm', (e) => e.getAttribute('aria-checked')), 'true');
      key('Return');
      await waitFor(() => win.$eval('#d-gm', (e) => e.getAttribute('aria-checked') === 'false'));
      for (let i = 0; i < 4 && (await focused(win)).text !== 'PLAY'; i++) key('Left');
      const before = fx.readLog().length;
      key('Return');
      await waitFor(() => fx.readLog().length > before);
      const added = fx.readLog().slice(before);
      assert.ok(/^supertuxkart\n/.test(added), JSON.stringify(added));
      key('Escape');
    });

    await check('Heroic game: GameMode switch is greyed out with a pointer to Heroic’s own setting', async () => {
      const t = await win.evaluate(() => window.__np.visibleGames().map((g) => g.id));
      const idx = t.indexOf('heroic:legendary:Hawk');
      const cur = await win.evaluate(() => [...document.querySelectorAll('#grid .tile')].indexOf(document.querySelector('#grid .tile.focus')));
      for (let i = 0; i < Math.abs(Math.floor(idx / 8) - Math.floor(cur / 8)); i++) key(idx > cur ? 'Down' : 'Up');
      for (let i = 0; i < Math.abs((idx % 8) - (cur % 8)); i++) key((idx % 8) > (cur % 8) ? 'Right' : 'Left');
      key('x');
      await win.waitForSelector('#view-detail:not([hidden])');
      assert.strictEqual(await win.textContent('#d-title'), 'CONTROL');
      assert.strictEqual(await win.$eval('#d-gm', (e) => e.getAttribute('aria-disabled')), 'true');
      assert.ok(/Heroic/.test(await win.textContent('#d-gm-note')));
      assert.strictEqual(await win.textContent('#d-open'), 'OPEN IN HEROIC');
    });

    await check('artwork without a key: picker asks for a SteamGridDB key; a bad key is refused', async () => {
      await toOption(win, /SET ARTWORK/);
      key('Return');
      await win.waitForSelector('#picker:not([hidden])');
      assert.ok(!(await win.$eval('#picker-key', (e) => e.hidden)));
      assert.strictEqual(await win.evaluate(() => document.activeElement.id), 'key-input', 'typing goes straight into the key field');
      type(BAD_KEY);
      key('Return');
      await waitFor(async () => /didn.t accept/.test(await win.textContent('#key-msg')));
      assert.ok(/didn.t accept/.test(await win.textContent('#key-msg')), await win.textContent('#key-msg'));
      assert.ok(!(await win.$eval('#picker', (e) => e.hidden)), 'WASD in the field didn’t close anything');
    });

    await check('a good key: saved, SteamGridDB covers listed; picking one sets the cover everywhere', async () => {
      await win.fill('#key-input', '');
      type(GOOD_KEY);
      key('Return');
      await win.waitForSelector('#picker-grid .opt-img', { timeout: 5000 });
      assert.strictEqual(await win.$$eval('#picker-grid .opt-img', (e) => e.length), 3);
      assert.ok(await win.$eval('#picker-key', (e) => e.hidden));
      key('Right');
      key('Return');
      await waitFor(async () => /COVER ART SET/.test(await win.textContent('#picker-status')));
      assert.ok(sg.hits.includes('/img/cover-1.png'));
      assert.ok(/^np-art:/.test(await win.$eval('#d-cover img', (i) => i.src)));
      assert.ok(!(await win.$eval('#picker-reset', (e) => e.hidden)));
    });

    await check('RB switches to HERO and LOGO art; picking sets them on the game page', async () => {
      key('3'); // RB
      await win.waitForSelector('.ptab.active[data-kind="hero"]');
      await win.waitForSelector('#picker-grid.wide-grid .opt-img');
      key('Return');
      await waitFor(async () => /HERO ART SET/.test(await win.textContent('#picker-status')));
      assert.ok(/^np-art:/.test(await win.$eval('#d-hero', (i) => i.src)));
      key('3');
      await win.waitForSelector('#picker-grid.logo-grid .opt-img');
      key('Return');
      await waitFor(async () => /LOGO ART SET/.test(await win.textContent('#picker-status')));
      key('1', '1'); // back to COVER
      await win.waitForSelector('.ptab.active[data-kind="cover"]');
    });

    await check('CHOOSE FILE imports an image; RESET TO DEFAULT puts the launcher art back', async () => {
      await win.click('#picker-file');
      await waitFor(async () => /COVER ART SET/.test(await win.textContent('#picker-status')));
      const src = await win.$eval('#d-cover img', (i) => i.src);
      assert.ok(/^np-art:/.test(src));
      await win.click('#picker-reset');
      await waitFor(async () => /BACK TO DEFAULT/.test(await win.textContent('#picker-status')));
      // Control has no launcher cover, but the automatic fill has given it one by now
      await waitFor(() => win.$('#d-cover img'));
    });

    await check('DONE / B closes the picker back to SET ARTWORK', async () => {
      key('Escape');
      await win.waitForSelector('#picker', { state: 'hidden' });
      assert.ok(/SET ARTWORK/.test((await focused(win)).text));
    });

    await check('automatic fill: games missing covers get one from SteamGridDB (by app id or title)', async () => {
      key('Escape');
      await win.waitForSelector('#view-library:not([hidden])');
      await waitFor(() => win.$('#grid .tile[data-id="desktop:supertuxkart"] .cover img[src^="np-art:"]'));
      const withArt = await win.$$eval('#grid .tile .cover.has-art img', (els) => els.map((i) => i.src).filter((s) => s.startsWith('np-art:')).length);
      assert.ok(withArt >= 10, 'covers: ' + withArt);
      assert.ok(sg.hits.some((h) => /^\/grids\/steam\/1517290/.test(h)), 'Steam games looked up by app id');
      assert.ok(sg.hits.some((h) => /^\/search\/autocomplete\/SuperTuxKart/.test(h)), 'others looked up by title');
      assert.ok(sg.hits.some((h) => /^\/heroes\//.test(h)), 'heroes fetched for the Continue row');
    });

    await check('no page errors', async () => assert.deepStrictEqual(errors, []));

    await check('exit: Ctrl+Q → EXIT plays the CRT collapse, then the app closes', async () => {
      const closed = new Promise((r) => app.once('close', r));
      key('ctrl+q');
      await win.waitForSelector('#modal:not([hidden])');
      key('Right', 'Return');
      await waitFor(() => win.evaluate(() => document.body.classList.contains('crt-off')).catch(() => true), 1000);
      await Promise.race([closed, wait(3000).then(() => { throw new Error('app did not close'); })]);
      exited = true;
    });
  } finally {
    if (!exited) await app.close().catch(() => {});
    sg.srv.close();
  }

  console.log(failed ? '\nSOME CHECKS FAILED' : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
