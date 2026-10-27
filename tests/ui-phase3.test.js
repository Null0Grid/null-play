'use strict';
// End-to-end check of Phase 3 (quick settings + on-screen keyboard) in the
// real app, with stand-in nmcli / wpctl / busctl / bluetoothctl / systemctl:
//   open / close with Q and the controller's Menu button, Wi-Fi status and
//   network list, connecting with a password typed on the on-screen keyboard
//   (controller and physical keys, wrong password retry, masking), Wi-Fi off /
//   on, volume and brightness sliders (◀ ▶, mute), controller connect and
//   pairing, sleep with confirmation, and missing tools.
//   xvfb-run -a -s "-screen 0 1440x900x24" node tests/ui-phase3.test.js
const assert = require('assert');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const pw = require('playwright');
const { makeHome } = require('./fixtures/make-home');
const { installFakeSystem } = require('./fixtures/fake-system');

const APP_DIR = path.resolve(__dirname, '..');
const electronPath = require(path.join(APP_DIR, 'node_modules', 'electron'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const key = (...k) => { for (const x of k) { execFileSync('xdotool', ['key', '--clearmodifiers', x]); execFileSync('sleep', ['0.09']); } };
const type = (t) => execFileSync('xdotool', ['type', '--delay', '25', t]);
async function waitFor(fn, timeoutMs = 6000) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeoutMs) { try { last = await fn(); if (last) return last; } catch {} await wait(80); }
  return last;
}
let failed = false;
const check = async (label, fn) => { try { await fn(); console.log('[pass] ' + label); } catch (e) { failed = true; console.log('[FAIL] ' + label + ': ' + e.message); } };

async function start(fx, env) {
  const app = await pw._electron.launch({
    executablePath: electronPath,
    args: [APP_DIR, '--windowed', '--no-sandbox'],
    env: { ...process.env, ...fx.env, NULLPLAY_HOME: fx.home, NULLPLAY_OFFLINE: '1', NULLPLAY_BT_SCAN_SECS: '4', NULLPLAY_USER_DATA: path.join(os.tmpdir(), 'np-p3-' + Date.now()), ...env },
  });
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  await win.setViewportSize({ width: 1440, height: 810 });
  await waitFor(() => app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; if (!w.isFocused()) { w.show(); w.focus(); } return w.isFocused(); }));
  await win.waitForSelector('#boot', { state: 'hidden', timeout: 6000 });
  return { app, win, errors };
}

const focused = (win) => win.evaluate(() => {
  const f = document.querySelector('.focus');
  return f ? { id: f.id || null, text: f.textContent.trim().replace(/\s+/g, ' ').slice(0, 60), key: f.dataset.key || null, ssid: f.dataset.ssid || null, mac: f.dataset.mac || null } : null;
});
async function focusTo(win, pred, dir = 'Down', max = 12) {
  for (let i = 0; i < max; i++) { if (pred(await focused(win))) return; key(dir); }
  if (!pred(await focused(win))) throw new Error('could not reach target; on ' + JSON.stringify(await focused(win)));
}
async function plugPad(win) {
  await win.evaluate(() => {
    const pad = { id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', index: 0, connected: true, mapping: 'standard', timestamp: 0,
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] };
    window.__pad = pad;
    navigator.getGamepads = () => [pad, null, null, null];
  });
  await wait(100);
}
async function tap(win, b, ms = 70) {
  await win.evaluate((i) => { window.__pad.buttons[i].pressed = true; }, b);
  await wait(ms);
  await win.evaluate((i) => { window.__pad.buttons[i].pressed = false; }, b);
  await wait(70);
}
const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, MENU: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

