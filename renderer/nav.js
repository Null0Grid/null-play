'use strict';
// Spatial focus navigation for controller / keyboard. Anything marked
// [data-nav] and visible is a stop; a direction picks the nearest stop that
// way, preferring ones in the same row (left/right) or column (up/down).
// While a [data-modal] stop exists, only modal stops count.
(function () {
  let current = null;
  const listeners = [];
  // containers marked [data-nav-entry] pick where focus lands when you move
  // into them from outside: a selector ("#hero-play") or "remember" (the item
  // you were on last time)
  const lastIn = new WeakMap();

  function visible(el) {
    if (!el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    return !el.closest('[hidden]');
  }

  function stops() {
    const modal = [...document.querySelectorAll('[data-modal][data-nav]')].filter(visible);
    if (modal.length) return modal;
    return [...document.querySelectorAll('#app [data-nav]')].filter(visible);
  }

  function center(r) { return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }

  function focus(el, opts = {}) {
    if (!el) return;
    if (current && current !== el) current.classList.remove('focus');
    current = el;
    el.classList.add('focus');
    const box = el.closest('[data-nav-entry]');
    if (box) lastIn.set(box, el);
    if (!opts.noScroll) {
      const behavior = opts.instant ? 'auto' : 'smooth';
      // horizontal rows (Continue, library peek) keep the focused item in view
      const row = el.closest('.row');
      if (row) {
        const r = el.getBoundingClientRect();
        const w = row.getBoundingClientRect();
        const pad = 30;
        if (r.left < w.left + pad) row.scrollBy({ left: r.left - w.left - pad, behavior });
        else if (r.right > w.right - pad) row.scrollBy({ left: r.right - w.right + pad, behavior });
      }
      const wrap = el.closest('[data-scroll]');
      if (wrap) {
        const r = (el.closest('.row-sec') || el).getBoundingClientRect();
        const w = wrap.getBoundingClientRect();
        const pad = 40;
        if (el.closest('.hero')) wrap.scrollTo({ top: 0, behavior });
        else if (r.top < w.top + pad) wrap.scrollBy({ top: r.top - w.top - pad, behavior });
        else if (r.bottom > w.bottom - pad) wrap.scrollBy({ top: r.bottom - w.bottom + pad, behavior });
      }
    }
    for (const fn of listeners) fn(el);
  }

  function move(dir) {
    const all = stops();
    if (!all.length) return false;
    if (!current || !all.includes(current)) { focus(all[0]); return true; }
    const cr = current.getBoundingClientRect();
    const strictRow = !!current.closest('.grid, .row, .filterbar, .tabs');
    const c = center(cr);
    let best = null;
    let bestScore = Infinity;
    for (const el of all) {
      if (el === current) continue;
      const r = el.getBoundingClientRect();
      const p = center(r);
      const dx = p.x - c.x;
      const dy = p.y - c.y;
      let primary, secondary;
      if (dir === 'right') { if (dx <= 4) continue; primary = dx; secondary = Math.abs(dy); }
      else if (dir === 'left') { if (dx >= -4) continue; primary = -dx; secondary = Math.abs(dy); }
      else if (dir === 'down') { if (dy <= 4 || r.top < cr.top + 4) continue; primary = dy; secondary = Math.abs(dx); }
      else { if (dy >= -4 || r.bottom > cr.bottom - 4) continue; primary = -dy; secondary = Math.abs(dx); }
      // same row/column wins: sideways offset costs much more than distance
      const horiz = dir === 'left' || dir === 'right';
      const overlap = horiz ? (r.bottom > cr.top && r.top < cr.bottom) : (r.right > cr.left && r.left < cr.right);
      // in grids and rows, left/right stay in the row (at the end of a row the
      // press does nothing); elsewhere a stop that isn't level still counts,
      // just with a heavy penalty
      if (horiz && !overlap && strictRow) continue;
      const score = primary + secondary * (horiz ? 4 : 1.2) - (overlap ? 10000 : 0);
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) {
      const box = best.closest('[data-nav-entry]');
      if (box && !box.contains(current)) {
        const rule = box.getAttribute('data-nav-entry');
        const remembered = lastIn.get(box);
        const pick = rule === 'remember' ? (remembered && remembered.isConnected && all.includes(remembered) ? remembered : null) : box.querySelector(rule);
        if (pick && all.includes(pick)) best = pick;
      }
      focus(best);
      return true;
    }
    return false;
  }

  function activate() { if (current && stops().includes(current)) current.click(); }

  window.Nav = {
    focus,
    move,
    activate,
    get current() { return current; },
    stops,
    onFocus: (fn) => listeners.push(fn),
    clear() { if (current) current.classList.remove('focus'); current = null; },
  };
})();
