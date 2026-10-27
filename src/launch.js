'use strict';
// Starts games. URL launches hand off to the owning launcher (Steam, Heroic,
// Lutris); .desktop games run directly under Feral GameMode's gamemoderun.
// For Steam games, which Steam itself spawns, the game process is found by
// its SteamAppId and registered with GameMode over D-Bus. Heroic and Lutris
// have their own per-game GameMode switch, so they're left to it.
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');

function which(cmd, env) {
  for (const d of String(env.PATH || '').split(':')) {
    if (!d) continue;
    const p = path.join(d, cmd);
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch {}
  }
  return null;
}

// the argv that will actually run, as a plain list (no shell anywhere)
function buildCommand(game, { env, gamemode = true } = {}) {
  const l = game.launch || {};
  if (l.kind === 'url') {
    if (!/^(steam:\/\/rungameid\/\d+|heroic:\/\/launch\/[a-z]+\/[^\s]+|lutris:rungameid\/\d+)$/.test(l.url)) throw new Error('refusing unexpected launch URL');
    if (which('xdg-open', env)) return { argv: ['xdg-open', l.url], gamemode: false };
    if (l.flatpakApp) return { argv: ['flatpak', 'run', l.flatpakApp, l.url], gamemode: false };
    throw new Error('no way to open ' + l.url);
  }
  if (l.kind === 'launcher') {
    if (l.flatpakApp) return { argv: ['flatpak', 'run', l.flatpakApp], gamemode: false };
    return { argv: [l.app], gamemode: false };
  }
  if (l.kind === 'exec') {
    const argv = [...l.argv];
    const gm = gamemode && which('gamemoderun', env);
    return { argv: gm ? ['gamemoderun', ...argv] : argv, cwd: l.cwd || undefined, gamemode: !!gm };
  }
  throw new Error('unknown launch kind');
}

function launch(game, { env, gamemode = true, onExit } = {}) {
  const cmd = buildCommand(game, { env, gamemode });
  const child = spawn(cmd.argv[0], cmd.argv.slice(1), {
    cwd: cmd.cwd && fs.existsSync(cmd.cwd) ? cmd.cwd : undefined,
    env,
    detached: true,
    stdio: 'ignore',
  });
  const started = Date.now();
  child.on('error', (e) => onExit && onExit({ error: e.message, ms: Date.now() - started, tracked: false }));
  // only a directly-run game's lifetime is its play time; xdg-open and the
  // launcher hand-offs return straight away
  child.on('exit', (code) => onExit && onExit({ code, ms: Date.now() - started, tracked: game.launch.kind === 'exec' }));
  child.unref();
  if (gamemode && game.source === 'steam' && game.ids && game.ids.steam) watchSteamGame(game.ids.steam, env);
  return { pid: child.pid, argv: cmd.argv, gamemode: cmd.gamemode };
}

// Look for the Steam game's process for up to 3 minutes (first launches can
// sit in "preparing" a while), then hand its PID to gamemoded.
function findPidByEnv(key, value) {
  let pids = [];
  try { pids = fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d)); } catch { return null; }
  const needle = key + '=' + value;
  for (const pid of pids) {
    try {
      const env = fs.readFileSync('/proc/' + pid + '/environ', 'latin1').split('\0');
      if (env.includes(needle)) {
        const comm = fs.readFileSync('/proc/' + pid + '/comm', 'utf8').trim();
        // skip Steam's own reaper / launch wrappers
        if (!/^(reaper|steam|steam-runtime|pressure-vessel|srt-bwrap|pv-adverb|bwrap)/.test(comm)) return Number(pid);
      }
    } catch {}
  }
  return null;
}

function registerGameMode(gamePid, env) {
  return new Promise((resolve) => {
    execFile('gdbus', ['call', '--session', '--dest', 'com.feralinteractive.GameMode',
      '--object-path', '/com/feralinteractive/GameMode',
      '--method', 'com.feralinteractive.GameMode.RegisterGameByPID', String(process.pid), String(gamePid)],
    { env, timeout: 4000 }, (err) => resolve(!err));
  });
}

function watchSteamGame(appid, env) {
  if (!which('gdbus', env)) return;
  const t0 = Date.now();
  const tick = async () => {
    const pid = findPidByEnv('SteamAppId', appid);
    if (pid) { await registerGameMode(pid, env); return; }
    if (Date.now() - t0 < 180000) setTimeout(tick, 2000);
  };
  setTimeout(tick, 2000);
}

// "OPEN IN STEAM / HEROIC / LUTRIS" on the game page
function launcherCommand(game, env) {
  const l = game.launch || {};
  if (game.source === 'steam' && game.ids && /^\d+$/.test(String(game.ids.steam))) {
    const url = 'steam://nav/games/details/' + game.ids.steam;
    if (which('xdg-open', env)) return ['xdg-open', url];
    return l.flatpakApp ? ['flatpak', 'run', l.flatpakApp, url] : ['steam', url];
  }
  if (game.source === 'heroic') return l.flatpakApp ? ['flatpak', 'run', l.flatpakApp] : ['heroic'];
  if (game.source === 'lutris') return l.flatpakApp ? ['flatpak', 'run', l.flatpakApp] : ['lutris'];
  return null;
}

function openLauncher(game, env) {
  const argv = launcherCommand(game, env);
  if (!argv) throw new Error('this game has no launcher to open');
  const child = spawn(argv[0], argv.slice(1), { env, detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
  return argv;
}

module.exports = { launch, buildCommand, which, findPidByEnv, launcherCommand, openLauncher };
