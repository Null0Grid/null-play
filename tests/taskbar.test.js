'use strict';
// The Plasma taskbar pin script (build/null-play-taskbar.js), run against a
// stand-in of Plasma's desktop scripting API.   node tests/taskbar.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'build', 'null-play-taskbar.js'), 'utf8');

function widget(type, launchers) {
  const cfg = { 'General/launchers': launchers };
  return {
    type,
    currentConfigGroup: [],
    reloaded: 0,
    readConfig(key, def) { const k = this.currentConfigGroup.join('/') + '/' + key; return k in cfg ? cfg[k] : def; },
    writeConfig(key, value) { cfg[this.currentConfigGroup.join('/') + '/' + key] = value; },
    reloadConfig() { this.reloaded++; },
    get launchers() { const v = cfg['General/launchers']; return Array.isArray(v) ? Array.from(v) : v; },
  };
}
function run(panelsList) { vm.runInNewContext(SRC, { panels: () => panelsList.map((ws) => ({ widgets: () => ws })) }); }

let failed = 0;
function t(name, fn) { try { fn(); console.log('[pass] ' + name); } catch (e) { failed++; console.log('[FAIL] ' + name + ': ' + e.message); } }

t('pins NULL // PLAY after the existing launchers (Plasma 6 icon-only task manager)', () => {
  const tm = widget('org.kde.plasma.icontasks', ['applications:systemsettings.desktop', 'applications:org.kde.dolphin.desktop']);
  run([[widget('org.kde.plasma.kickoff'), tm, widget('org.kde.plasma.systemtray')]]);
  assert.deepStrictEqual(tm.launchers, ['applications:systemsettings.desktop', 'applications:org.kde.dolphin.desktop', 'applications:null-play.desktop']);
  assert.strictEqual(tm.reloaded, 1);
});

t('running it again changes nothing (no duplicate pin)', () => {
  const tm = widget('org.kde.plasma.icontasks', ['applications:null-play.desktop']);
  run([[tm]]);
  run([[tm]]);
  assert.deepStrictEqual(tm.launchers, ['applications:null-play.desktop']);
  assert.strictEqual(tm.reloaded, 0);
});

t('works with the classic task manager, a comma string, an empty list, and several panels', () => {
  const a = widget('org.kde.plasma.taskmanager', 'applications:firefox.desktop,applications:org.kde.konsole.desktop');
  const b = widget('org.kde.plasma.icontasks', undefined);
  run([[a], [widget('org.kde.plasma.digitalclock'), b]]);
  assert.deepStrictEqual(a.launchers, ['applications:firefox.desktop', 'applications:org.kde.konsole.desktop', 'applications:null-play.desktop']);
  assert.deepStrictEqual(b.launchers, ['applications:null-play.desktop']);
});

t('leaves other widgets alone', () => {
  const tray = widget('org.kde.plasma.systemtray', ['x']);
  run([[tray]]);
  assert.deepStrictEqual(tray.launchers, ['x']);
});

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
