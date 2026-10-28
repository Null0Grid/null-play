'use strict';
/* global Nav, Pad */
(function () {
  const api = window.nullplay;
  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const STORE_ORDER = ['STEAM', 'EPIC', 'GOG', 'AMAZON', 'HEROIC', 'LUTRIS', 'FLATHUB', 'INSTALLED', 'EMULATION'];
  const STORE_NAME = { STEAM: 'Steam', EPIC: 'Epic via Heroic', GOG: 'GOG via Heroic', AMAZON: 'Amazon via Heroic', HEROIC: 'Heroic', LUTRIS: 'Lutris', FLATHUB: 'Flathub', INSTALLED: 'installed app', EMULATION: 'emulator' };
  const LAUNCHER_OF = { steam: 'STEAM', heroic: 'HEROIC', lutris: 'LUTRIS' };
  const SORTS = [['az', 'A–Z'], ['recent', 'RECENT'], ['playtime', 'PLAY TIME']];
  const TABS = ['home', 'library', 'store', 'social'];
  const KINDS = ['cover', 'hero', 'logo'];
  const SOON = {
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
    loaded: false,
    tab: 'home',
    detailId: null,
    detailReturn: null,
    heroId: null,
    filter: 'ALL',
    sort: 'az',
    installedOnly: true,
    input: 'keyboard',
    modalGame: null,
    modalKind: null,
    picker: null, // { id, kind }
  };
  // quick settings panel state (declared early: renderHints reads it)
  const qs = { open: false, view: 'main', status: null, poll: null, timers: {}, lastAdjust: 0, returnFocus: null, scanning: false };

  // ---------- formatting ----------
  function fmtPlaytime(min) {
    if (!min) return '';
    if (min < 60) return min + ' min';
    const h = min / 60;
    return (h < 100 ? h.toFixed(1) : Math.round(h)) + ' h';
  }
  function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); }
  function fmtLast(ts) {
    if (!ts) return '';
    const d = new Date(ts * 1000);
    const days = Math.floor((startOfDay(new Date()) - startOfDay(d)) / 864e5);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 7) return days + ' days ago';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
  }
  function fmtSize(b) {
    if (!b) return '';
    if (b >= 1e12) return (b / 1e12).toFixed(1) + ' TB';
    if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB';
    return Math.max(1, Math.round(b / 1e6)) + ' MB';
  }

  function findGame(id) { return state.lib.games.find((g) => g.id === id); }
  function replaceGame(pub) {
    const i = state.lib.games.findIndex((g) => g.id === pub.id);
    if (i >= 0) state.lib.games[i] = { ...state.lib.games[i], ...pub };
  }

  // ---------- images ----------
  // an <img> that removes itself if the file is gone, calling back so the
  // caller can show its text fallback
  function img(src, cls, onFail) {
    const i = new Image();
    i.alt = '';
    i.decoding = 'async';
    if (cls) i.className = cls;
    i.onerror = () => { i.remove(); if (onFail) onFail(); };
    i.src = src;
    return i;
  }

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
    $('.g-lb2').textContent = g.lb;
    $('.g-rb2').textContent = g.rb;
    const bar = $('#hints');
    bar.textContent = '';
    const add = (k, label, cls) => {
      const h = el('span', 'h');
      h.append(el('span', 'key ' + (cls || k), g[k]), document.createTextNode(label));
      bar.append(h);
    };
    const left = el('span', 'h left');
    bar.append(left);
    if (window.OSK && OSK.isOpen) {
      if (state.input === 'pad') { add('a', 'Type'); add('x', 'Delete'); add('y', 'Space'); add('lb', 'Shift', 'lb'); add('rb', '123', 'rb'); add('menu', 'Done', 'menu'); add('b', 'Cancel'); return; }
      left.textContent = 'Type with your keyboard';
      const k = (cap, label, cls) => { const h = el('span', 'h'); h.append(el('span', 'key ' + (cls || ''), cap), document.createTextNode(label)); bar.append(h); };
      k('Enter', 'Done', 'a'); k('⌫', 'Delete'); k('Esc', 'Cancel', 'b');
      return;
    }
    if (!$('#modal').hidden) { add('a', 'Select'); add('b', 'Back'); return; }
    if (!$('#picker').hidden) { add('a', 'Select'); add('lb', 'Cover / Hero / Logo', 'lb'); add('b', 'Close'); return; }
    if (qs.open) { add('a', 'Select'); const h = el('span', 'h'); h.append(el('span', 'key', '◀ ▶'), document.createTextNode('Adjust')); bar.append(h); add('menu', 'Close', 'menu'); add('b', qs.view === 'main' ? 'Close' : 'Back'); return; }
    if (state.detailId) { add('a', 'Select'); add('b', 'Back'); return; }
    if (state.tab === 'library' && !$('#view-library').hidden) {
      const f = state.lib.games.length ? visibleGames().length + ' of ' + baseGames().length : '';
      left.textContent = f ? 'Filter: ' + state.filter + ' · ' + f : '';
      add('a', 'Play'); add('x', 'Details'); add('y', 'Next filter'); add('lt', 'Page', 'lt');
    } else if (state.tab === 'home' && !$('#view-home').hidden) {
      add('a', 'Play'); add('x', 'Details'); add('lb', 'Tabs', 'lb');
    } else {
      add('a', 'Select');
    }
    add('b', 'Back');
  }

  // ---------- shared tiles ----------
  function coverInto(c, g) {
    const art = g.art || {};
    const src = art.cover || art.header || art.icon;
    c.textContent = '';
    c.classList.remove('has-art');
    if (src) {
      const i = img(src, art.cover ? '' : (art.header ? 'header' : 'icon'), () => c.classList.remove('has-art'));
      if (art.cover) c.classList.add('has-art');
      c.append(i);
    }
    c.append(el('span', 'ttl', g.title));
  }

  function tileFor(g, opts = {}) {
    const t = el('button', 'tile');
    t.dataset.nav = '';
    t.dataset.id = g.id;
    t.setAttribute('role', 'listitem');
    const acNote = g.anticheat && g.anticheat.level !== 'ok' ? ', ' + g.anticheat.label.toLowerCase() : '';
    t.setAttribute('aria-label', g.title + ', ' + (STORE_NAME[g.store] || g.store) + (g.installed ? '' : ', not installed') + acNote);
    const c = el('div', 'cover');
    coverInto(c, g);
    c.append(el('span', 'inst' + (g.installed ? '' : ' off')));
    if (g.favorite) c.append(el('span', 'fav', '★'));
    if (g.anticheat && g.anticheat.level !== 'ok') {
      c.classList.add('flagged');
      c.append(el('span', 'ac' + (g.anticheat.level === 'warn' ? ' warn' : ''), '⚠ ' + g.anticheat.label));
    }
    t.append(c);
    const meta = [g.store];
    if (state.sort === 'recent' && g.lastPlayed && !opts.peek) meta.push(fmtLast(g.lastPlayed));
    else if (g.playtimeMin) meta.push(fmtPlaytime(g.playtimeMin));
    else if (!g.installed) meta.push('not installed');
    t.append(el('span', 'meta', meta.join(' · ')));
    t.addEventListener('click', () => requestLaunch(g.id));
    t.addEventListener('mousemove', () => { if (state.input === 'mouse' && Nav.current !== t) Nav.focus(t, { noScroll: true }); });
    return t;
  }

  function wideFor(g) {
    const t = el('button', 'wide');
    t.dataset.nav = '';
    t.dataset.id = g.id;
    t.setAttribute('role', 'listitem');
    t.setAttribute('aria-label', g.title + ', ' + (STORE_NAME[g.store] || g.store) + (g.lastPlayed ? ', last played ' + fmtLast(g.lastPlayed) : ''));
    const shot = el('div', 'shot');
    const art = g.art || {};
    const src = art.header || art.hero || art.cover || art.icon;
    if (src) {
      const isIcon = !art.header && !art.hero && !art.cover;
      if (!isIcon) shot.classList.add('has-art');
      shot.append(img(src, isIcon ? 'icon' : '', () => shot.classList.remove('has-art')));
    }
    shot.append(el('span', 'ttl', g.title), el('span', 'src', g.store));
    t.append(shot);
    const meta = [];
    if (g.lastPlayed) meta.push(fmtLast(g.lastPlayed));
    if (g.playtimeMin) meta.push(fmtPlaytime(g.playtimeMin));
    t.append(el('span', 'meta', meta.join(' · ') || g.store));
    t.addEventListener('click', () => requestLaunch(g.id));
    t.addEventListener('mousemove', () => { if (state.input === 'mouse' && Nav.current !== t) Nav.focus(t, { noScroll: true }); });
    return t;
  }

  // ---------- home ----------
  function continueList() {
    const played = state.lib.games.filter((g) => g.lastPlayed && !g.hideFromContinue).sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, 10);
    if (played.length) return { label: 'CONTINUE', list: played };
    const inst = state.lib.games.filter((g) => g.installed && !g.hideFromContinue);
    return { label: 'JUMP IN', list: [...inst.filter((g) => g.favorite), ...inst.filter((g) => !g.favorite)].slice(0, 8) };
  }

  function renderHome(keepId) {
    const { label, list } = continueList();
    $('#continue-label').textContent = label;
    const row = $('#continue');
    row.textContent = '';
    for (const g of list) row.append(wideFor(g));
    const peek = $('#peek');
    peek.textContent = '';
    const inst = state.lib.games.filter((g) => g.installed);
    $('#peek-count').textContent = inst.length + ' games';
    for (const g of inst.slice(0, 11)) peek.append(tileFor(g, { peek: true }));
    if (inst.length > 11 || state.lib.games.length > inst.length) {
      const more = el('button', 'tile more');
      more.dataset.nav = '';
      const c = el('div', 'cover');
      c.append(el('span', null, 'SEE ALL\n' + state.lib.games.length));
      c.firstChild.style.whiteSpace = 'pre-line';
      more.append(c, el('span', 'meta', 'LIBRARY'));
      more.addEventListener('click', () => setTab('library'));
      peek.append(more);
    }
    const target = (keepId && document.querySelector('#view-home [data-id="' + CSS.escape(keepId) + '"]')) || row.querySelector('.wide') || peek.querySelector('.tile');
    setHero((target && target.dataset.id) || (list[0] && list[0].id));
    if (target) Nav.focus(target, { instant: true });
    else Nav.focus($('#hero-play'));
  }

  function setHero(id) {
    const g = findGame(id);
    if (!g) return;
    if (state.heroId === id && $('#hero-title').textContent) { refreshHeroFav(g); return; }
    state.heroId = id;
    const art = g.art || {};
    const box = $('.hero-art');
    box.textContent = '';
    const src = art.hero || art.header || art.cover;
    if (src) {
      const i = img(src, art.hero || art.header ? '' : 'cover-fallback');
      i.id = 'hero-img';
      i.onload = () => i.classList.add('loaded');
      box.append(i);
    }
    $('#hero-store').textContent = g.store;
    $('#hero-gm').hidden = !(g.gamemodeHere && g.gamemode && g.installed);
    const ac = $('#hero-ac');
    ac.hidden = !(g.anticheat && g.anticheat.level !== 'ok');
    if (!ac.hidden) { ac.textContent = '⚠ ' + g.anticheat.label; ac.classList.toggle('warn', g.anticheat.level === 'warn'); }
    const title = $('#hero-title');
    title.textContent = g.title.toUpperCase();
    title.classList.toggle('long', g.title.length > 22);
    const logo = $('#hero-logo');
    logo.hidden = true;
    title.hidden = false;
    if (art.logo) {
      logo.onload = () => { if (state.heroId === id) { logo.hidden = false; title.hidden = true; } };
      logo.onerror = () => { logo.hidden = true; title.hidden = false; };
      logo.src = art.logo;
    } else logo.removeAttribute('src');
    const meta = $('#hero-meta');
    meta.textContent = '';
    const bit = (strong, rest) => { const s = el('span'); if (strong) s.append(el('b', null, strong)); if (rest) s.append(document.createTextNode(rest)); meta.append(s); };
    if (g.playtimeMin) bit(fmtPlaytime(g.playtimeMin), ' played');
    if (g.lastPlayed) bit(null, 'last played '), meta.lastChild.append(el('b', null, fmtLast(g.lastPlayed)));
    if (g.sizeBytes) bit(null, fmtSize(g.sizeBytes));
    if (!g.installed) bit('not installed');
    if (!meta.childNodes.length) bit(null, 'never played');
    $('#hero-play').lastChild.textContent = g.installed ? 'PLAY' : 'INSTALL';
    refreshHeroFav(g);
  }
  function refreshHeroFav(g) {
    const b = $('#hero-fav');
    b.classList.toggle('on', !!g.favorite);
    b.setAttribute('aria-label', g.favorite ? 'Remove from favorites' : 'Add to favorites');
  }

  Nav.onFocus((e) => {
    // the hero follows whichever game is focused on Home
    if (!$('#view-home').hidden && e.dataset && e.dataset.id && e.closest('#view-home')) setHero(e.dataset.id);
    // real DOM focus only for text fields (so typing works), off otherwise
    if (e.tagName === 'INPUT') e.focus();
    else if (document.activeElement && document.activeElement.tagName === 'INPUT') document.activeElement.blur();
  });

  $('#hero-play').addEventListener('click', () => state.heroId && requestLaunch(state.heroId));
  $('#hero-details').addEventListener('click', () => state.heroId && openDetail(state.heroId));
  $('#hero-fav').addEventListener('click', () => state.heroId && toggleFavorite(state.heroId));

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
  function renderLibrary(keepId) { renderFilters(); renderGrid(keepId); renderHints(); }
  function setFilter(f) {
    // pressing a chip keeps focus on the chips (check before re-rendering,
    // which replaces the chip and moves focus into the grid)
    const fromPill = !!(Nav.current && Nav.current.dataset && Nav.current.dataset.filter);
    state.filter = f;
    renderFilters(); renderGrid();
    $('#grid-wrap').scrollTop = 0;
    renderHints();
    const pill = $('#filters [data-filter="' + CSS.escape(f) + '"]');
    if (fromPill || !document.querySelector('#grid .tile')) Nav.focus(pill);
  }
  function cycleFilter(step) {
    const list = filterList().map((x) => x[0]);
    const i = list.indexOf(state.filter);
    state.filter = list[(i + step + list.length) % list.length];
    renderFilters(); renderGrid();
    $('#grid-wrap').scrollTop = 0;
    renderHints();
  }

  // ---------- empty state ----------
  function renderEmpty() {
    const box = $('#scan-results');
    box.textContent = '';
    const r = state.lib.report || {};
    const rows = [['STEAM', r.steam], ['HEROIC · EPIC, GOG, AMAZON', r.heroic], ['LUTRIS · EA, UBISOFT, BATTLE.NET…', r.lutris], ['INSTALLED GAMES (.DESKTOP)', r.desktop]];
    for (const [name, res] of rows) {
      const row = el('div', 'src');
      row.append(el('span', 'nm', name));
      const found = res ? res.found : 0;
      row.append(el('span', 'st' + (found ? ' ok' : ''), found ? found + ' found' : 'nothing found'));
      box.append(row);
    }
  }

  // ---------- views + tabs ----------
  function showView(id) { for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== id; }

  function currentGameId() { return Nav.current && Nav.current.dataset && Nav.current.dataset.id; }

  function setTab(tab, keepId) {
    state.tab = tab;
    state.detailId = null;
    for (const b of document.querySelectorAll('.tab')) b.classList.toggle('active', b.dataset.tab === tab);
    if ((tab === 'home' || tab === 'library') && !state.lib.games.length) {
      showView('view-empty'); renderEmpty(); Nav.focus($('#rescan'));
    } else if (tab === 'home') {
      showView('view-home'); renderHome(keepId);
    } else if (tab === 'library') {
      showView('view-library'); renderLibrary(keepId);
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

  // ---------- game page ----------
  function openDetail(id) {
    const g = findGame(id);
    if (!g) return;
    state.detailReturn = state.detailId ? state.detailReturn : (currentGameId() || id);
    state.detailId = id;
    renderDetail(g);
    showView('view-detail');
    Nav.focus($('#d-play'));
    renderHints();
  }

  function renderDetail(g) {
    const art = g.art || {};
    const bg = $('.detail-art');
    bg.textContent = '';
    const hs = art.hero || art.header;
    if (hs) { const i = img(hs, ''); i.id = 'd-hero'; i.onload = () => i.classList.add('loaded'); bg.append(i); }
    coverInto($('#d-cover'), g);
    $('#d-store').textContent = g.store;
    const ac = $('#d-ac');
    const flagged = g.anticheat && g.anticheat.level !== 'ok';
    ac.hidden = !flagged;
    $('#d-acnote').hidden = !flagged;
    if (flagged) {
      ac.textContent = '⚠ ' + g.anticheat.label;
      ac.classList.toggle('warn', g.anticheat.level === 'warn');
      $('#d-acnote').textContent = g.anticheat.detail + (g.anticheat.anticheats.length ? ' (' + g.anticheat.anticheats.join(', ') + ')' : '');
    }
    $('#d-title').textContent = g.title.toUpperCase();
    const stats = $('#d-stats');
    stats.textContent = '';
    const st = (k, v) => { if (!v) return; const s = el('div', 'st'); s.append(el('span', 'k', k), el('span', 'v', v)); stats.append(s); };
    st('PLAY TIME', fmtPlaytime(g.playtimeMin) || 'never played');
    st('LAST PLAYED', g.lastPlayed ? fmtLast(g.lastPlayed) : '—');
    st('SIZE', fmtSize(g.sizeBytes));
    st('SOURCE', STORE_NAME[g.store] || g.store);
    $('#d-play').lastChild.textContent = g.installed ? 'PLAY' : 'INSTALL';
    $('#d-fav').textContent = g.favorite ? '★ FAVORITE' : '☆ FAVORITE';
    $('#d-fav').setAttribute('aria-pressed', String(!!g.favorite));
    const open = $('#d-open');
    open.hidden = !g.canOpenLauncher;
    open.textContent = 'OPEN IN ' + (LAUNCHER_OF[g.source] || '');
    const gm = $('#d-gm');
    gm.setAttribute('aria-checked', String(!!g.gamemode && !!g.gamemodeHere));
    gm.setAttribute('aria-disabled', String(!g.gamemodeHere));
    const note = $('#d-gm-note');
    note.hidden = g.gamemodeHere;
    if (!g.gamemodeHere) note.textContent = 'Turn GameMode on in ' + (g.source === 'heroic' ? 'Heroic' : 'Lutris') + '’s settings for this game; it starts the game itself.';
    $('#d-hide').setAttribute('aria-checked', String(!!g.hideFromContinue));
  }

  function closeDetail() {
    const back = state.detailReturn;
    state.detailId = null;
    state.detailReturn = null;
    setTab(state.tab, back);
  }

  $('#d-play').addEventListener('click', () => state.detailId && requestLaunch(state.detailId));
  $('#d-fav').addEventListener('click', () => state.detailId && toggleFavorite(state.detailId));
  $('#d-open').addEventListener('click', async () => {
    const r = await api.openLauncher(state.detailId);
    toast(r && r.ok ? 'OPENING ' + $('#d-open').textContent.replace('OPEN IN ', '') : 'Couldn’t open the launcher: ' + ((r && r.error) || ''), r && r.ok ? null : 'err');
  });
  $('#d-gm').addEventListener('click', async () => {
    const g = findGame(state.detailId);
    if (!g || !g.gamemodeHere) return;
    const pub = await api.setOptions(g.id, { gamemode: !g.gamemode });
    if (pub) { replaceGame(pub); renderDetail(findGame(g.id)); toast(pub.gamemode ? 'GAMEMODE ON FOR THIS GAME' : 'GAMEMODE OFF FOR THIS GAME', null, 1600); }
  });
  $('#d-hide').addEventListener('click', async () => {
    const g = findGame(state.detailId);
    if (!g) return;
    const pub = await api.setOptions(g.id, { hideFromContinue: !g.hideFromContinue });
    if (pub) { replaceGame(pub); renderDetail(findGame(g.id)); }
  });
  $('#d-art').addEventListener('click', () => state.detailId && openPicker(state.detailId, 'cover'));

  // ---------- art picker ----------
  let pickerReturn = null;
  async function openPicker(id, kind) {
    const g = findGame(id);
    if (!g) return;
    if ($('#picker').hidden) pickerReturn = Nav.current;
    state.picker = { id, kind };
    $('#picker-title').textContent = 'ARTWORK · ' + g.title.toUpperCase();
    for (const t of document.querySelectorAll('.ptab')) t.classList.toggle('active', t.dataset.kind === kind);
    $('#picker').hidden = false;
    renderHints();
    const grid = $('#picker-grid');
    grid.textContent = '';
    grid.className = 'picker-grid' + (kind === 'hero' ? ' wide-grid' : kind === 'logo' ? ' logo-grid' : '');
    $('#picker-reset').hidden = !(g.art && g.art.userSet && g.art.userSet[kind]);
    const status = $('#picker-status');
    const st = await api.art.status();
    $('#picker-key').hidden = st.hasKey;
    if (!st.hasKey) {
      status.textContent = 'Or choose an image file from your computer.';
      Nav.focus($('#key-input'));
      return;
    }
    status.textContent = 'Looking up ' + kind + ' art on SteamGridDB…';
    Nav.focus(document.querySelector('.ptab[data-kind="' + kind + '"]'));
    const r = await api.art.options(id, kind);
    if (!state.picker || state.picker.id !== id || state.picker.kind !== kind) return; // moved on meanwhile
    if (!r.ok) {
      if (r.code === 'NO_KEY' || r.code === 'BAD_KEY') { $('#picker-key').hidden = false; $('#key-msg').textContent = r.error || ''; Nav.focus($('#key-input')); }
      status.textContent = r.code === 'BAD_KEY' ? 'SteamGridDB rejected the saved key.' : 'Couldn’t reach SteamGridDB: ' + (r.error || 'unknown error');
      return;
    }
    if (!r.options.length) { status.textContent = 'SteamGridDB has no ' + kind + ' art for this game. Choose a file instead.'; Nav.focus($('#picker-file')); return; }
    status.textContent = r.options.length + ' options from SteamGridDB';
    for (const o of r.options) {
      const b = el('button', 'opt-img');
      b.dataset.nav = '';
      b.dataset.modal = '';
      b.dataset.index = String(o.index);
      b.setAttribute('aria-label', kind + ' option ' + (o.index + 1) + (o.width ? ', ' + o.width + ' by ' + o.height : ''));
      b.append(img(o.thumb, ''));
      b.addEventListener('click', () => pickOption(id, kind, o.index));
      grid.append(b);
    }
    Nav.focus(grid.querySelector('.opt-img'));
  }

  async function pickOption(id, kind, index) {
    $('#picker-status').textContent = 'Downloading…';
    const r = await api.art.pick(id, kind, index);
    if (!r.ok) { $('#picker-status').textContent = 'Couldn’t set it: ' + (r.error || ''); return; }
    applyGame(r.game);
    $('#picker-reset').hidden = false;
    $('#picker-status').textContent = kind.toUpperCase() + ' ART SET';
    toast(kind.toUpperCase() + ' ART SET', null, 1600);
  }

  function applyGame(pub) {
    replaceGame(pub);
    if (state.detailId === pub.id) renderDetail(findGame(pub.id));
    if (state.heroId === pub.id) { state.heroId = null; setHero(pub.id); }
  }

  function closePicker() {
    $('#picker').hidden = true;
    state.picker = null;
    $('#key-msg').textContent = '';
    if (pickerReturn && pickerReturn.isConnected) Nav.focus(pickerReturn);
    renderHints();
  }

  function stepPickerKind(step) {
    if (!state.picker) return;
    const i = KINDS.indexOf(state.picker.kind);
    openPicker(state.picker.id, KINDS[(i + step + KINDS.length) % KINDS.length]);
  }

  for (const t of document.querySelectorAll('.ptab')) t.addEventListener('click', () => state.picker && openPicker(state.picker.id, t.dataset.kind));
  $('#picker-close').addEventListener('click', closePicker);
  $('#picker-file').addEventListener('click', async () => {
    const p = state.picker;
    if (!p) return;
    const r = await api.art.file(p.id, p.kind);
    if (r.canceled) return;
    if (!r.ok) { $('#picker-status').textContent = r.error || 'Couldn’t use that file.'; return; }
    applyGame(r.game);
    $('#picker-reset').hidden = false;
    $('#picker-status').textContent = p.kind.toUpperCase() + ' ART SET';
    toast(p.kind.toUpperCase() + ' ART SET', null, 1600);
  });
  $('#picker-reset').addEventListener('click', async () => {
    const p = state.picker;
    if (!p) return;
    const r = await api.art.reset(p.id, p.kind);
    if (r.ok) { applyGame(r.game); $('#picker-reset').hidden = true; $('#picker-status').textContent = p.kind.toUpperCase() + ' ART BACK TO DEFAULT'; Nav.focus($('#picker-file')); }
  });
  async function saveKey() {
    const msg = $('#key-msg');
    msg.textContent = 'Checking the key with SteamGridDB…';
    const r = await api.art.setKey($('#key-input').value);
    if (!r.ok) { msg.textContent = r.error; return; }
    $('#key-input').value = '';
    msg.textContent = r.warning || '';
    toast('STEAMGRIDDB KEY SAVED', null, 1800);
    if (state.picker) openPicker(state.picker.id, state.picker.kind);
  }
  $('#key-save').addEventListener('click', saveKey);
  $('#key-input').addEventListener('click', () => {
    const inp = $('#key-input');
    if (state.input !== 'pad') { inp.focus(); return; }
    // with a controller, type on the on-screen keyboard
    OSK.open({ title: 'STEAMGRIDDB API KEY', value: inp.value, maxLength: 64, onDone: (v) => { inp.value = v; Nav.focus(inp); saveKey(); }, onOpen: renderHints });
  });

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
    // the game moves to the front of Continue next time Home is drawn
    if (state.tab === 'home' && !state.detailId && $('#picker').hidden && $('#modal').hidden) renderHome(g.id);
  }

  async function toggleFavorite(id) {
    const g = id && findGame(id);
    if (!g) return;
    g.favorite = !g.favorite;
    await api.setFavorite(g.id, g.favorite);
    toast(g.favorite ? '★ ADDED TO FAVORITES' : 'REMOVED FROM FAVORITES', null, 1600);
    if (state.detailId) renderDetail(g);
    else if (state.tab === 'library') renderLibrary(g.id);
    else if (state.tab === 'home') { refreshHeroFav(g); renderHome(currentGameId() || g.id); }
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
    } else if (kind === 'power') {
      badge.hidden = true;
      $('#modal-title').textContent = g.action === 'suspend' ? 'SLEEP NOW?' : 'POWER OFF?';
      $('#modal-detail').textContent = g.action === 'suspend' ? 'The computer goes to sleep. Press the power button or a key to wake it.' : 'The computer shuts down. Save your game first; running games are closed.';
      $('#modal-ac').textContent = '';
      $('#modal-go').textContent = g.action === 'suspend' ? 'SLEEP' : 'POWER OFF';
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
    if (kind === 'exit') exitToDesktop();
    if (kind === 'power' && g) { closeQS(); api.sys.power(g.action); toast(g.action === 'suspend' ? 'GOING TO SLEEP…' : 'POWERING OFF…', null, 4000); }
  });

  // ---------- exit: CRT collapse ----------
  let exiting = false;
  function exitToDesktop() {
    if (exiting) return;
    exiting = true;
    document.body.classList.add(reduceMotion ? 'calm-exit' : 'crt-off');
    setTimeout(() => api.quit(), reduceMotion ? 240 : 640);
  }

  // ---------- startup animation ----------
  const boot = {
    el: $('#boot'),
    t0: performance.now(),
    done: false,
    sources: new Set(),
    found: 0,
  };
  if (reduceMotion) boot.el.classList.add('calm');
  // the bar shows the real scan, but never runs ahead of the animation's own
  // pace (0.8 s → 1.5 s), so Packet gets to walk even when the scan is instant
  boot.real = 0;
  function bootFrame() {
    if (boot.done) return;
    const elapsed = performance.now() - boot.t0;
    const pace = reduceMotion ? 1 : Math.max(0, Math.min(1, (elapsed - 800) / 700));
    const shown = Math.min(boot.real, pace);
    $('#boot-fill').style.width = (shown * 100).toFixed(1) + '%';
    $('#boot-packet').style.left = Math.round(shown * (320 - 35)) + 'px';
    requestAnimationFrame(bootFrame);
  }
  requestAnimationFrame(bootFrame);
  function bootProgress(d) {
    if (boot.done) return;
    boot.sources.add(d.source);
    boot.found += d.found || 0;
    boot.real = Math.min(1, boot.sources.size / 4);
    boot.el.classList.add('walking');
    const NAMES = { steam: 'steam', heroic: 'heroic', lutris: 'lutris', desktop: 'installed games' };
    $('#boot-text').textContent = 'scanned ' + NAMES[d.source] + ' · ' + boot.found + ' games';
  }
  function finishBoot(how) {
    if (boot.done) return;
    boot.done = true;
    $('#boot-fill').style.width = '100%';
    boot.el.classList.add(how === 'skip' ? 'skip' : 'out');
    document.body.classList.remove('booting');
    setTimeout(() => { boot.el.hidden = true; }, how === 'skip' ? 200 : 420);
  }
  function maybeFinishBoot() {
    const elapsed = performance.now() - boot.t0;
    const min = reduceMotion ? 300 : 1600; // the whole animation, unless skipped
    if (state.loaded && elapsed >= min) finishBoot('out');
    else if (state.loaded) setTimeout(maybeFinishBoot, min - elapsed);
  }
  setTimeout(() => { if (!boot.done) finishBoot('out'); }, 2500); // never longer than this
  function bootSwallows() {
    if (boot.done) return false;
    finishBoot('skip');
    return true;
  }

  // ---------- quick settings ----------

  function qsShow(view, focusSel) {
    qs.view = view;
    $('#qs-main').hidden = view !== 'main';
    $('#qs-wifi-view').hidden = view !== 'wifi';
    $('#qs-pair-view').hidden = view !== 'pair';
    if (focusSel) Nav.focus($(focusSel));
    renderHints();
  }

  async function openQS() {
    if (qs.open) return;
    qs.open = true;
    qs.returnFocus = Nav.current;
    $('#qs').hidden = false;
    $('#qs-clock').textContent = $('#clock').textContent;
    qsShow('main', '#qs-wifi');
    await refreshQS();
    clearInterval(qs.poll);
    qs.poll = setInterval(() => { if (qs.open && qs.view === 'main') refreshQS(); }, 5000);
  }

  function closeQS() {
    if (!qs.open) return;
    qs.open = false;
    clearInterval(qs.poll);
    $('#qs').hidden = true;
    if (qs.returnFocus && qs.returnFocus.isConnected) Nav.focus(qs.returnFocus);
    renderHints();
  }

  async function refreshQS() {
    const s = await api.sys.status();
    if (!qs.open) return;
    qs.status = s;
    renderQSWifi(s.wifi);
    // don't fight the user while they're dragging a slider
    if (Date.now() - qs.lastAdjust > 1500) { renderQSVol(s.volume); renderQSBri(s.brightness); }
    renderQSPads(s.controllers);
  }

  function renderQSWifi(w) {
    const st = $('#qs-wifi-state');
    st.classList.remove('ok');
    let txt;
    if (!w || !w.available) txt = (w && w.reason) || 'unavailable';
    else if (!w.enabled) txt = 'off';
    else if (w.connected) { txt = w.ssid + (w.signal != null ? ' · ' + w.signal + '%' : ''); st.classList.add('ok'); }
    else txt = 'not connected';
    st.textContent = txt;
    $('#qs-wifi-ico').classList.toggle('off', !(w && w.connected));
  }

  function setSlider(id, level, { disabled, muted, label } = {}) {
    const b = $('#' + id);
    b.setAttribute('aria-disabled', String(!!disabled));
    b.classList.toggle('muted', !!muted);
    b.setAttribute('aria-valuenow', String(level || 0));
    $('#' + id + '-fill').style.width = (disabled ? 0 : level) + '%';
    $('#' + id + '-val').textContent = disabled ? '–' : muted ? 'MUTED' : level + '%';
    if (label != null) b.setAttribute('aria-valuetext', label);
  }
  function renderQSVol(v) {
    const ok = v && v.available;
    qs.vol = ok ? v.level : 0;
    qs.muted = ok && v.muted;
    setSlider('qs-vol', qs.vol, { disabled: !ok, muted: qs.muted });
    $('#qs-vol-out').textContent = ok ? (v.output || '') : 'no audio output found';
  }
  function renderQSBri(b) {
    const ok = b && b.available;
    qs.bri = ok ? b.level : 0;
    setSlider('qs-bri', qs.bri, { disabled: !ok });
    $('#qs-bri-via').textContent = ok ? (b.via === 'ddcutil' ? 'monitor' : 'screen') : (b && b.reason) || 'unavailable';
  }

  function renderQSPads(c) {
    const box = $('#qs-pads');
    const keep = Nav.current && Nav.current.dataset && Nav.current.dataset.mac;
    box.textContent = '';
    $('#qs-bt-state').textContent = !c || !c.available ? ((c && c.reason) || 'unavailable') : c.powered ? 'Bluetooth on' : 'Bluetooth off';
    $('#qs-pair').hidden = !(c && c.available);
    if (c && c.available) {
      if (!c.devices.length) box.append(el('div', 'qs-hint vt', 'No controllers paired yet.'));
      for (const d of c.devices) {
        const b = el('button', 'qs-pad' + (d.connected ? ' on' : ''));
        b.dataset.nav = '';
        b.dataset.qs = '';
        b.dataset.mac = d.mac;
        b.append(el('span', 'dot'), el('span', 'nm', d.name), el('span', 'st', d.connected ? 'connected' + (d.battery != null ? ' · ' + d.battery + '%' : '') : 'off'));
        b.setAttribute('aria-label', d.name + (d.connected ? ', connected' : ', not connected') + (d.battery != null ? ', battery ' + d.battery + ' percent' : ''));
        b.addEventListener('click', () => padToggle(d));
        box.append(b);
      }
    }
    if (keep) { const k = box.querySelector('[data-mac="' + CSS.escape(keep) + '"]'); if (k) Nav.focus(k, { noScroll: true }); }
  }

  async function padToggle(d) {
    toast((d.connected ? 'Disconnecting ' : 'Connecting ') + d.name + '…', null, 2500);
    const r = await api.sys.btConnect(d.mac, !d.connected);
    toast(r.ok ? (d.connected ? d.name + ' disconnected' : d.name + ' connected') : r.error, r.ok ? null : 'err');
    refreshQS();
  }

  function adjust(kind, delta) {
    qs.lastAdjust = Date.now();
    if (kind === 'volume') {
      if (!qs.status || !qs.status.volume || !qs.status.volume.available) return;
      qs.vol = Math.max(0, Math.min(100, (qs.vol || 0) + delta));
      qs.muted = qs.muted && qs.vol === 0;
      setSlider('qs-vol', qs.vol, { muted: qs.muted });
      clearTimeout(qs.timers.vol);
      qs.timers.vol = setTimeout(async () => { const v = await api.sys.setVolume(qs.vol); qs.status.volume = v; }, 120);
    } else {
      if (!qs.status || !qs.status.brightness || !qs.status.brightness.available) return;
      qs.bri = Math.max(1, Math.min(100, (qs.bri || 0) + delta));
      setSlider('qs-bri', qs.bri, {});
      clearTimeout(qs.timers.bri);
      qs.timers.bri = setTimeout(async () => { const b = await api.sys.setBrightness(qs.bri); if (b && b.error) toast(b.error, 'err'); }, qs.status.brightness.via === 'ddcutil' ? 350 : 120);
    }
  }

  $('#qs-btn').addEventListener('click', () => openQS());
  $('#qs-backdrop').addEventListener('click', () => closeQS());
  $('#qs-vol').addEventListener('click', async () => {
    if (!qs.status || !qs.status.volume || !qs.status.volume.available) return;
    const v = await api.sys.toggleMute();
    qs.status.volume = v;
    renderQSVol(v);
  });
  $('#qs-bri').addEventListener('click', () => {});
  $('#qs-exit').addEventListener('click', () => openModal('exit'));
  $('#qs-sleep').addEventListener('click', () => openModal('power', { action: 'suspend' }));
  $('#qs-off').addEventListener('click', () => openModal('power', { action: 'poweroff' }));

  // Wi-Fi networks
  function wifiMsg(text, kind) { const m = $('#qs-wifi-msg'); m.textContent = text || ''; m.className = 'qs-msg vt' + (kind ? ' ' + kind : ''); }
  async function openWifi() {
    qsShow('wifi', '#qs-wifi-back');
    const w = qs.status && qs.status.wifi;
    const radio = $('#qs-wifi-radio');
    radio.setAttribute('aria-checked', String(!!(w && w.enabled)));
    radio.textContent = w && w.enabled ? 'ON' : 'OFF';
    $('#qs-nets').textContent = '';
    if (!w || !w.available) { wifiMsg((w && w.reason) || 'Wi-Fi isn’t available on this computer.', 'err'); return; }
    if (!w.enabled) { wifiMsg('Wi-Fi is off.'); return; }
    await loadNets();
  }
  async function loadNets() {
    wifiMsg('Scanning for networks…');
    const r = await api.sys.wifiList();
    if (!qs.open || qs.view !== 'wifi') return;
    const box = $('#qs-nets');
    box.textContent = '';
    if (!r.available) { wifiMsg('Couldn’t scan for networks.', 'err'); return; }
    wifiMsg(r.networks.length ? r.networks.length + ' networks' : 'No networks found.');
    for (const n of r.networks) {
      const b = el('button', 'qs-net' + (n.inUse ? ' cur' : ''));
      b.dataset.nav = '';
      b.dataset.qs = '';
      b.dataset.ssid = n.ssid;
      const sig = el('span', 'sig');
      const bars = n.signal >= 75 ? 4 : n.signal >= 50 ? 3 : n.signal >= 25 ? 2 : 1;
      for (let i = 0; i < 4; i++) sig.append(el('i', i < bars ? 'on' : ''));
      b.append(sig, el('span', 'nm', n.ssid), el('span', 'meta', (n.inUse ? 'connected · ' : '') + n.band + (n.secure ? ' · secured' : ' · open')));
      b.setAttribute('aria-label', n.ssid + ', signal ' + n.signal + ' percent, ' + (n.secure ? 'secured' : 'open') + (n.inUse ? ', connected' : ''));
      b.addEventListener('click', () => connectNet(n));
      box.append(b);
    }
    const first = box.querySelector('.qs-net');
    if (first && Nav.current && Nav.current.id === 'qs-wifi-back') Nav.focus(first);
  }
  async function connectNet(n, password) {
    if (n.inUse && password == null) { wifiMsg('Already connected to ' + n.ssid + '.', 'ok'); return; }
    wifiMsg('Connecting to ' + n.ssid + '…');
    const r = await api.sys.wifiConnect(n.ssid, password == null ? null : password);
    if (r.ok) {
      wifiMsg('Connected to ' + n.ssid + '.', 'ok');
      toast('CONNECTED TO ' + n.ssid.toUpperCase(), null, 2000);
      const s = await api.sys.status();
      qs.status = s;
      renderQSWifi(s.wifi);
      if (qs.view === 'wifi') loadNets().then(() => { const b = $('#qs-nets [data-ssid="' + CSS.escape(n.ssid) + '"]'); if (b) Nav.focus(b); });
      return;
    }
    if (r.needsPassword) {
      wifiMsg(r.error, password != null ? 'err' : null);
      OSK.open({
        title: 'PASSWORD FOR ' + n.ssid.toUpperCase(),
        secret: true,
        maxLength: 63,
        error: password != null ? 'Wrong password, try again' : '',
        onDone: (pw) => { renderHints(); connectNet(n, pw); },
        onCancel: () => { wifiMsg(''); renderHints(); },
        onOpen: renderHints,
      });
      return;
    }
    wifiMsg(r.error || 'Couldn’t connect.', 'err');
  }
  $('#qs-wifi').addEventListener('click', () => openWifi());
  $('#qs-wifi-back').addEventListener('click', () => { qsShow('main', '#qs-wifi'); refreshQS(); });
  $('#qs-wifi-radio').addEventListener('click', async () => {
    const on = $('#qs-wifi-radio').getAttribute('aria-checked') !== 'true';
    wifiMsg(on ? 'Turning Wi-Fi on…' : 'Turning Wi-Fi off…');
    await api.sys.wifiRadio(on);
    qs.status = await api.sys.status();
    renderQSWifi(qs.status.wifi);
    await openWifi();
    Nav.focus($('#qs-wifi-radio'));
  });

  // controller pairing
  function pairMsg(text, kind) { const m = $('#qs-pair-msg'); m.textContent = text || ''; m.className = 'qs-msg vt' + (kind ? ' ' + kind : ''); }
  async function scanPads() {
    if (qs.scanning) return;
    qs.scanning = true;
    $('#qs-found').textContent = '';
    pairMsg('Looking for controllers in pairing mode…');
    const r = await api.sys.btScan();
    qs.scanning = false;
    if (!qs.open || qs.view !== 'pair') return;
    const box = $('#qs-found');
    if (!r.found.length) { pairMsg('No new controllers found. Check it’s in pairing mode (fast-blinking light), then scan again.'); Nav.focus($('#qs-rescan')); return; }
    pairMsg('Found ' + r.found.length + (r.found.length === 1 ? ' controller' : ' controllers') + '. Pick one to pair.', 'ok');
    for (const d of r.found) {
      const b = el('button', 'qs-net');
      b.dataset.nav = '';
      b.dataset.qs = '';
      b.dataset.mac = d.mac;
      b.append(el('span', 'nm', d.name), el('span', 'meta', 'PAIR'));
      b.addEventListener('click', () => pairPad(d));
      box.append(b);
    }
    Nav.focus(box.querySelector('.qs-net'));
  }
  async function pairPad(d) {
    pairMsg('Pairing ' + d.name + '…');
    const r = await api.sys.btPair(d.mac);
    if (!r.ok) { pairMsg(r.error, 'err'); return; }
    pairMsg(d.name + ' paired' + (r.connected ? ' and connected.' : '. Turn it on to connect.'), 'ok');
    toast(d.name.toUpperCase() + ' PAIRED', null, 2000);
    setTimeout(async () => { if (qs.open && qs.view === 'pair') { qsShow('main', '#qs-pair'); await refreshQS(); } }, 1200);
  }
  $('#qs-pair').addEventListener('click', () => { qsShow('pair', '#qs-pair-back'); scanPads(); });
  $('#qs-rescan').addEventListener('click', () => scanPads());
  $('#qs-pair-back').addEventListener('click', () => { qsShow('main', '#qs-pair'); refreshQS(); });

  function qsAct(a) {
    switch (a) {
      case 'left': case 'right':
        if (Nav.current && Nav.current.dataset.slider) { adjust(Nav.current.dataset.slider, a === 'right' ? 5 : -5); return; }
        Nav.move(a);
        return;
      case 'up': case 'down': Nav.move(a); return;
      case 'a': Nav.activate(); return;
      case 'b':
        if (qs.view === 'wifi') { qsShow('main', '#qs-wifi'); refreshQS(); }
        else if (qs.view === 'pair') { qsShow('main', '#qs-pair'); refreshQS(); }
        else closeQS();
        return;
      case 'menu': closeQS(); return;
      case 'exit': openModal('exit'); return;
      default: return;
    }
  }

  // ---------- actions (shared by controller, keyboard, mouse) ----------
  function act(a) {
    if (exiting) return;
    if (bootSwallows()) return;
    if (OSK.isOpen) { OSK.action(a); if (!OSK.isOpen) renderHints(); return; }
    if (qs.open && $('#modal').hidden) { qsAct(a); return; }
    const picker = !$('#picker').hidden;
    const modal = !$('#modal').hidden || picker;
    switch (a) {
      case 'up': case 'down': case 'left': case 'right': Nav.move(a); break;
      case 'a': Nav.activate(); break;
      case 'b':
        if (picker) closePicker();
        else if (!$('#modal').hidden) closeModal();
        else if (state.detailId) closeDetail();
        else if (Nav.current && Nav.current.closest('.grid')) Nav.focus($('#filters .pill.active') || $('#filters .pill'));
        else if (state.tab !== 'home' && state.tab !== 'library') setTab('home');
        break;
      case 'x': {
        if (modal || state.detailId) break;
        const id = currentGameId() || (Nav.current && Nav.current.closest('.hero') ? state.heroId : null);
        if (id) openDetail(id);
        break;
      }
      case 'y': if (!modal && !state.detailId && state.tab === 'library' && state.lib.games.length) cycleFilter(1); break;
      case 'lb': if (picker) stepPickerKind(-1); else if (!modal && !state.detailId) stepTab(-1); break;
      case 'rb': if (picker) stepPickerKind(1); else if (!modal && !state.detailId) stepTab(1); break;
      case 'lt': case 'rt':
        if (!modal && Nav.current && Nav.current.closest('.grid')) {
          const cols = getComputedStyle(document.documentElement).getPropertyValue('--cols').trim() | 0 || 8;
          const tiles = [...document.querySelectorAll('#grid .tile')];
          const i = tiles.indexOf(Nav.current);
          const j = Math.max(0, Math.min(tiles.length - 1, i + (a === 'rt' ? 1 : -1) * cols * 2));
          Nav.focus(tiles[j]);
        }
        break;
      case 'menu': if (!modal) openQS(); break;
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
    if (OSK.isOpen) { e.preventDefault(); if (!bootSwallows()) { OSK.key(e); if (!OSK.isOpen) renderHints(); } return; }
    // typing in a text field: only Enter, Esc and up/down leave it
    if (e.target && e.target.tagName === 'INPUT') {
      if (bootSwallows()) { e.preventDefault(); return; }
      if (e.key === 'Enter') { e.preventDefault(); if (e.target.id === 'key-input') saveKey(); return; }
      if (e.key === 'Escape') { e.preventDefault(); act('b'); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); act(e.key === 'ArrowDown' ? 'down' : 'up'); return; }
      return;
    }
    if (e.ctrlKey && (e.key === 'q' || e.key === 'Q')) { e.preventDefault(); act('exit'); return; }
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === 'Tab') { e.preventDefault(); act(e.shiftKey ? 'lb' : 'rb'); return; }
    // page shortcuts only when nothing is open on top
    const overlay = qs.open || !$('#modal').hidden || !$('#picker').hidden;
    if ((e.key === 'F' || e.key === 'f') && e.shiftKey) { e.preventDefault(); if (!overlay && !bootSwallows() && state.tab === 'library' && state.lib.games.length && !state.detailId) cycleFilter(-1); return; }
    if (e.key === 'r' || e.key === 'F5') { e.preventDefault(); if (!overlay && !bootSwallows()) rescan(); return; }
    const k = KEYS[e.key] || KEYS[e.key.toLowerCase()];
    if (!k) { bootSwallows(); return; }
    e.preventDefault();
    act(k);
  });
  // mouse: the pointer shows and hover moves focus; clicks are native
  document.addEventListener('mousemove', (e) => { if (e.movementX || e.movementY) setInput('mouse'); });
  document.addEventListener('mousedown', (e) => { if (!boot.done) { e.preventDefault(); bootSwallows(); } }, true);
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
  function tickClock() { const t = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); $('#clock').textContent = t; $('#qs-clock').textContent = t; }
  tickClock();
  setInterval(tickClock, 10000);

  // ---------- data ----------
  function applyLibrary(lib) {
    // repaint underneath an open overlay without taking its focus away
    const overlayFocus = (qs.open || !$('#modal').hidden || OSK.isOpen) ? Nav.current : null;
    applyLibraryInner(lib);
    if (overlayFocus && overlayFocus.isConnected) Nav.focus(overlayFocus, { noScroll: true });
  }
  function applyLibraryInner(lib) {
    const keep = currentGameId() || state.heroId;
    state.lib = lib;
    state.heroId = null;
    if (state.detailId) {
      const g = findGame(state.detailId);
      if (g) { renderDetail(g); return; }
      state.detailId = null;
    }
    if (!$('#picker').hidden) return; // don't pull the page out from under the picker
    setTab(state.tab, keep);
  }

  async function rescan() {
    toast('Rescanning your libraries…', null, 1500);
    applyLibrary(await api.rescan());
    toast('Found ' + state.lib.games.length + ' games', null, 2000);
  }

  api.onLibraryChanged(applyLibrary);
  api.onScanProgress(bootProgress);
  api.onGameStatus((s) => {
    const g = findGame(s.id);
    if (!g) return;
    if (s.state === 'ended' && s.playtimeMin != null) g.playtimeMin = s.playtimeMin;
    if (s.state === 'error') toast('Couldn’t start ' + g.title + ': ' + s.error, 'err', 5000);
  });

  // expose a little state for the end-to-end tests
  window.__np = { state, visibleGames, continueList, boot, qs };

  api.getLibrary().then((lib) => {
    state.loaded = true;
    applyLibrary(lib);
    renderHints();
    maybeFinishBoot();
  });
})();
