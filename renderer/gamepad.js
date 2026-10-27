'use strict';
// Controller input through Chromium's Gamepad API ("standard" mapping covers
// Xbox, PlayStation and most generic pads on Linux). Polls every frame and
// turns buttons into actions; d-pad, left stick and triggers repeat on hold.
(function () {
  const BTN = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, view: 8, menu: 9, up: 12, down: 13, left: 14, right: 15, guide: 16 };
  const REPEAT = new Set(['up', 'down', 'left', 'right', 'lt', 'rt']);
  const FIRST_DELAY = 380;
  const RATE = 95;
  const listeners = [];
  const held = {};
  let type = null;   // 'xbox' | 'ps' | 'generic'
  let connected = false;
  const connListeners = [];

  function kind(id) {
    const s = String(id || '').toLowerCase();
    if (/045e|xbox|x-box|xinput/.test(s)) return 'xbox';
    if (/054c|playstation|dualshock|dualsense/.test(s)) return 'ps';
    return 'generic';
  }

  function emit(action) { for (const fn of listeners) fn(action, type); }

  function pressed(b) { return !!b && (b.pressed || b.value > 0.5); }

  function frame(now) {
    const pads = (navigator.getGamepads ? navigator.getGamepads() : []) || [];
    const pad = [...pads].find((p) => p && p.connected);
    if (!!pad !== connected) {
      connected = !!pad;
      type = pad ? kind(pad.id) : null;
      for (const fn of connListeners) fn(connected, type);
    }
    if (pad) {
      const state = {};
      for (const [name, i] of Object.entries(BTN)) state[name] = pressed(pad.buttons[i]);
      const ax = pad.axes || [];
      if ((ax[0] || 0) < -0.5) state.left = true;
      if ((ax[0] || 0) > 0.5) state.right = true;
      if ((ax[1] || 0) < -0.5) state.up = true;
      if ((ax[1] || 0) > 0.5) state.down = true;
      for (const name of Object.keys(state)) {
        if (state[name]) {
          if (!held[name]) { held[name] = { since: now, last: now }; emit(name); }
          else if (REPEAT.has(name) && now - held[name].since > FIRST_DELAY && now - held[name].last > RATE) { held[name].last = now; emit(name); }
        } else if (held[name]) {
          delete held[name];
          emit(name + ':up');
        }
      }
      // View + Menu together: exit to desktop
      if (state.view && state.menu && !held._combo) { held._combo = true; emit('exit'); }
      if (!(state.view && state.menu)) delete held._combo;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.Pad = {
    onAction: (fn) => listeners.push(fn),
    onConnection: (fn) => connListeners.push(fn),
    get type() { return type; },
    get connected() { return connected; },
    heldFor(name) { return held[name] ? performance.now() - held[name].since : 0; },
  };
})();
