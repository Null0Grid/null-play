'use strict';
// End-to-end check of Phase 1 through the real app on a fake $HOME:
//   library scan → grid and filters, navigation with real key presses
//   (arrows, WASD, Enter, Esc, F, 1/3, PgDn, Ctrl+Q via xdotool), controller
//   input through the Gamepad API (Xbox and PlayStation pads, d-pad, stick,
//   hold-to-repeat, A to launch), mouse clicks, launching through each path,
//   the anti-cheat warning, favorites, and the empty first-run screen.
// Needs an X display and xdotool:
//   xvfb-run -a -s "-screen 0 1440x900x24" node tests/ui-phase1.test.js
const assert = require('assert');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const pw = require('playwright');
const { makeHome } = require('./fixtures/make-home');

const APP_DIR = path.resolve(__dirname, '..');
const electronPath = require(path.join(APP_DIR, 'node_modules', 'electron'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const key = (...k) => { for (const x of k) { execFileSync('xdotool', ['key', '--clearmodifiers', x]); execFileSync('sleep', ['0.08']); } };
async function waitFor(fn, timeoutMs = 6000) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeoutMs) { try { last = await fn(); if (last) return last; } catch {} await wait(80); }
  return last;
}

let failed = false;
const check = async (label, fn) => { try { await fn(); console.log('[pass] ' + label); } catch (e) { failed = true; console.log('[FAIL] ' + label + ': ' + e.message); } };

async function start(fx) {
  const app = await pw._electron.launch({
    executablePath: electronPath,
    args: [APP_DIR, '--windowed', '--no-sandbox'],
    env: { ...process.env, ...fx.env, NULLPLAY_HOME: fx.home, NULLPLAY_OFFLINE: '1', NULLPLAY_USER_DATA: path.join(os.tmpdir(), 'np-ui-' + Date.now()) },
  });
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  await win.setViewportSize({ width: 1440, height: 810 });
  await win.waitForSelector('#view-home:not([hidden]), #view-empty:not([hidden])', { timeout: 15000 });
  await win.waitForSelector('#boot', { state: 'hidden', timeout: 5000 });
  await waitFor(() => app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; if (!w.isFocused()) { w.show(); w.focus(); } return w.isFocused(); }));
  await wait(300);
  // Phase 1 checks live on the LIBRARY tab (Home is covered by ui-phase2)
  if (!(await win.$('#view-empty:not([hidden])'))) { key('3'); await win.waitForSelector('#view-library:not([hidden])'); }
  return { app, win, errors };
}

const focused = (win) => win.evaluate(() => {
  const f = document.querySelector('.focus');
  if (!f) return null;
  return { id: f.dataset.id || null, filter: f.dataset.filter || null, text: f.textContent.trim().slice(0, 40), index: [...document.querySelectorAll('#grid .tile')].indexOf(f) };
});
const titles = (win) => win.evaluate(() => window.__np.visibleGames().map((g) => g.title));

// a fake controller the page's own polling loop reads every frame
async function plugPad(win, id) {
  await win.evaluate((padId) => {
    const pad = { id: padId, index: 0, connected: true, mapping: 'standard', timestamp: 0,
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })), axes: [0, 0, 0, 0] };
    window.__pad = pad;
    navigator.getGamepads = () => [pad, null, null, null];
  }, id);
  await wait(100);
}
async function tap(win, button, holdMs = 60) {
  await win.evaluate((b) => { window.__pad.buttons[b].pressed = true; window.__pad.buttons[b].value = 1; }, button);
  await wait(holdMs);
  await win.evaluate((b) => { window.__pad.buttons[b].pressed = false; window.__pad.buttons[b].value = 0; }, button);
  await wait(60);
}
const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

