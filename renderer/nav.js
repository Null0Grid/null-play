'use strict';
// Spatial focus navigation for controller / keyboard. Anything marked
// [data-nav] and visible is a stop; a direction picks the nearest stop that
// way, preferring ones in the same row (left/right) or column (up/down).
// While a [data-modal] stop exists, only modal stops count.
(function () {
  let current = null;
  const listeners = [];

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
    if (!opts.noScroll) {
      const wrap = el.closest('.grid-wrap');
      if (wrap) {
        const r = el.getBoundingClientRect();
        const w = wrap.getBoundingClientRect();
        const pad = 40;
        if (r.top < w.top + pad) wrap.scrollBy({ top: r.top - w.top - pad, behavior: opts.instant ? 'auto' : 'smooth' });
        else if (r.bottom > w.bottom - pad) wrap.scrollBy({ top: r.bottom - w.bottom + pad, behavior: opts.instant ? 'auto' : 'smooth' });
      }
    }
    for (const fn of listeners) fn(el);
  }

  function move(dir) {
    const all = stops();
    if (!all.length) return false;
    if (!current || !all.includes(current)) { focus(all[0]); return true; }
    const cr = current.getBoundingClientRect();
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
      // left/right stay in the row: at the end of a row the press does nothing
      if (horiz && !overlap) continue;
      const score = primary + secondary * (horiz ? 4 : 1.2) - (overlap ? 10000 : 0);
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) { focus(best); return true; }
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
