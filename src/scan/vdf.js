'use strict';
// Minimal parser for Valve's text KeyValues format (.vdf / .acf).
// Keys are case-insensitive in Steam's own files, so every key is lower-cased.
// Handles quoted and bare tokens, nested blocks, // comments and \" escapes.

function tokenize(text) {
  const out = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { i++; continue; }
    if (c === '/' && text[i + 1] === '/') { while (i < n && text[i] !== '\n') i++; continue; }
    if (c === '{' || c === '}') { out.push(c); i++; continue; }
    if (c === '"') {
      let s = '';
      i++;
      while (i < n && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < n) {
          const e = text[i + 1];
          s += e === 'n' ? '\n' : e === 't' ? '\t' : e;
          i += 2;
        } else s += text[i++];
      }
      i++;
      out.push({ s });
      continue;
    }
    let s = '';
    while (i < n && !/[\s{}"]/.test(text[i])) s += text[i++];
    out.push({ s });
  }
  return out;
}

function parse(text) {
  const toks = tokenize(String(text || ''));
  let p = 0;
  function block() {
    const obj = {};
    while (p < toks.length) {
      const t = toks[p++];
      if (t === '}') return obj;
      if (t === '{') continue; // stray brace
      const key = t.s.toLowerCase();
      const v = toks[p];
      if (v === '{') { p++; obj[key] = block(); }
      else if (v && v !== '}') { p++; obj[key] = v.s; }
      // conditional suffix like [$WIN32]: skip
      if (toks[p] && toks[p] !== '{' && toks[p] !== '}' && /^\[\$/.test(toks[p].s)) p++;
    }
    return obj;
  }
  return block();
}

module.exports = { parse };
