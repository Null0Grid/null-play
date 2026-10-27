'use strict';
/* global Nav, Pad */
(function () {
  const api = window.nullplay;
  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  const STORE_ORDER = ['STEAM', 'EPIC', 'GOG', 'AMAZON', 'HEROIC', 'LUTRIS', 'FLATHUB', 'INSTALLED', 'EMULATION'];
  const STORE_NAME = { STEAM: 'Steam', EPIC: 'Epic via Heroic', GOG: 'GOG via Heroic', AMAZON: 'Amazon via Heroic', HEROIC: 'Heroic', LUTRIS: 'Lutris', FLATHUB: 'Flathub', INSTALLED: 'installed app', EMULATION: 'emulator' };
  const SORTS = [['az', 'A–Z'], ['recent', 'RECENT'], ['playtime', 'PLAY TIME']];
  const TABS = ['home', 'library', 'store', 'social'];
  const SOON = {
    home: ['HOME', 'The hero banner and the Continue row are next on the build list. Your games are under LIBRARY.'],
    store: ['STORE', 'Flathub games you can install from here, plus shortcuts to the Steam, Epic and GOG stores. Coming soon.'],
    social: ['SOCIAL', 'Steam Friends, Discord, Xbox Cloud Gaming and GeForce NOW tiles. Coming soon.'],
  };
  const GLYPHS = {
    keyboard: { a: 'Enter', b: 'Esc', x: 'X', y: 'F', lb: '1', rb: '3', lt: 'PgUp', rt: 'PgDn', menu: 'Q' },
    xbox: { a: 'A', b: 'B', x: 'X', y: 'Y', lb: 'LB', rb: 'RB', lt: 'LT', rt: 'RT', menu: '☰' },
    ps: { a: '✕', b: '○', x: '□', y: '△', lb: 'L1', rb: 'R1', lt: 'L2', rt: 'R2', menu: 'OPT' },
  };
  GLYPHS.generic = GLYPHS.xbox;

  const state = {
    lib: { games: [], report: {} },
    tab: 'library',
    filter: 'ALL',
    sort: 'az',
    installedOnly: true,
    input: 'keyboard',
    modalGame: null,
    modalKind: null,
  };

  // ---------- formatting ----------
  function fmtPlaytime(min) {
    if (!min) return '';
    if (min < 60) return min + ' min';
    const h = min / 60;
    return (h < 100 ? h.toFixed(1) : Math.round(h)) + ' h';
  }
  function fmtLast(ts) {
    if (!ts) return '';
    const d = new Date(ts * 1000);
    const days = Math.floor((startOfDay(new Date()) - startOfDay(d)) / 864e5);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 7) return days + ' days ago';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
  }
  function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); }

  // ---------- input device + hint bar ----------
  function glyphSet() { return state.input === 'pad' ? GLYPHS[Pad.type || 'generic'] : GLYPHS.keyboard; }

  function setInput(mode) {
    if (state.input === mode) return;
    state.input = mode;
    document.body.dataset.input = mode;
    renderHints();
  }

  function renderHints() {
    const g = glyphSet();
    $('.g-lb').textContent = g.lb;
    $('.g-rb').textContent = g.rb;
    const bar = $('#hints');
    bar.textContent = '';
    const add = (k, label, cls) => {
      const h = el('span', 'h');
      h.append(el('span', 'key ' + (cls || k), g[k]), document.createTextNode(label));
      bar.append(h);
    };
    if (!$('#modal').hidden) {
      add('a', 'Select'); add('b', 'Back');
      return;
    }
    const left = el('span', 'h left');
    if (state.tab === 'library' && !$('#view-library').hidden) {
      const f = state.lib.games.length ? visibleGames().length + ' of ' + baseGames().length : '';
      left.textContent = f ? 'Filter: ' + state.filter + ' · ' + f : '';
      bar.append(left);
      add('a', 'Play'); add('x', 'Favorite'); add('y', 'Next filter'); add('lt', 'Page', 'lt');
    } else {
      bar.append(left);
      add('a', 'Select');
    }
    add('b', 'Back');
  }

  // ---------- library ----------
  function baseGames() { return state.lib.games.filter((g) => !state.installedOnly || g.installed); }

  function matchesFilter(g, f) {
    if (f === 'ALL') return true;
    if (f === 'FAVORITES') return g.favorite;
    return g.store === f;
  }

  function visibleGames() {
    const list = baseGames().filter((g) => matchesFilter(g, state.filter));
    if (state.sort === 'recent') list.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0) || a.title.localeCompare(b.title));
    else if (state.sort === 'playtime') list.sort((a, b) => (b.playtimeMin || 0) - (a.playtimeMin || 0) || a.title.localeCompare(b.title));
    return list;
  }

  function filterList() {
    const base = baseGames();
    const counts = {};
    for (const g of base) counts[g.store] = (counts[g.store] || 0) + 1;
    const out = [['ALL', base.length]];
    for (const s of STORE_ORDER) if (counts[s]) out.push([s, counts[s]]);
    const fav = base.filter((g) => g.favorite).length;
    if (fav) out.push(['FAVORITES', fav]);
    return out;
  }

  function renderFilters() {
    const list = filterList();
    if (!list.some(([f]) => f === state.filter)) state.filter = 'ALL';
    const box = $('#filters');
    box.textContent = '';
    for (const [f, n] of list) {
      const b = el('button', 'pill' + (f === state.filter ? ' active' : ''));
      b.dataset.nav = '';
      b.dataset.filter = f;
      b.append(document.createTextNode(f), el('span', 'n', String(n)));
      b.addEventListener('click', () => setFilter(f));
      box.append(b);
    }
    $('#sort-label').textContent = SORTS.find((s) => s[0] === state.sort)[1];
    $('#installed-only').setAttribute('aria-pressed', String(state.installedOnly));
    $('#installed-only').textContent = state.installedOnly ? 'INSTALLED ONLY' : 'ALL OWNED';
  }

  function tileFor(g) {
    const t = el('button', 'tile');
    t.dataset.nav = '';
    t.dataset.id = g.id;
    t.setAttribute('role', 'listitem');
    const acNote = g.anticheat && g.anticheat.level !== 'ok' ? ', ' + g.anticheat.label.toLowerCase() : '';
    t.setAttribute('aria-label', g.title + ', ' + (STORE_NAME[g.store] || g.store) + (g.installed ? '' : ', not installed') + acNote);
    const c = el('div', 'cover');
    const art = g.art || {};
    const src = art.cover || art.header || art.icon;
    if (src) {
      const img = new Image();
      img.alt = '';
      img.decoding = 'async';
      img.loading = 'lazy';
      img.src = src;
      if (!art.cover) img.className = art.header ? 'header' : 'icon';
      else c.classList.add('has-art');
      img.onerror = () => { img.remove(); c.classList.remove('has-art'); };
      c.append(img);
    }
    c.append(el('span', 'ttl', g.title));
    c.append(el('span', 'inst' + (g.installed ? '' : ' off')));
    if (g.favorite) c.append(el('span', 'fav', '★'));
    if (g.anticheat && g.anticheat.level !== 'ok') {
      c.classList.add('flagged');
      c.append(el('span', 'ac' + (g.anticheat.level === 'warn' ? ' warn' : ''), '⚠ ' + g.anticheat.label));
    }
    t.append(c);
    const meta = [g.store];
    if (state.sort === 'recent' && g.lastPlayed) meta.push(fmtLast(g.lastPlayed));
    else if (g.playtimeMin) meta.push(fmtPlaytime(g.playtimeMin));
    else if (!g.installed) meta.push('not installed');
    t.append(el('span', 'meta', meta.join(' · ')));
    t.addEventListener('click', () => requestLaunch(g.id));
    t.addEventListener('mousemove', () => { if (state.input === 'mouse' && Nav.current !== t) Nav.focus(t, { noScroll: true }); });
    return t;
  }

  function renderGrid(keepId) {
    const grid = $('#grid');
    grid.textContent = '';
    const frag = document.createDocumentFragment();
    for (const g of visibleGames()) frag.append(tileFor(g));
    grid.append(frag);
    const target = (keepId && grid.querySelector('[data-id="' + CSS.escape(keepId) + '"]')) || grid.querySelector('.tile');
    if (target) Nav.focus(target, { instant: true });
    else Nav.focus($('#filters .pill'));
  }

  function renderLibrary(keepId) {
    renderFilters();
    renderGrid(keepId);
    renderHints();
  }

  function setFilter(f) {
    state.filter = f;
    renderFilters();
    renderGrid();
    $('#grid-wrap').scrollTop = 0;
    renderHints();
    const pill = $('#filters [data-filter="' + CSS.escape(f) + '"]');
    // keep the pill in focus when it was the thing pressed, else the first game
    if (Nav.current && Nav.current.dataset && Nav.current.dataset.filter) Nav.focus(pill);
    else if (!document.querySelector('#grid .tile')) Nav.focus(pill);
  }

  function cycleFilter(step) {
    const list = filterList().map((x) => x[0]);
    const i = list.indexOf(state.filter);
    state.filter = list[(i + step + list.length) % list.length];
    renderFilters();
    renderGrid();
    $('#grid-wrap').scrollTop = 0;
    renderHints();
  }

  // ---------- empty state ----------
  function renderEmpty() {
    const box = $('#scan-results');
    box.textContent = '';
    const r = state.lib.report || {};
    const rows = [
      ['STEAM', r.steam], ['HEROIC · EPIC, GOG, AMAZON', r.heroic], ['LUTRIS · EA, UBISOFT, BATTLE.NET…', r.lutris], ['INSTALLED GAMES (.DESKTOP)', r.desktop],
    ];
    for (const [name, res] of rows) {
      const row = el('div', 'src');
      row.append(el('span', 'nm', name));
      const found = res ? res.found : 0;
      row.append(el('span', 'st' + (found ? ' ok' : ''), found ? found + ' found' : 'nothing found'));
      box.append(row);
    }
  }

  // ---------- views + tabs ----------
  function showView(id) {
    for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== id;
  }

  function setTab(tab) {
    state.tab = tab;
    for (const b of document.querySelectorAll('.tab')) b.classList.toggle('active', b.dataset.tab === tab);
    if (tab === 'library') {
      if (!state.lib.games.length) { showView('view-empty'); renderEmpty(); Nav.focus($('#rescan')); }
      else { showView('view-library'); renderLibrary(Nav.current && Nav.current.dataset.id); }
    } else {
      showView('view-soon');
      $('#soon-title').textContent = SOON[tab][0];
      $('#soon-text').textContent = SOON[tab][1];
      Nav.focus(document.querySelector('.tab[data-tab="' + tab + '"]'));
    }
    renderHints();
  }

  function stepTab(step) {
    const i = TABS.indexOf(state.tab);
    setTab(TABS[(i + step + TABS.length) % TABS.length]);
  }

  // ---------- launching ----------
  let toastTimer = null;
  function toast(text, kind, ms) {
    const t = $('#toast');
    t.textContent = text;
    t.className = 'toast' + (kind ? ' ' + kind : '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms || 3200);
  }

  function findGame(id) { return state.lib.games.find((g) => g.id === id); }

  function requestLaunch(id) {
    const g = findGame(id);
    if (!g) return;
    if (g.anticheat && g.anticheat.level === 'blocked') return openModal('anticheat', g);
    doLaunch(g);
  }

  async function doLaunch(g) {
    const res = await api.launch(g.id);
    if (!res || !res.ok) { toast('Couldn’t start ' + g.title + ': ' + ((res && res.error) || 'unknown error'), 'err', 5000); return; }
    if (res.launcherOnly) { toast(g.title + ' isn’t installed. Opening ' + (STORE_NAME[g.store] || 'its launcher').replace(/^.* via /, '') + ' so you can install it.', 'warn', 5000); return; }
    g.lastPlayed = res.lastPlayed || g.lastPlayed;
    const via = res.handoff ? ' via ' + (STORE_NAME[g.store] || g.store).replace(/ via Heroic$/, ' (Heroic)') : '';
    if (g.anticheat && g.anticheat.level === 'warn') toast('LAUNCHING ' + g.title.toUpperCase() + via + ' · ' + g.anticheat.label, 'warn', 5000);
    else toast('LAUNCHING ' + g.title.toUpperCase() + via + (res.gamemode ? ' · GAMEMODE ON' : ''));
  }

  async function toggleFavorite() {
    const id = Nav.current && Nav.current.dataset.id;
    const g = id && findGame(id);
    if (!g) return;
    g.favorite = !g.favorite;
    await api.setFavorite(g.id, g.favorite);
    toast(g.favorite ? '★ ADDED TO FAVORITES' : 'REMOVED FROM FAVORITES', null, 1600);
    renderLibrary(g.id);
  }

  // ---------- modal ----------
  let modalReturn = null;
  function openModal(kind, g) {
    modalReturn = Nav.current;
    state.modalKind = kind;
    state.modalGame = g;
    const badge = $('#modal-badge');
    if (kind === 'anticheat') {
      badge.hidden = false;
      badge.className = 'badge' + (g.anticheat.level === 'warn' ? ' warn' : '');
      badge.textContent = '⚠ ' + g.anticheat.label;
      $('#modal-title').textContent = g.title.toUpperCase();
      $('#modal-detail').textContent = g.anticheat.detail;
      $('#modal-ac').textContent = (g.anticheat.anticheats.length ? 'Anti-cheat: ' + g.anticheat.anticheats.join(', ') + ' · ' : '') + 'source: areweanticheatyet.com';
      $('#modal-go').textContent = 'LAUNCH ANYWAY';
    } else if (kind === 'exit') {
      badge.hidden = true;
      $('#modal-title').textContent = 'EXIT TO DESKTOP?';
      $('#modal-detail').textContent = 'NULL // PLAY closes. Games you started keep running.';
      $('#modal-ac').textContent = '';
      $('#modal-go').textContent = 'EXIT';
    }
    $('#modal').hidden = false;
    Nav.focus($('#modal-back'));
    renderHints();
  }

  function closeModal() {
    $('#modal').hidden = true;
    state.modalKind = null;
    state.modalGame = null;
    if (modalReturn && modalReturn.isConnected) Nav.focus(modalReturn);
    renderHints();
  }

  $('#modal-back').addEventListener('click', closeModal);
  $('#modal-go').addEventListener('click', () => {
    const kind = state.modalKind;
    const g = state.modalGame;
    closeModal();
    if (kind === 'anticheat' && g) doLaunch(g);
    if (kind === 'exit') api.quit();
  });

  // ---------- actions (shared by controller, keyboard, mouse) ----------
  function act(a) {
    const modal = !$('#modal').hidden;
    switch (a) {
      case 'up': case 'down': case 'left': case 'right': Nav.move(a); break;
      case 'a': Nav.activate(); break;
      case 'b':
        if (modal) closeModal();
        else if (Nav.current && Nav.current.closest('.grid')) Nav.focus($('#filters .pill.active') || $('#filters .pill'));
        else if (state.tab !== 'library') setTab('library');
        break;
      case 'x': if (!modal && state.tab === 'library') toggleFavorite(); break;
      case 'y': if (!modal && state.tab === 'library' && state.lib.games.length) cycleFilter(1); break;
      case 'lb': if (!modal) stepTab(-1); break;
      case 'rb': if (!modal) stepTab(1); break;
      case 'lt': case 'rt':
        if (!modal && Nav.current && Nav.current.closest('.grid')) {
          const cols = getComputedStyle(document.documentElement).getPropertyValue('--cols').trim() | 0 || 8;
          const tiles = [...document.querySelectorAll('#grid .tile')];
          const i = tiles.indexOf(Nav.current);
          const j = Math.max(0, Math.min(tiles.length - 1, i + (a === 'rt' ? 1 : -1) * cols * 2));
          Nav.focus(tiles[j]);
        }
        break;
      case 'menu': if (!modal) toast('Quick settings are coming soon.', null, 2000); break;
      case 'exit': if (!modal) openModal('exit'); break;
      default: break;
    }
  }

  // keyboard
  const KEYS = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right',
    Enter: 'a', ' ': 'a', Escape: 'b', Backspace: 'b',
    x: 'x', i: 'x', f: 'y', '1': 'lb', '3': 'rb', PageUp: 'lt', PageDown: 'rt', q: 'menu',
  };
  document.addEventListener('keydown', (e) => {
    setInput('keyboard');
    if (e.ctrlKey && (e.key === 'q' || e.key === 'Q')) { e.preventDefault(); act('exit'); return; }
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === 'Tab') { e.preventDefault(); act(e.shiftKey ? 'lb' : 'rb'); return; }
    if ((e.key === 'F' || e.key === 'f') && e.shiftKey) { e.preventDefault(); if (state.tab === 'library' && state.lib.games.length) cycleFilter(-1); return; }
    if (e.key === 'r' || e.key === 'F5') { e.preventDefault(); rescan(); return; }
    const k = KEYS[e.key] || KEYS[e.key.toLowerCase()];
    if (!k) return;
    e.preventDefault();
    act(k);
  });
  // mouse: the pointer shows and hover moves focus; clicks are native
  document.addEventListener('mousemove', (e) => { if (e.movementX || e.movementY) setInput('mouse'); });
  for (const b of document.querySelectorAll('.tab')) b.addEventListener('click', () => setTab(b.dataset.tab));
  $('#sort').addEventListener('click', () => {
    const i = SORTS.findIndex((s) => s[0] === state.sort);
    state.sort = SORTS[(i + 1) % SORTS.length][0];
    renderFilters(); renderGrid(); Nav.focus($('#sort')); renderHints();
  });
  $('#installed-only').addEventListener('click', () => {
    state.installedOnly = !state.installedOnly;
    renderFilters(); renderGrid(); Nav.focus($('#installed-only')); renderHints();
  });
  $('#rescan').addEventListener('click', () => rescan());

  // controller
  Pad.onAction((a) => {
    if (a.endsWith(':up')) return;
    setInput('pad');
    act(a);
  });
  Pad.onConnection((on) => {
    $('#pad-status').classList.toggle('on', on);
    if (on) { setInput('pad'); renderHints(); }
    else if (state.input === 'pad') setInput('keyboard');
  });

  // ---------- clock ----------
  function tickClock() { $('#clock').textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
  tickClock();
  setInterval(tickClock, 10000);

  // ---------- data ----------
  function applyLibrary(lib) {
    const keep = Nav.current && Nav.current.dataset.id;
    state.lib = lib;
    setTab(state.tab);
    if (keep && state.tab === 'library' && lib.games.length) renderLibrary(keep);
  }

  async function rescan() {
    toast('Rescanning your libraries…', null, 1500);
    applyLibrary(await api.rescan());
    toast('Found ' + state.lib.games.length + ' games', null, 2000);
  }

  api.onLibraryChanged(applyLibrary);
  api.onGameStatus((s) => {
    const g = findGame(s.id);
    if (!g) return;
    if (s.state === 'ended' && s.playtimeMin != null) { g.playtimeMin = s.playtimeMin; if (state.tab === 'library') renderLibrary(Nav.current && Nav.current.dataset.id); }
    if (s.state === 'error') toast('Couldn’t start ' + g.title + ': ' + s.error, 'err', 5000);
  });

  // expose a little state for the end-to-end tests
  window.__np = { state, visibleGames };

  api.getLibrary().then((lib) => { applyLibrary(lib); renderHints(); });
})();