(async () => {
  const fx = makeHome();
  const fake = installFakeSystem(fx);
  const { app, win, errors } = await start(fx, { NULLPLAY_BACKLIGHT_DIR: fake.backlightDir });
  try {
    await check('Q opens quick settings: Wi-Fi, volume, brightness and controllers filled in', async () => {
      const before = (await focused(win)).text;
      key('q');
      await win.waitForSelector('#qs:not([hidden])');
      await waitFor(async () => /HomeNet/.test(await win.textContent('#qs-wifi-state')));
      assert.strictEqual(await win.textContent('#qs-wifi-state'), 'HomeNet · 82%');
      assert.strictEqual((await focused(win)).id, 'qs-wifi');
      assert.strictEqual(await win.textContent('#qs-vol-val'), '64%');
      assert.strictEqual(await win.textContent('#qs-vol-out'), 'HDMI / DisplayPort Audio');
      assert.strictEqual(await win.textContent('#qs-bri-val'), '80%');
      const pads = await win.$$eval('#qs-pads .qs-pad', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
      assert.deepStrictEqual(pads, ['Xbox Wireless Controllerconnected · 70%', 'DualSense Wireless Controlleroff'].map((x) => x.replace(/\s+/g, ' ')));
      assert.ok(before, 'something was focused before');
      const hints = await win.textContent('#hints');
      assert.ok(/Adjust/.test(hints) && /Close/.test(hints), hints);
    });

    await check('volume slider: ◀ ▶ change it (applied through wpctl), Enter mutes, turning it up unmutes', async () => {
      key('Down');
      assert.strictEqual((await focused(win)).id, 'qs-vol');
      key('Right', 'Right');
      assert.strictEqual(await win.textContent('#qs-vol-val'), '74%');
      await waitFor(() => Math.abs(fake.read().audio.volume - 0.74) < 0.001);
      assert.ok(Math.abs(fake.read().audio.volume - 0.74) < 0.001, String(fake.read().audio.volume));
      key('Left');
      await waitFor(() => Math.abs(fake.read().audio.volume - 0.69) < 0.001);
      key('Return');
      await waitFor(async () => (await win.textContent('#qs-vol-val')) === 'MUTED');
      assert.strictEqual(fake.read().audio.muted, true);
      key('Right');
      await waitFor(() => fake.read().audio.muted === false);
      assert.strictEqual(fake.read().audio.muted, false);
    });

    await check('brightness slider: ◀ ◀ to 70% → logind sets the backlight', async () => {
      key('Down');
      assert.strictEqual((await focused(win)).id, 'qs-bri');
      key('Left', 'Left');
      assert.strictEqual(await win.textContent('#qs-bri-val'), '70%');
      await waitFor(() => fake.brightnessRaw() === 13440);
      assert.strictEqual(fake.brightnessRaw(), 13440);
    });

    await check('controllers: Enter on an off controller connects it', async () => {
      await focusTo(win, (f) => f.mac === 'A0:5A:5C:00:00:02');
      key('Return');
      await waitFor(() => fake.read().bt.devices.find((d) => d.mac === 'A0:5A:5C:00:00:02').connected);
      await waitFor(async () => /DualSense Wireless Controllerconnected/.test((await win.textContent('#qs-pads')).replace(/\s+/g, ' ')));
      assert.ok(/DualSense Wireless Controller ?connected/.test((await win.textContent('#qs-pads')).replace(/\s+/g, ' ')));
    });

    await check('pairing: scan finds the 8BitDo (not the phone), pairing it adds it to the list', async () => {
      await focusTo(win, (f) => f.id === 'qs-pair');
      key('Return');
      await win.waitForSelector('#qs-pair-view:not([hidden])');
      await win.waitForSelector('#qs-found .qs-net', { timeout: 10000 });
      const found = await win.$$eval('#qs-found .qs-net .nm', (els) => els.map((e) => e.textContent));
      assert.deepStrictEqual(found, ['8BitDo Pro 2']);
      assert.strictEqual((await focused(win)).mac, 'E4:17:D8:00:00:04');
      key('Return');
      await waitFor(async () => /paired/.test(await win.textContent('#qs-pair-msg')), 8000);
      await win.waitForSelector('#qs-main:not([hidden])', { timeout: 4000 });
      await waitFor(async () => /8BitDo Pro 2/.test(await win.textContent('#qs-pads')));
      const d = fake.read().bt.devices.find((x) => x.mac === 'E4:17:D8:00:00:04');
      assert.deepStrictEqual([d.paired, d.trusted, d.connected], [true, true, true]);
    });

    await check('Wi-Fi list: networks with the current one first; Back returns to the panel', async () => {
      await focusTo(win, (f) => f.id === 'qs-wifi', 'Up');
      key('Return');
      await win.waitForSelector('#qs-wifi-view:not([hidden])');
      await win.waitForSelector('#qs-nets .qs-net');
      const nets = await win.$$eval('#qs-nets .qs-net', (els) => els.map((e) => e.dataset.ssid));
      assert.deepStrictEqual(nets, ['HomeNet', 'Lab-5G', 'Cafe: Free']);
      assert.ok(/connected/.test(await win.textContent('#qs-nets .qs-net.cur')));
      key('Escape');
      await win.waitForSelector('#qs-main:not([hidden])');
      assert.strictEqual((await focused(win)).id, 'qs-wifi');
      key('Return');
      await win.waitForSelector('#qs-nets .qs-net');
    });

    await check('secured network: on-screen keyboard asks for the password, masked; wrong password asks again', async () => {
      await focusTo(win, (f) => f.ssid === 'Lab-5G');
      key('Return');
      await win.waitForSelector('#osk:not([hidden])', { timeout: 5000 });
      assert.ok(/PASSWORD FOR LAB-5G/.test(await win.textContent('#osk-title')));
      assert.strictEqual((await focused(win)).key, 'q');
      type('wrong');
      assert.strictEqual(await win.textContent('#osk-text'), '•••••');
      await win.click('#osk-reveal');
      assert.strictEqual(await win.textContent('#osk-text'), 'wrong');
      key('Return');
      await waitFor(async () => !(await win.$eval('#osk', (e) => e.hidden)) && /Wrong password/.test(await win.textContent('#osk-err')), 6000);
      assert.ok(/Wrong password/.test(await win.textContent('#osk-err')));
      assert.strictEqual(await win.textContent('#osk-text'), '', 'starts empty again');
    });

    await check('on-screen keyboard with a controller: A types, X deletes, Y space, LB shift, RB symbols, hints', async () => {
      await plugPad(win);
      await tap(win, BTN.A);                         // q
      assert.strictEqual(await win.evaluate(() => OSK.value), 'q');
      await tap(win, BTN.X);                         // delete
      assert.strictEqual(await win.evaluate(() => OSK.value), '');
      await tap(win, BTN.LB);                        // shift
      await tap(win, BTN.RIGHT);                     // w
      await tap(win, BTN.A);
      assert.strictEqual(await win.evaluate(() => OSK.value), 'W', 'shifted once');
      await tap(win, BTN.A);
      assert.strictEqual(await win.evaluate(() => OSK.value), 'Ww', 'shift is one-shot');
      await tap(win, BTN.Y);
      assert.strictEqual(await win.evaluate(() => OSK.value), 'Ww ');
      await tap(win, BTN.RB);                        // symbols
      assert.ok(await win.$('#osk-keys [data-key="!"]'));
      await tap(win, BTN.RB);
      const hints = (await win.textContent('#hints')).replace(/\s+/g, '');
      assert.ok(/AType.*XDelete.*YSpace.*LBShift.*RB123.*☰Done.*BCancel/.test(hints), hints);
      for (let i = 0; i < 3; i++) await tap(win, BTN.X);
      assert.strictEqual(await win.evaluate(() => OSK.value), '');
    });

    await check('right password typed, Menu (Done) connects; the password never appears on a command line', async () => {
      type('correct horse');
      assert.strictEqual(await win.evaluate(() => OSK.value), 'correct horse');
      await tap(win, BTN.MENU);
      await win.waitForSelector('#osk', { state: 'hidden' });
      await waitFor(() => fake.read().wifi.connected === 'Lab-5G', 8000);
      assert.strictEqual(fake.read().wifi.connected, 'Lab-5G');
      await waitFor(async () => /Connected to Lab-5G/.test(await win.textContent('#qs-wifi-msg')));
      assert.ok(!fx.readLog().includes('correct horse'));
      assert.ok(fx.readLog().includes('nmcli-password-received yes'));
      await waitFor(async () => /Lab-5G/.test(await win.textContent('#qs-wifi-state')));
    });

    await check('B on the keyboard cancels without connecting', async () => {
      // a secured network we've never joined
      fake.write((s) => { s.wifi.networks.push({ ssid: 'Neighbor', signal: 20, security: 'WPA2', freq: '2462 MHz', password: 'x' }); });
      key('Escape');
      await win.waitForSelector('#qs-main:not([hidden])');
      await wait(300);
      key('Return');
      await win.waitForSelector('#qs-nets .qs-net[data-ssid="Neighbor"]', { timeout: 8000 });
      await focusTo(win, (f) => f.ssid === 'Neighbor');
      await tap(win, BTN.A);
      await win.waitForSelector('#osk:not([hidden])');
      await tap(win, BTN.B);
      await win.waitForSelector('#osk', { state: 'hidden' });
      assert.strictEqual(fake.read().wifi.connected, 'Lab-5G');
      assert.strictEqual((await focused(win)).ssid, 'Neighbor', 'focus back on the network');
    });

    await check('Wi-Fi off and on again from the list', async () => {
      await focusTo(win, (f) => f.id === 'qs-wifi-back', 'Up');
      key('Right');
      assert.strictEqual((await focused(win)).id, 'qs-wifi-radio');
      key('Return');
      await waitFor(() => fake.read().wifi.enabled === false);
      await waitFor(async () => /Wi-Fi is off/.test(await win.textContent('#qs-wifi-msg')));
      assert.strictEqual(await win.textContent('#qs-wifi-radio'), 'OFF');
      key('Return');
      await waitFor(() => fake.read().wifi.enabled === true);
      await win.waitForSelector('#qs-nets .qs-net');
    });

    await check('B goes back, B again closes; focus returns to where it was', async () => {
      key('Escape');
      await win.waitForSelector('#qs-main:not([hidden])');
      key('Escape');
      await win.waitForSelector('#qs', { state: 'hidden' });
      assert.ok(await win.$('#view-home:not([hidden]) .focus'));
    });

    await check('controller Menu button opens and closes quick settings', async () => {
      await tap(win, BTN.MENU);
      await win.waitForSelector('#qs:not([hidden])');
      await tap(win, BTN.MENU);
      await win.waitForSelector('#qs', { state: 'hidden' });
    });

    await check('SLEEP asks first (BACK is the default); confirming suspends through systemctl', async () => {
      key('q');
      await win.waitForSelector('#qs:not([hidden])');
      await focusTo(win, (f) => f.id === 'qs-sleep');
      key('Return');
      await win.waitForSelector('#modal:not([hidden])');
      assert.strictEqual(await win.textContent('#modal-title'), 'SLEEP NOW?');
      assert.strictEqual((await focused(win)).text, 'BACK');
      key('Escape');
      await win.waitForSelector('#modal', { state: 'hidden' });
      assert.ok(!(await win.$eval('#qs', (e) => e.hidden)), 'panel still open');
      assert.strictEqual((await focused(win)).id, 'qs-sleep');
      assert.strictEqual(fake.read().power, null);
      key('Return', 'Right', 'Return');
      await waitFor(() => fake.read().power === 'suspend');
      assert.strictEqual(fake.read().power, 'suspend');
      await win.waitForSelector('#qs', { state: 'hidden' });
    });

    await check('no page errors', async () => assert.deepStrictEqual(errors, []));
  } finally {
    await app.close();
  }

  // ---- a computer without these tools ----
  const bare = makeHome();
  const b = await start(bare, { PATH: bare.bin, NULLPLAY_BACKLIGHT_DIR: path.join(bare.home, 'none') });
  try {
    await check('without NetworkManager / PipeWire / BlueZ: each section says unavailable, nothing breaks', async () => {
      key('q');
      await b.win.waitForSelector('#qs:not([hidden])');
      await waitFor(async () => (await b.win.textContent('#qs-wifi-state')) !== '…');
      assert.strictEqual(await b.win.textContent('#qs-wifi-state'), 'unavailable');
      assert.strictEqual(await b.win.textContent('#qs-vol-val'), '–');
      assert.strictEqual(await b.win.getAttribute('#qs-vol', 'aria-disabled'), 'true');
      assert.ok(/ddcutil|unavailable/.test(await b.win.textContent('#qs-bri-via')));
      assert.ok(/BlueZ|unavailable/.test(await b.win.textContent('#qs-bt-state')));
      assert.ok(await b.win.$eval('#qs-pair', (e) => e.hidden));
      key('Right', 'Down', 'Right');
      assert.deepStrictEqual(b.errors, []);
    });
  } finally {
    await b.app.close();
  }

  console.log(failed ? '\nSOME CHECKS FAILED' : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
