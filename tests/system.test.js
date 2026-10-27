'use strict';
// Quick-settings backend against stand-in system tools.   node tests/system.test.js
const assert = require('assert');
const { makeHome } = require('./fixtures/make-home');
const { installFakeSystem } = require('./fixtures/fake-system');
const { System, splitTerse } = require('../src/system');

let failed = 0;
async function t(name, fn) {
  try { await fn(); console.log('[pass] ' + name); } catch (e) { failed++; console.log('[FAIL] ' + name + '\n       ' + (e.stack || e).toString().split('\n').slice(0, 3).join('\n       ')); }
}

(async () => {
  const fx = makeHome({ empty: true });
  const fake = installFakeSystem(fx);
  const env = { ...process.env, ...fx.env };
  const sys = new System({ env, backlightDir: fake.backlightDir });

  await t('nmcli terse parsing: escaped colons and backslashes', () => {
    assert.deepStrictEqual(splitTerse('*:Cafe\\: Free:40:--:2437 MHz'), ['*', 'Cafe: Free', '40', '--', '2437 MHz']);
    assert.deepStrictEqual(splitTerse('a\\\\b:c'), ['a\\b', 'c']);
  });

  await t('Wi-Fi status: adapter, connected network and its signal', async () => {
    const s = await sys.wifiStatus();
    assert.deepStrictEqual([s.available, s.enabled, s.connected, s.ssid, s.signal, s.device], [true, true, true, 'HomeNet', 82, 'wlp2s0']);
  });

  await t('Wi-Fi list: one entry per network (strongest band), current first, open networks marked', async () => {
    const { networks } = await sys.wifiList();
    assert.deepStrictEqual(networks.map((n) => n.ssid), ['HomeNet', 'Lab-5G', 'Cafe: Free']);
    assert.strictEqual(networks[0].inUse, true);
    assert.strictEqual(networks[0].band, '5 GHz');
    assert.strictEqual(networks[2].secure, false);
    assert.strictEqual(networks[2].band, '2.4 GHz');
  });

  await t('Wi-Fi connect: wrong password reported, right one connects, password sent on stdin only', async () => {
    const bad = await sys.wifiConnect('Lab-5G', 'nope');
    assert.strictEqual(bad.ok, false);
    assert.strictEqual(bad.needsPassword, true);
    assert.strictEqual(bad.error, 'Wrong password');
    const good = await sys.wifiConnect('Lab-5G', 'correct horse');
    assert.strictEqual(good.ok, true);
    assert.strictEqual(fake.read().wifi.connected, 'Lab-5G');
    assert.ok(!fx.readLog().includes('correct horse'), 'password never on a command line');
    assert.ok(fx.readLog().includes('nmcli-password-received yes'));
  });

  await t('Wi-Fi connect: a known network reconnects without a password; bad input refused', async () => {
    const r = await sys.wifiConnect('HomeNet');
    assert.strictEqual(r.ok, true);
    assert.ok(/nmcli \[connection\] \[up\] \[id\] \[HomeNet\]/.test(fx.readLog()));
    assert.strictEqual((await sys.wifiConnect('x'.repeat(40))).ok, false);
    assert.strictEqual((await sys.wifiConnect('ok', 'a\nb')).ok, false);
  });

  await t('Wi-Fi radio off / on', async () => {
    await sys.wifiRadio(false);
    assert.strictEqual((await sys.wifiStatus()).enabled, false);
    await sys.wifiRadio(true);
    assert.strictEqual((await sys.wifiStatus()).enabled, true);
  });

  await t('volume: level, output name, set (clamped), mute toggle', async () => {
    const v = await sys.volume();
    assert.deepStrictEqual([v.level, v.muted, v.output], [64, false, 'HDMI / DisplayPort Audio']);
    assert.strictEqual((await sys.setVolume(120)).level, 100);
    assert.strictEqual((await sys.setVolume(35)).level, 35);
    assert.strictEqual((await sys.toggleMute()).muted, true);
    assert.strictEqual((await sys.setVolume(40)).muted, false, 'turning it up unmutes');
  });

  await t('brightness (laptop): read from the backlight, set through logind, never fully black', async () => {
    const b = await sys.brightness();
    assert.deepStrictEqual([b.available, b.via, b.level], [true, 'backlight', 80]);
    assert.strictEqual((await sys.setBrightness(50)).level, 50);
    assert.strictEqual(fake.brightnessRaw(), 9600);
    await sys.setBrightness(0);
    assert.ok(fake.brightnessRaw() >= 1);
    assert.ok(/busctl .*\[SetBrightness\] \[ssu\] \[backlight\] \[intel_backlight\]/.test(fx.readLog()));
  });

  await t('brightness (external monitor): ddcutil when there is no backlight; unavailable without either', async () => {
    const fx2 = makeHome({ empty: true });
    const f2 = installFakeSystem(fx2, { noBacklight: true, ddc: { level: 70 } });
    const s2 = new System({ env: { ...process.env, ...fx2.env }, backlightDir: f2.backlightDir });
    const b = await s2.brightness();
    assert.deepStrictEqual([b.via, b.level], ['ddcutil', 70]);
    await s2.setBrightness(30);
    assert.strictEqual(f2.read().ddc.level, 30);
    f2.write((s) => { s.ddc = null; });
    assert.strictEqual((await s2.brightness()).available, false);
  });

  await t('controllers: only gamepads listed (not headphones), with connection and battery', async () => {
    const c = await sys.controllers();
    assert.strictEqual(c.available, true);
    assert.deepStrictEqual(c.devices.map((d) => [d.name, d.connected, d.battery]), [['Xbox Wireless Controller', true, 70], ['DualSense Wireless Controller', false, null]]);
  });

  await t('pairing: scan finds the new controller (not the phone), pair + trust + connect', async () => {
    const s = await sys.btScan(4);
    assert.deepStrictEqual(s.found.map((d) => d.name), ['8BitDo Pro 2']);
    const p = await sys.btPair('E4:17:D8:00:00:04');
    assert.deepStrictEqual([p.ok, p.connected], [true, true]);
    const d = fake.read().bt.devices.find((x) => x.mac === 'E4:17:D8:00:00:04');
    assert.deepStrictEqual([d.paired, d.trusted, d.connected], [true, true, true]);
    assert.strictEqual((await sys.btPair('not-a-mac')).ok, false);
  });

  await t('connect / disconnect / forget a controller', async () => {
    assert.strictEqual((await sys.btConnect('A0:5A:5C:00:00:02', true)).ok, true);
    assert.strictEqual((await sys.btConnect('A0:5A:5C:00:00:02', false)).ok, true);
    assert.strictEqual((await sys.btForget('A0:5A:5C:00:00:02')).ok, true);
    assert.ok(!(await sys.controllers()).devices.some((d) => d.mac === 'A0:5A:5C:00:00:02'));
  });

  await t('power: only suspend / poweroff / reboot, through systemctl', async () => {
    assert.strictEqual(sys.power('rm -rf').ok, false);
    sys.power('suspend');
    await new Promise((r) => setTimeout(r, 400));
    assert.strictEqual(fake.read().power, 'suspend');
  });

  await t('tools missing: every section reports unavailable instead of failing', async () => {
    const bare = new System({ env: { ...process.env, PATH: '/nonexistent' }, backlightDir: '/nonexistent' });
    const s = await bare.status();
    assert.deepStrictEqual([s.wifi.available, s.volume.available, s.brightness.available, s.controllers.available], [false, false, false, false]);
  });

  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
