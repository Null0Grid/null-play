'use strict';
/* global Nav */
// On-screen keyboard for typing with a controller (Wi-Fi passwords, the
// SteamGridDB key). A physical keyboard works while it's open too.
//   A type the key · X delete · Y space · LB shift · RB 123/ABC
//   ☰ (Menu) done · B cancel
(function () {
  const $ = (s) => document.querySelector(s);
  const LETTERS = [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', '-'],
    ['@shift', 'z', 'x', 'c', 'v', 'b', 'n', 'm', '.', '@back'],
    ['@sym', '@space', '@done'],
  ];
  const SYMBOLS = [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['!', '@', '#', '$', '%', '^', '&', '*', '(', ')'],
    ['_', '=', '+', '[', ']', '{', '}', ';', ':', '/'],
    ['@shift', "'", '"', ',', '<', '>', '?', '\\', '|', '@back'],
    ['@sym', '@space', '@done'],
  ];
  const LABEL = { '@shift': '⇧ SHIFT', '@back': '⌫', '@space': 'SPACE', '@done': 'DONE', '@sym': '?123' };

  let opts = null;
  let text = '';
  let shift = false;
  let symbols = false;
  let reveal = false;
  let returnFocus = null;

  function render(keepKey) {
    const box = $('#osk-keys');
    box.textContent = '';
    for (const row of (symbols ? SYMBOLS : LETTERS)) {
      const r = document.createElement('div');
      r.className = 'osk-row';
      for (const k of row) {
        const b = document.createElement('button');
        b.className = 'osk-key' + (k === '@space' ? ' space' : k.startsWith('@') ? ' wide' : '') + (k === '@done' ? ' done' : '');
        if ((k === '@shift' && shift) || (k === '@sym' && symbols)) b.classList.add('on');
        b.dataset.nav = '';
        b.dataset.osk = '';
        b.dataset.key = k;
        const shown = k.startsWith('@') ? (k === '@sym' && symbols ? 'ABC' : LABEL[k]) : (shift ? k.toUpperCase() : k);
        b.textContent = shown;
        b.setAttribute('aria-label', k === '@back' ? 'Delete' : k === '@shift' ? 'Shift' : shown);
        b.addEventListener('click', () => press(k));
        r.append(b);
      }
      box.append(r);
    }
    const target = (keepKey && box.querySelector('[data-key="' + CSS.escape(keepKey) + '"]')) || box.querySelector('[data-key="q"]') || box.querySelector('[data-key="!"]');
    Nav.focus(target);
  }

  function paint() {
    const shown = opts && opts.secret && !reveal ? '•'.repeat(text.length) : text;
    $('#osk-text').textContent = shown;
    $('#osk-reveal').hidden = !(opts && opts.secret);
    $('#osk-reveal').textContent = reveal ? 'HIDE' : 'SHOW';
  }

  function insert(ch) {
    if (opts.maxLength && text.length >= opts.maxLength) return;
    text += ch;
    if (shift && /[a-z]/i.test(ch)) { shift = false; render(Nav.current && Nav.current.dataset.key); }
    paint();
  }

  // keep: the key to leave focus on after a re-render (shortcut buttons
  // shouldn't move the cursor to the SHIFT / ?123 key)
  function press(k, keep) {
    if (!opts) return;
    if (k === '@back') text = text.slice(0, -1);
    else if (k === '@space') insert(' ');
    else if (k === '@shift') { shift = !shift; render(keep || '@shift'); }
    else if (k === '@sym') { symbols = !symbols; render(keep || '@sym'); }
    else if (k === '@done') { done(); return; }
    else insert(shift ? k.toUpperCase() : k);
    paint();
  }

  function open(o) {
    opts = o || {};
    text = String(opts.value || '');
    shift = false;
    symbols = false;
    reveal = false;
    returnFocus = Nav.current;
    $('#osk-title').textContent = opts.title || 'TYPE';
    $('#osk-err').textContent = opts.error || '';
    $('#osk').hidden = false;
    paint();
    render();
    if (opts.onOpen) opts.onOpen();
  }

  function close() {
    $('#osk').hidden = true;
    const o = opts;
    opts = null;
    if (returnFocus && returnFocus.isConnected) Nav.focus(returnFocus);
    return o;
  }

  function done() { const value = text; const o = close(); if (o && o.onDone) o.onDone(value); }
  function cancel() { const o = close(); if (o && o.onCancel) o.onCancel(); }

  $('#osk-reveal').addEventListener('click', () => { reveal = !reveal; paint(); });

  // controller actions while open; returns true when used
  function action(a) {
    if (!opts) return false;
    switch (a) {
      case 'up': case 'down': case 'left': case 'right': Nav.move(a); return true;
      case 'a': Nav.activate(); return true;
      case 'b': cancel(); return true;
      case 'x': press('@back'); return true;
      case 'y': press('@space'); return true;
      case 'lb': press('@shift', Nav.current && Nav.current.dataset.key); return true;
      case 'rb': press('@sym', Nav.current && Nav.current.dataset.key); return true;
      case 'menu': done(); return true;
      default: return true; // swallow everything else while typing
    }
  }

  // physical keyboard while open: printable characters type, arrows move
  function key(e) {
    if (!opts) return false;
    if (e.key === 'Enter') { done(); return true; }
    if (e.key === 'Escape') { cancel(); return true; }
    if (e.key === 'Backspace') { press('@back'); return true; }
    if (e.key.startsWith('Arrow')) { Nav.move(e.key.slice(5).toLowerCase()); return true; }
    if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) { insert(e.key); return true; }
    return true;
  }

  window.OSK = {
    open, action, key, cancel,
    get isOpen() { return !!opts; },
    setError(msg) { $('#osk-err').textContent = msg || ''; },
    get value() { return text; },
  };
})();
