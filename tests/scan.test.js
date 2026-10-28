'use strict';
// Unit checks for the library scanners, anti-cheat matching and launch
// commands, against a generated fake $HOME.   node tests/scan.test.js
const assert = require('assert');
const path = require('path');
const { makeHome } = require('./fixtures/make-home');
const vdf = require('../src/scan/vdf');
const { scanSteam } = require('../src/scan/steam');
const { scanHeroic } = require('../src/scan/heroic');
const { scanLutris, parsePlaytime } = require('../src/scan/lutris');
const { scanDesktop, splitExec } = require('../src/scan/desktop');
const { scanAll } = require('../src/scan');
const { AntiCheat, loadSnapshot, norm } = require('../src/anticheat');
const { buildCommand } = require('../src/launch');

let failed = 0;
async function t(name, fn) {
  try { await fn(); console.log('[pass] ' + name); } catch (e) { failed++; console.log('[FAIL] ' + name + '\n       ' + (e.stack || e).toString().split('\n').slice(0, 3).join('\n       ')); }
}

(async () => {
  const fx = makeHome();
  const env = { ...process.env, ...fx.env };
  const ac = new AntiCheat(loadSnapshot(null).games);

  await t('vdf: nested blocks, comments, escapes, case-insensitive keys', () => {
    const v = vdf.parse('"Root"\n{\n "A" "1" // note\n "Sub" { "Name" "say \\"hi\\"" }\n}');
    assert.strictEqual(v.root.a, '1');
    assert.strictEqual(v.root.sub.name, 'say "hi"');
  });

  await t('steam: both library folders, tools skipped, no duplicates via ~/.steam symlink', () => {
    const g = scanSteam(fx.home);
    const names = g.map((x) => x.title).sort();
    assert.deepStrictEqual(names, ["Baldur's Gate 3", 'Battlefield™ 2042', 'Hades', 'Halo: The Master Chief Collection', 'Stardew Valley']);
  });

  await t('steam: play time, last played, install state and launch URL', () => {
    const g = scanSteam(fx.home);
    const hades = g.find((x) => x.title === 'Hades');
    assert.strictEqual(hades.playtimeMin, 2556);
    assert.ok(hades.lastPlayed > 0);
    assert.strictEqual(hades.installed, true);
    assert.strictEqual(hades.launch.url, 'steam://rungameid/1145360');
    assert.strictEqual(g.find((x) => x.title === "Baldur's Gate 3").installed, false);
  });

  await t('steam: art from new per-app folders (incl. hashed subfolder) and the old flat layout', () => {
    const g = scanSteam(fx.home);
    const hades = g.find((x) => x.title === 'Hades');
    assert.ok(/1145360[/\\]library_600x900\.jpg$/.test(hades.art.cover));
    assert.ok(/a1b2c3[/\\]library_hero\.jpg$/.test(hades.art.hero));
    assert.ok(/413150_library_600x900\.jpg$/.test(g.find((x) => x.title === 'Stardew Valley').art.cover));
  });

  await t('heroic: Epic, GOG and Amazon games, DLC skipped, installed state, play time', () => {
    const g = scanHeroic(fx.home);
    const by = Object.fromEntries(g.map((x) => [x.title, x]));
    assert.ok(!by['Some DLC']);
    assert.strictEqual(by.Control.store, 'EPIC');
    assert.strictEqual(by.Control.installed, true);
    assert.strictEqual(by.Control.playtimeMin, 545);
    assert.strictEqual(by.Control.launch.url, 'heroic://launch/legendary/Hawk');
    assert.strictEqual(by['Disco Elysium'].store, 'GOG');
    assert.strictEqual(by['Disco Elysium'].launch.url, 'heroic://launch/gog/1771589310');
    assert.strictEqual(by['Wolfenstein: The New Order'].store, 'AMAZON');
    assert.strictEqual(by['Alan Wake 2'].installed, false);
    assert.strictEqual(by['Alan Wake 2'].launch.kind, 'launcher');
  });

  await t('lutris: CLI JSON with log noise, Steam-runner duplicates skipped, play time formats', async () => {
    const g = await scanLutris(fx.home, env);
    assert.deepStrictEqual(g.map((x) => x.title).sort(), ['Overwatch 2', 'The Sims 4']);
    const ow = g.find((x) => x.title === 'Overwatch 2');
    assert.strictEqual(ow.playtimeMin, 200);
    assert.strictEqual(ow.launch.url, 'lutris:rungameid/9');
    assert.ok(/overwatch-2\.jpg$/.test(ow.art.cover));
    assert.strictEqual(parsePlaytime('12.5'), 750);
  });

  await t('lutris: missing CLI means an empty list, not an error', async () => {
    const g = await scanLutris(fx.home, { ...env, PATH: '/nonexistent' });
    assert.deepStrictEqual(g, []);
  });

  await t('desktop: games only, launcher / generated / hidden entries skipped, Flathub + emulator tagged', () => {
    const g = scanDesktop(fx.home, env);
    const by = Object.fromEntries(g.map((x) => [x.title, x]));
    assert.deepStrictEqual(Object.keys(by).sort(), ['RetroArch', 'SuperTuxKart', 'Veloren']);
    assert.strictEqual(by.Veloren.store, 'FLATHUB');
    assert.strictEqual(by.RetroArch.store, 'EMULATION');
    assert.strictEqual(by.SuperTuxKart.store, 'INSTALLED');
    assert.deepStrictEqual(by.SuperTuxKart.launch.argv, ['supertuxkart']);
    assert.ok(/supertuxkart\.png$/.test(by.SuperTuxKart.art.icon));
  });

  await t('desktop: Exec quoting and field codes', () => {
    assert.deepStrictEqual(splitExec('"/opt/My Game/run" --x "a \\"b\\"" %f %%u'), ['/opt/My Game/run', '--x', 'a "b"', '%u']);
  });

  await t('anti-cheat: Steam id, Epic slug and exact title matching; no loose matches', () => {
    assert.strictEqual(ac.lookup({ ids: { steam: '1517290' }, title: 'x' }).level, 'blocked');
    assert.strictEqual(ac.lookup({ ids: { epicSlug: 'fortnite' }, title: 'whatever' }).status, 'Denied');
    assert.strictEqual(ac.lookup({ ids: {}, title: 'FORTNITE' }).status, 'Denied');
    assert.strictEqual(ac.lookup({ ids: { steam: '976730' }, title: '' }).level, 'ok');
    assert.strictEqual(ac.lookup({ ids: {}, title: 'Fortnite Festival Fan Edition' }), null);
    assert.strictEqual(ac.lookup({ ids: {}, title: 'Stardew Valley' }), null);
    assert.strictEqual(norm('Battlefield™ 2042'), 'battlefield 2042');
  });

  await t('scanAll: merges everything, flags anti-cheat, applies favorites and our own history', async () => {
    const lib = await scanAll({ home: fx.home, env, anticheat: ac, favorites: ['desktop:supertuxkart'], history: { 'desktop:supertuxkart': { playtimeMin: 42, lastPlayed: 1761500000 } } });
    assert.ok(lib.games.length >= 14, 'got ' + lib.games.length);
    const by = Object.fromEntries(lib.games.map((x) => [x.id, x]));
    assert.strictEqual(by['steam:1517290'].anticheat.level, 'blocked');
    assert.strictEqual(by['heroic:legendary:Fortnite'].anticheat.status, 'Denied');
    assert.strictEqual(by['desktop:supertuxkart'].favorite, true);
    assert.strictEqual(by['desktop:supertuxkart'].playtimeMin, 42);
    assert.strictEqual(lib.report.steam.found, 5);
    assert.deepStrictEqual(lib.games.map((g) => g.title), [...lib.games.map((g) => g.title)].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })));
  });

  await t('launch: URL hand-off via xdg-open, desktop games wrapped in gamemoderun, bad URLs refused', () => {
    const steam = buildCommand({ source: 'steam', launch: { kind: 'url', url: 'steam://rungameid/1145360' } }, { env });
    assert.deepStrictEqual(steam.argv, ['xdg-open', 'steam://rungameid/1145360']);
    const desk = buildCommand({ source: 'desktop', launch: { kind: 'exec', argv: ['supertuxkart'] } }, { env });
    assert.deepStrictEqual([path.basename(desk.argv[0]), ...desk.argv.slice(1)], ['gamemoderun', 'supertuxkart']);
    assert.ok(path.isAbsolute(desk.argv[0]), 'full path, so /usr/games works off PATH');
    const fs = require('fs');
    const games = fs.mkdtempSync(require('os').tmpdir() + '/np-usrgames-');
    fs.writeFileSync(games + '/gamemoderun', '#!/bin/sh\n', { mode: 0o755 });
    const { which } = require('../src/launch');
    assert.strictEqual(which('gamemoderun', { PATH: '/nonexistent' }, [games]), games + '/gamemoderun');
    const off = buildCommand({ source: 'desktop', launch: { kind: 'exec', argv: ['supertuxkart'] } }, { env, gamemode: false });
    assert.deepStrictEqual(off.argv, ['supertuxkart']);
    assert.throws(() => buildCommand({ launch: { kind: 'url', url: 'steam://rungameid/1;rm -rf' } }, { env }));
    assert.throws(() => buildCommand({ launch: { kind: 'url', url: 'https://evil.example' } }, { env }));
  });

  await t('empty home: every scan returns nothing, cleanly', async () => {
    const e = makeHome({ empty: true });
    const lib = await scanAll({ home: e.home, env: { ...process.env, ...e.env }, anticheat: ac });
    assert.strictEqual(lib.games.length, 0);
    for (const k of ['steam', 'heroic', 'lutris', 'desktop']) assert.strictEqual(lib.report[k].found, 0);
  });

  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