(async () => {
  const fx = makeHome();
  const { app, win, errors } = await start(fx);
  try {
    await check('library scan: all 13 installed games, sorted, first tile focused', async () => {
      const t = await titles(win);
      assert.strictEqual(t.length, 13, t.join(', '));
      assert.strictEqual(t[0], 'Battlefield™ 2042');
      assert.strictEqual((await focused(win)).index, 0);
    });

    await check('filter chips match the sources found, with counts', async () => {
      const chips = await win.$$eval('#filters .pill', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
      assert.deepStrictEqual(chips, ['ALL13', 'STEAM4', 'EPIC2', 'GOG1', 'AMAZON1', 'LUTRIS2', 'FLATHUB1', 'INSTALLED1', 'EMULATION1']);
    });

    await check('anti-cheat badges on Battlefield 2042 and Fortnite only', async () => {
      const flagged = await win.$$eval('#grid .tile', (els) => els.filter((e) => e.querySelector('.ac')).map((e) => e.querySelector('.ttl').textContent));
      assert.deepStrictEqual(flagged.sort(), ['Battlefield™ 2042', 'Fortnite']);
    });

    await check('arrow keys and WASD move focus through the grid (real key presses)', async () => {
      key('Right', 'Right');
      assert.strictEqual((await focused(win)).index, 2);
      key('d');
      assert.strictEqual((await focused(win)).index, 3);
      key('s');
      assert.strictEqual((await focused(win)).index, 11);
      key('w', 'a');
      assert.strictEqual((await focused(win)).index, 2);
      key('Down', 'Left');
      assert.strictEqual((await focused(win)).index, 9);
    });

    await check('up from the first row reaches the filter chips, then the tabs', async () => {
      key('Up', 'Up');
      const f = await focused(win);
      assert.ok(f.filter, 'expected a filter chip, got ' + JSON.stringify(f));
      key('Up');
      assert.ok(/HOME|LIBRARY|STORE|SOCIAL/.test((await focused(win)).text));
      key('Down', 'Down');
      assert.ok((await focused(win)).index >= 0);
    });

    await check('F cycles the source filter, Shift+F goes back, Enter on a chip picks it', async () => {
      key('f');
      assert.strictEqual(await win.evaluate(() => window.__np.state.filter), 'STEAM');
      assert.deepStrictEqual(await titles(win), ['Battlefield™ 2042', 'Halo: The Master Chief Collection', 'Hades', 'Stardew Valley'].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })));
      key('f', 'f');
      assert.strictEqual(await win.evaluate(() => window.__np.state.filter), 'GOG');
      key('shift+f', 'shift+f', 'shift+f');
      assert.strictEqual(await win.evaluate(() => window.__np.state.filter), 'ALL');
      // walk to the LUTRIS chip with the keyboard and press Enter
      key('Up');
      for (let i = 0; i < 10 && (await focused(win)).filter !== 'LUTRIS'; i++) key('Right');
      key('Return');
      assert.deepStrictEqual(await titles(win), ['Overwatch 2', 'The Sims 4']);
      key('Escape'); // back from grid goes to chips; from chips nothing breaks
      for (let i = 0; i < 10 && (await focused(win)).filter !== 'ALL'; i++) key('Left');
      key('Return', 'Down');
    });

    const goTo = async (title) => {
      const t = await titles(win);
      const idx = t.indexOf(title);
      assert.ok(idx >= 0, title + ' not visible');
      const cur = (await focused(win)).index;
      const cols = 8;
      const [r0, c0] = [Math.floor(cur / cols), cur % cols];
      const [r1, c1] = [Math.floor(idx / cols), idx % cols];
      for (let i = 0; i < Math.abs(r1 - r0); i++) key(r1 > r0 ? 'Down' : 'Up');
      for (let i = 0; i < Math.abs(c1 - c0); i++) key(c1 > c0 ? 'Right' : 'Left');
      assert.strictEqual((await focused(win)).index, idx, 'focus on ' + title);
    };

    await check('Enter on a Steam game hands off to Steam (steam://rungameid) and says so', async () => {
      await goTo('Hades');
      key('Return');
      await waitFor(() => fx.readLog().includes('xdg-open [steam://rungameid/1145360]'));
      assert.ok(fx.readLog().includes('xdg-open [steam://rungameid/1145360]'), fx.readLog());
      const toast = await win.textContent('#toast');
      assert.ok(/LAUNCHING HADES via Steam/i.test(toast), toast);
    });

    await check('Enter on a Heroic (Epic) game hands off to Heroic', async () => {
      await goTo('Control');
      key('Return');
      await waitFor(() => fx.readLog().includes('heroic://launch/legendary/Hawk'));
      assert.ok(fx.readLog().includes('xdg-open [heroic://launch/legendary/Hawk]'), fx.readLog());
    });

    await check('Enter on an installed .desktop game runs it under gamemoderun', async () => {
      await goTo('SuperTuxKart');
      key('Return');
      await waitFor(() => fx.readLog().includes('supertuxkart'));
      const log = fx.readLog();
      assert.ok(/gamemoderun\nsupertuxkart\n/.test(log), log);
      assert.ok(/GAMEMODE ON/.test(await win.textContent('#toast')));
    });

    await check('blocked anti-cheat game asks first; BACK cancels, LAUNCH ANYWAY launches', async () => {
      await goTo('Battlefield™ 2042');
      const before = fx.readLog();
      key('Return');
      await win.waitForSelector('#modal:not([hidden])', { timeout: 3000 });
      assert.ok(/ANTI-CHEAT BLOCKS LINUX/.test(await win.textContent('#modal-badge')));
      assert.ok(/Anti-cheat: .*areweanticheatyet/i.test(await win.textContent('#modal-ac')));
      assert.strictEqual((await focused(win)).text, 'BACK', 'safe default focus');
      key('Return');
      await wait(300);
      assert.ok(await win.$eval('#modal', (m) => m.hidden));
      assert.strictEqual(fx.readLog(), before, 'nothing launched');
      assert.ok((await focused(win)).index >= 0, 'focus back on the grid');
      key('Return', 'Right', 'Return');
      await waitFor(() => fx.readLog().includes('steam://rungameid/1517290'));
      assert.ok(fx.readLog().includes('xdg-open [steam://rungameid/1517290]'));
    });

    await check('Esc closes the anti-cheat warning too', async () => {
      key('Return');
      await win.waitForSelector('#modal:not([hidden])', { timeout: 3000 });
      key('Escape');
      await wait(200);
      assert.ok(await win.$eval('#modal', (m) => m.hidden));
    });

    await check('favorite from the game page: star on the tile and a FAVORITES chip; unfavorite removes it', async () => {
      await goTo('Disco Elysium');
      const favorite = async () => {
        key('x');
        await win.waitForSelector('#view-detail:not([hidden])');
        key('Right'); // PLAY → FAVORITE
        assert.ok(/FAVORITE/.test((await focused(win)).text));
        key('Return');
        await wait(200);
        key('Escape');
        await win.waitForSelector('#view-library:not([hidden])');
      };
      await favorite();
      await waitFor(() => win.$('#filters [data-filter="FAVORITES"]'));
      assert.ok(await win.$('#filters [data-filter="FAVORITES"]'));
      assert.strictEqual((await focused(win)).id, 'heroic:gog:1771589310', 'focus back on the same game');
      assert.ok(await win.$('#grid .tile.focus .fav'));
      await favorite();
      assert.ok(!(await win.$('#filters [data-filter="FAVORITES"]')));
    });

    await check('1 / 3 switch tabs; Tab works too; LIBRARY comes back with the grid', async () => {
      key('3');
      assert.ok(await win.$eval('.tab[data-tab="store"]', (e) => e.classList.contains('active')));
      key('Tab');
      assert.ok(await win.$eval('.tab[data-tab="social"]', (e) => e.classList.contains('active')));
      key('1', '1');
      assert.ok(await win.$eval('.tab[data-tab="library"]', (e) => e.classList.contains('active')));
      key('1');
      assert.ok(await win.$eval('.tab[data-tab="home"]', (e) => e.classList.contains('active')));
      key('3');
      assert.ok((await focused(win)).index >= 0);
    });

    await check('PgDn / PgUp jump two rows', async () => {
      key('Prior');
      const a = (await focused(win)).index;
      key('Next');
      const b = (await focused(win)).index;
      assert.ok(b > a, a + ' → ' + b);
    });

    await check('Xbox controller: connects, hint bar switches to A/B/X/Y, d-pad moves, A launches', async () => {
      await plugPad(win, 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)');
      await waitFor(() => win.$eval('#pad-status', (e) => e.classList.contains('on')));
      await tap(win, BTN.LEFT);
      await waitFor(async () => (await win.textContent('#hints')).includes('APlay'));
      const hints = (await win.textContent('#hints')).replace(/\s+/g, '');
      assert.ok(/APlay.*XDetails.*YNextfilter.*BBack/.test(hints), hints);
      assert.strictEqual(await win.textContent('.g-lb'), 'LB');
      // go to the top-left tile with the d-pad
      for (let i = 0; i < 4; i++) await tap(win, BTN.UP);
      for (let i = 0; i < 3; i++) await tap(win, BTN.DOWN);
      for (let i = 0; i < 9; i++) await tap(win, BTN.LEFT);
      const start = (await focused(win)).index;
      assert.strictEqual(start % 8, 0, 'left column, got ' + start + ' ' + JSON.stringify(await focused(win)));
      await tap(win, BTN.RIGHT);
      assert.strictEqual((await focused(win)).index, start + 1);
      // 13 games = two rows; move to the other row and back
      const otherRow = start >= 8 ? BTN.UP : BTN.DOWN;
      await tap(win, otherRow);
      assert.strictEqual((await focused(win)).index, start >= 8 ? start - 7 : start + 9);
      await tap(win, otherRow === BTN.UP ? BTN.DOWN : BTN.UP);
      assert.strictEqual((await focused(win)).index, start + 1);
      const t = await titles(win);
      const title = t[(await focused(win)).index];
      const before = fx.readLog().length;
      await tap(win, BTN.A);
      await waitFor(() => fx.readLog().length > before || win.$eval('#modal', (m) => !m.hidden));
      assert.ok(fx.readLog().length > before || !(await win.$eval('#modal', (m) => m.hidden)), 'A launched ' + title);
      if (!(await win.$eval('#modal', (m) => m.hidden))) await tap(win, BTN.B);
    });

    await check('controller: holding the d-pad repeats; left stick moves too', async () => {
      for (let i = 0; i < 9; i++) await tap(win, BTN.LEFT);
      const a = (await focused(win)).index;
      await tap(win, BTN.RIGHT, 900);
      const b = (await focused(win)).index;
      assert.ok(b - a >= 3, 'held right moved ' + (b - a));
      await win.evaluate(() => { window.__pad.axes[0] = -0.9; });
      await wait(80);
      await win.evaluate(() => { window.__pad.axes[0] = 0; });
      await wait(80);
      assert.strictEqual((await focused(win)).index, b - 1);
    });

    await check('controller: Y cycles filters, RB/LB switch tabs, B leaves the grid', async () => {
      await tap(win, BTN.Y);
      assert.strictEqual(await win.evaluate(() => window.__np.state.filter), 'STEAM');
      await tap(win, BTN.Y);
      assert.strictEqual(await win.evaluate(() => window.__np.state.filter), 'EPIC');
      await tap(win, BTN.RB);
      assert.ok(await win.$eval('.tab[data-tab="store"]', (e) => e.classList.contains('active')));
      await tap(win, BTN.LB);
      assert.ok(await win.$eval('.tab[data-tab="library"]', (e) => e.classList.contains('active')));
      await tap(win, BTN.B);
      assert.ok((await focused(win)).filter, 'B moved focus to the chips');
    });

    await check('controller: View + Menu together asks to exit; B says no', async () => {
      await win.evaluate(() => { window.__pad.buttons[8].pressed = true; window.__pad.buttons[9].pressed = true; });
      await wait(120);
      await win.evaluate(() => { window.__pad.buttons[8].pressed = false; window.__pad.buttons[9].pressed = false; });
      await win.waitForSelector('#modal:not([hidden])', { timeout: 2000 });
      assert.ok(/EXIT TO DESKTOP/.test(await win.textContent('#modal-title')));
      await tap(win, BTN.B);
      await wait(150);
      assert.ok(await win.$eval('#modal', (m) => m.hidden));
    });

    await check('PlayStation controller: hint bar shows ✕ ○ □ △ and L1/R1', async () => {
      await win.evaluate(() => { window.__pad.connected = false; });
      await wait(150);
      await plugPad(win, 'Sony Interactive Entertainment DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)');
      await tap(win, BTN.DOWN);
      await waitFor(async () => (await win.textContent('#hints')).includes('✕'));
      const hints = await win.textContent('#hints');
      assert.ok(hints.includes('✕') && hints.includes('○') && hints.includes('□') && hints.includes('△'), hints);
      assert.strictEqual(await win.textContent('.g-rb'), 'R1');
    });

    await check('a key press switches the hint bar back to keyboard keys', async () => {
      key('Escape');
      await waitFor(async () => (await win.textContent('#hints')).includes('Enter'));
      assert.ok((await win.textContent('#hints')).includes('Esc'));
    });

    await check('mouse: hovering focuses a tile, clicking launches it', async () => {
      await win.evaluate(() => { navigator.getGamepads = () => [null, null, null, null]; });
      await win.evaluate(() => { window.__np.state.filter = 'ALL'; });
      key('1', '3'); // re-render on LIBRARY
      const tile = await win.$('#grid .tile[data-id="desktop:retroarch"]');
      assert.ok(tile, 'RetroArch tile visible');
      const box = await tile.boundingBox();
      await win.mouse.move(box.x + 10, box.y + 10);
      await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
      await waitFor(async () => (await focused(win)).id === 'desktop:retroarch');
      assert.strictEqual((await focused(win)).id, 'desktop:retroarch');
      await win.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await waitFor(() => fx.readLog().includes('retroarch [--menu]'));
      assert.ok(fx.readLog().includes('retroarch [--menu]'), fx.readLog());
    });

    await check('INSTALLED ONLY toggle shows owned-but-not-installed games', async () => {
      await win.click('#installed-only');
      const t = await titles(win);
      assert.ok(t.includes('Alan Wake 2') && t.includes("Baldur's Gate 3"), t.join(', '));
      await win.click('#installed-only');
      assert.strictEqual((await titles(win)).length, 13);
    });

    await check('Ctrl+Q asks before exiting; Esc cancels', async () => {
      key('ctrl+q');
      await win.waitForSelector('#modal:not([hidden])', { timeout: 2000 });
      key('Escape');
      await wait(150);
      assert.ok(await win.$eval('#modal', (m) => m.hidden));
    });

    await check('play time is tracked for directly-run games', async () => {
      const ud = await app.evaluate(({ app: a }) => a.getPath('userData'));
      await wait(500);
      const h = JSON.parse(require('fs').readFileSync(path.join(ud, 'history.json'), 'utf8'));
      assert.ok(h.games['desktop:supertuxkart'] && h.games['desktop:supertuxkart'].lastPlayed > 0);
      assert.ok(h.games['steam:1145360'].launches >= 1);
    });

    await check('no errors in the page', async () => { assert.deepStrictEqual(errors, []); });
  } finally {
    await app.close();
  }

  // ---- first run on a machine with nothing installed ----
  const empty = makeHome({ empty: true });
  const e = await start(empty);
  try {
    await check('empty home: Packet, NO GAMES ON THIS GRID YET, each launcher reported, RESCAN focused', async () => {
      assert.ok(await e.win.$('#view-empty:not([hidden]) #packet'));
      assert.ok(/NO GAMES ON THIS GRID YET/.test(await e.win.textContent('#view-empty h1')));
      const rows = await e.win.$$eval('#scan-results .src', (els) => els.map((x) => x.textContent));
      assert.strictEqual(rows.length, 4);
      assert.ok(rows.every((r) => /nothing found/.test(r)));
      assert.ok(/RESCAN/.test((await focused(e.win)).text));
      key('Return');
      await wait(400);
      assert.deepStrictEqual(e.errors, []);
    });
  } finally {
    await e.app.close();
  }

  console.log(failed ? '\nSOME CHECKS FAILED' : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
