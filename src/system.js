'use strict';
// Quick settings: thin, validated wrappers around the system's own tools.
//   Wi-Fi        nmcli (NetworkManager)
//   Volume       wpctl (PipeWire / WirePlumber)
//   Brightness   /sys/class/backlight + logind's SetBrightness (laptops, no
//                root needed), else ddcutil (external monitors over DDC/CI)
//   Controllers  bluetoothctl (BlueZ)
//   Power        systemctl suspend / poweroff (allowed for the active session)
// Every call has a timeout, nothing goes through a shell, and anything the
// renderer sends is checked first. A missing tool reports "unavailable"
// instead of throwing.
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

function run(cmd, args, { env, timeout = 8000, input } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = execFile(cmd, args, { env, timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
        resolve({ ok: !err, code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, missing: !!(err && err.code === 'ENOENT'), out: String(stdout || ''), err: String(stderr || '') });
      });
    } catch (e) { resolve({ ok: false, code: -1, missing: true, out: '', err: e.message }); return; }
    if (input != null && child.stdin) { child.stdin.end(input); }
  });
}

// nmcli -t output: fields split on ':' with '\:' and '\\' escaped
function splitTerse(line) {
  const out = [];
  let cur = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '\\' && i + 1 < line.length) { cur += line[++i]; continue; }
    if (c === ':') { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

const SSID_OK = (s) => typeof s === 'string' && s.length > 0 && Buffer.byteLength(s) <= 32 && !/[\0\n\r]/.test(s);
const PSK_OK = (p) => typeof p === 'string' && p.length <= 63 && !/[\0\n\r]/.test(p);
const MAC_OK = (m) => typeof m === 'string' && /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i.test(m);
const GAMEPAD_NAME = /xbox|dualsense|dualshock|wireless controller|pro controller|8bitdo|gamepad|joy-?con|stadia|steam controller|controller/i;

class System {
  constructor({ env, backlightDir = '/sys/class/backlight' } = {}) {
    this.env = env || process.env;
    this.backlightDir = backlightDir;
    this.ddcCache = null;
  }
  r(cmd, args, opts = {}) { return run(cmd, args, { env: this.env, ...opts }); }

  // ---------- Wi-Fi ----------
  async wifiStatus() {
    const radio = await this.r('nmcli', ['-t', 'radio', 'wifi']);
    if (radio.missing) return { available: false };
    const dev = await this.r('nmcli', ['-t', '-f', 'DEVICE,TYPE,STATE,CONNECTION', 'device']);
    const wifi = dev.out.split('\n').filter(Boolean).map(splitTerse).find((f) => f[1] === 'wifi');
    if (!wifi) return { available: false, reason: 'no Wi-Fi adapter' };
    const enabled = /enabled/.test(radio.out);
    const connected = /^connected/.test(wifi[2]);
    let signal = null;
    if (connected) {
      const list = await this.wifiList({ rescan: false });
      const cur = list.networks.find((n) => n.inUse);
      signal = cur ? cur.signal : null;
    }
    return { available: true, enabled, device: wifi[0], state: wifi[2], connected, ssid: connected ? wifi[3] : null, signal };
  }

  async wifiList({ rescan = true } = {}) {
    const res = await this.r('nmcli', ['-t', '-f', 'IN-USE,SSID,SIGNAL,SECURITY,FREQ', 'device', 'wifi', 'list', '--rescan', rescan ? 'yes' : 'no'], { timeout: 20000 });
    if (res.missing) return { available: false, networks: [] };
    const best = new Map();
    for (const line of res.out.split('\n')) {
      if (!line.trim()) continue;
      const [inUse, ssid, signal, security, freq] = splitTerse(line);
      if (!ssid) continue; // hidden networks
      const n = { ssid, inUse: inUse === '*', signal: parseInt(signal, 10) || 0, secure: !!security && security !== '--', security: security === '--' ? '' : security, band: /^5|^6/.test(freq || '') ? (/^6/.test(freq) ? '6 GHz' : '5 GHz') : '2.4 GHz' };
      const prev = best.get(ssid);
      if (!prev || (n.inUse && !prev.inUse) || (n.inUse === prev.inUse && n.signal > prev.signal)) best.set(ssid, n);
    }
    const networks = [...best.values()].sort((a, b) => (b.inUse - a.inUse) || (b.signal - a.signal));
    return { available: true, networks };
  }

  async wifiKnown() {
    const res = await this.r('nmcli', ['-t', '-f', 'NAME,TYPE', 'connection', 'show']);
    return new Set(res.out.split('\n').map(splitTerse).filter((f) => /wireless/.test(f[1] || '')).map((f) => f[0]));
  }

  async wifiRadio(on) {
    const res = await this.r('nmcli', ['radio', 'wifi', on ? 'on' : 'off']);
    return { ok: res.ok, error: res.ok ? null : (res.err.trim() || 'nmcli failed') };
  }

  // the password goes to nmcli on stdin (--ask), never on the command line
  async wifiConnect(ssid, password) {
    if (!SSID_OK(ssid)) return { ok: false, error: 'bad network name' };
    if (password != null && !PSK_OK(password)) return { ok: false, error: 'bad password' };
    const known = await this.wifiKnown();
    let res;
    if (known.has(ssid) && password == null) res = await this.r('nmcli', ['connection', 'up', 'id', ssid], { timeout: 45000 });
    else res = await this.r('nmcli', ['--ask', 'device', 'wifi', 'connect', ssid], { timeout: 45000, input: password != null ? password + '\n' : '\n' });
    if (res.ok) return { ok: true };
    const msg = (res.err || res.out).trim();
    const needsPassword = /secrets were required|password|802-11-wireless-security|no secrets/i.test(msg);
    return { ok: false, needsPassword, error: needsPassword ? (password ? 'Wrong password' : 'This network needs a password') : (msg.split('\n').pop() || 'Couldn’t connect') };
  }

  // ---------- volume ----------
  async volume() {
    const res = await this.r('wpctl', ['get-volume', '@DEFAULT_AUDIO_SINK@']);
    if (res.missing || !res.ok) return { available: false };
    const m = res.out.match(/Volume:\s*([\d.]+)/);
    let name = null;
    const ins = await this.r('wpctl', ['inspect', '@DEFAULT_AUDIO_SINK@']);
    const n = ins.out.match(/node\.description\s*=\s*"([^"]*)"/) || ins.out.match(/node\.nick\s*=\s*"([^"]*)"/);
    if (n) name = n[1];
    return { available: true, level: m ? Math.round(parseFloat(m[1]) * 100) : 0, muted: /MUTED/.test(res.out), output: name };
  }
  async setVolume(level) {
    const v = Math.max(0, Math.min(100, Math.round(Number(level) || 0)));
    const res = await this.r('wpctl', ['set-volume', '-l', '1.0', '@DEFAULT_AUDIO_SINK@', (v / 100).toFixed(2)]);
    if (res.ok && v > 0) await this.r('wpctl', ['set-mute', '@DEFAULT_AUDIO_SINK@', '0']);
    return res.ok ? this.volume() : { available: false, error: res.err.trim() };
  }
  async toggleMute() {
    const res = await this.r('wpctl', ['set-mute', '@DEFAULT_AUDIO_SINK@', 'toggle']);
    return res.ok ? this.volume() : { available: false };
  }

  // ---------- brightness ----------
  backlight() {
    let names = [];
    try { names = fs.readdirSync(this.backlightDir); } catch { return null; }
    // prefer the firmware / platform interface over raw
    const rank = (n) => { try { const t = fs.readFileSync(path.join(this.backlightDir, n, 'type'), 'utf8').trim(); return { firmware: 0, platform: 1, raw: 2 }[t] ?? 3; } catch { return 3; } };
    names.sort((a, b) => rank(a) - rank(b));
    for (const n of names) {
      try {
        const max = parseInt(fs.readFileSync(path.join(this.backlightDir, n, 'max_brightness'), 'utf8'), 10);
        const cur = parseInt(fs.readFileSync(path.join(this.backlightDir, n, 'brightness'), 'utf8'), 10);
        if (max > 0) return { name: n, max, cur };
      } catch {}
    }
    return null;
  }

  async brightness() {
    const bl = this.backlight();
    if (bl) return { available: true, via: 'backlight', level: Math.round((bl.cur / bl.max) * 100) };
    const ddc = await this.r('ddcutil', ['getvcp', '10', '--brief'], { timeout: 6000 });
    if (ddc.ok) {
      const m = ddc.out.match(/VCP\s+10\s+C\s+(\d+)\s+(\d+)/);
      if (m) return { available: true, via: 'ddcutil', level: Math.round((parseInt(m[1], 10) / (parseInt(m[2], 10) || 100)) * 100) };
    }
    return { available: false, reason: ddc.missing ? 'no backlight and no ddcutil' : 'monitor doesn’t support DDC/CI brightness' };
  }

  async setBrightness(level) {
    const v = Math.max(1, Math.min(100, Math.round(Number(level) || 0))); // never fully black
    const bl = this.backlight();
    if (bl) {
      const raw = Math.max(1, Math.round((v / 100) * bl.max));
      const res = await this.r('busctl', ['call', 'org.freedesktop.login1', '/org/freedesktop/login1/session/auto', 'org.freedesktop.login1.Session', 'SetBrightness', 'ssu', 'backlight', bl.name, String(raw)]);
      if (!res.ok) {
        const alt = await this.r('brightnessctl', ['-q', 'set', v + '%']);
        if (!alt.ok) return { available: true, via: 'backlight', level: Math.round((bl.cur / bl.max) * 100), error: 'logind refused the change' };
      }
      return this.brightness();
    }
    const res = await this.r('ddcutil', ['setvcp', '10', String(v)], { timeout: 8000 });
    return res.ok ? { available: true, via: 'ddcutil', level: v } : this.brightness();
  }

  // ---------- controllers (Bluetooth) ----------
  async btInfo(mac) {
    const res = await this.r('bluetoothctl', ['info', mac]);
    const get = (k) => { const m = res.out.match(new RegExp('^\\s*' + k + ':\\s*(.+)$', 'mi')); return m ? m[1].trim() : null; };
    const batt = res.out.match(/Battery Percentage:\s*0x[0-9a-f]+\s*\((\d+)\)/i);
    return {
      mac,
      name: get('Name') || get('Alias') || mac,
      icon: get('Icon'),
      paired: get('Paired') === 'yes',
      connected: get('Connected') === 'yes',
      battery: batt ? parseInt(batt[1], 10) : null,
    };
  }

  async btDevices(which) {
    // newer bluez: "devices Paired"; older: "paired-devices"
    let res = await this.r('bluetoothctl', which === 'paired' ? ['devices', 'Paired'] : ['devices']);
    if (which === 'paired' && (!res.ok || /Invalid/i.test(res.out + res.err))) res = await this.r('bluetoothctl', ['paired-devices']);
    if (res.missing) return null;
    return res.out.split('\n').map((l) => l.match(/^Device\s+(([0-9A-F]{2}:){5}[0-9A-F]{2})\s+(.*)$/i)).filter(Boolean).map((m) => ({ mac: m[1].toUpperCase(), name: m[3].trim() }));
  }

  isGamepad(d) { return d.icon === 'input-gaming' || GAMEPAD_NAME.test(d.name || ''); }

  async controllers() {
    const show = await this.r('bluetoothctl', ['show']);
    if (show.missing) return { available: false, reason: 'BlueZ (bluetoothctl) not installed' };
    if (!show.ok || /No default controller/i.test(show.out + show.err)) return { available: false, reason: 'no Bluetooth adapter' };
    const powered = /Powered:\s*yes/.test(show.out);
    const paired = (await this.btDevices('paired')) || [];
    const devices = [];
    for (const d of paired) {
      const info = await this.btInfo(d.mac);
      if (this.isGamepad(info)) devices.push(info);
    }
    return { available: true, powered, devices };
  }

  // scan for a while, then report gamepads that aren't paired yet
  async btScan(seconds = 12) {
    const secs = Math.max(4, Math.min(30, Number(seconds) || 12));
    await this.r('bluetoothctl', ['power', 'on']);
    await this.r('bluetoothctl', ['--timeout', String(secs), 'scan', 'on'], { timeout: (secs + 5) * 1000 });
    const all = (await this.btDevices('all')) || [];
    const paired = new Set(((await this.btDevices('paired')) || []).map((d) => d.mac));
    const found = [];
    for (const d of all) {
      if (paired.has(d.mac)) continue;
      const info = await this.btInfo(d.mac);
      if (this.isGamepad(info)) found.push(info);
    }
    return { ok: true, found };
  }

  async btPair(mac) {
    if (!MAC_OK(mac)) return { ok: false, error: 'bad device address' };
    const p = await this.r('bluetoothctl', ['--timeout', '20', 'pair', mac], { timeout: 30000 });
    if (!p.ok && !/AlreadyExists|already paired/i.test(p.out + p.err)) return { ok: false, error: 'Pairing failed. Put the controller in pairing mode and try again.' };
    await this.r('bluetoothctl', ['trust', mac]);
    const c = await this.r('bluetoothctl', ['--timeout', '15', 'connect', mac], { timeout: 25000 });
    return { ok: true, connected: c.ok };
  }

  async btConnect(mac, on) {
    if (!MAC_OK(mac)) return { ok: false, error: 'bad device address' };
    const res = await this.r('bluetoothctl', ['--timeout', '15', on ? 'connect' : 'disconnect', mac], { timeout: 25000 });
    return { ok: res.ok, error: res.ok ? null : (on ? 'Couldn’t connect. Is the controller on?' : 'Couldn’t disconnect') };
  }

  async btForget(mac) {
    if (!MAC_OK(mac)) return { ok: false, error: 'bad device address' };
    const res = await this.r('bluetoothctl', ['remove', mac]);
    return { ok: res.ok };
  }

  // ---------- power ----------
  power(action) {
    const verb = { suspend: 'suspend', poweroff: 'poweroff', reboot: 'reboot' }[action];
    if (!verb) return { ok: false, error: 'bad action' };
    const child = spawn('systemctl', [verb], { env: this.env, detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
    return { ok: true };
  }

  async status() {
    const [wifi, volume, brightness, controllers] = await Promise.all([this.wifiStatus(), this.volume(), this.brightness(), this.controllers()]);
    return { wifi, volume, brightness, controllers };
  }
}

module.exports = { System, splitTerse, SSID_OK, PSK_OK, MAC_OK };
