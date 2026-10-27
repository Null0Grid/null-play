'use strict';
// Stand-ins for nmcli, wpctl, busctl, ddcutil, bluetoothctl and systemctl,
// written into a fake home's bin/ folder. They keep their state in one JSON
// file so a test can see what changed, and log every call to launch.log.
const fs = require('fs');
const path = require('path');

const SCRIPT = (name, body) => `#!${process.execPath}
'use strict';
const fs = require('fs');
const STATE = ${JSON.stringify('__STATE__')};
const LOG = ${JSON.stringify('__LOG__')};
const st = JSON.parse(fs.readFileSync(STATE, 'utf8'));
const argv = process.argv.slice(2);
fs.appendFileSync(LOG, ${JSON.stringify(name)} + argv.map((a) => ' [' + a + ']').join('') + '\\n');
const save = () => fs.writeFileSync(STATE, JSON.stringify(st));
const out = (s) => process.stdout.write(s + (s.endsWith('\\n') ? '' : '\\n'));
const fail = (msg, code) => { process.stderr.write(msg + '\\n'); process.exit(code || 1); };
const esc = (s) => String(s).replace(/\\\\/g, '\\\\\\\\').replace(/:/g, '\\\\:');
${body}
`;

const NMCLI = `
const a = argv.join(' ');
if (a === '-t radio wifi') out(st.wifi.enabled ? 'enabled' : 'disabled');
else if (a === '-t -f DEVICE,TYPE,STATE,CONNECTION device') out('wlp2s0:wifi:' + (st.wifi.connected ? 'connected:' + esc(st.wifi.connected) : 'disconnected:') + '\\nlo:loopback:connected (externally):lo');
else if (a.startsWith('-t -f IN-USE,SSID,SIGNAL,SECURITY,FREQ device wifi list')) {
  if (!st.wifi.enabled) process.exit(0);
  let marked = false;
  out(st.wifi.networks.map((n) => ((st.wifi.connected === n.ssid && !marked && (marked = true)) ? '*' : ' ') + ':' + esc(n.ssid) + ':' + n.signal + ':' + (n.security || '--') + ':' + n.freq).join('\\n'));
}
else if (a === '-t -f NAME,TYPE connection show') out(st.wifi.known.map((k) => esc(k) + ':802-11-wireless').join('\\n') + '\\nlo:loopback');
else if (argv[0] === 'radio' && argv[1] === 'wifi') { st.wifi.enabled = argv[2] === 'on'; if (!st.wifi.enabled) st.wifi.connected = null; save(); }
else if (argv[0] === 'connection' && argv[1] === 'up') { st.wifi.connected = argv[3]; save(); out('Connection successfully activated'); }
else if (argv[0] === '--ask' && argv[3] === 'connect') {
  const ssid = argv[4];
  const net = st.wifi.networks.find((n) => n.ssid === ssid);
  if (!net) fail('Error: No network with SSID ' + ssid + ' found.', 10);
  const pw = fs.readFileSync(0, 'utf8').split('\\n')[0];
  fs.appendFileSync(LOG, 'nmcli-password-received ' + (pw ? 'yes' : 'no') + '\\n');
  if (net.security && pw !== net.password) fail('Error: Connection activation failed: Secrets were required, but not provided.', 4);
  st.wifi.connected = ssid; if (!st.wifi.known.includes(ssid)) st.wifi.known.push(ssid); save();
  out("Device 'wlp2s0' successfully activated");
}
else fail('fake nmcli: unhandled ' + a, 2);
`;

const WPCTL = `
const a = argv.join(' ');
if (argv[0] === 'get-volume') out('Volume: ' + st.audio.volume.toFixed(2) + (st.audio.muted ? ' [MUTED]' : ''));
else if (argv[0] === 'inspect') out('id 52, type PipeWire:Interface:Node\\n  * node.description = "' + st.audio.name + '"\\n    node.nick = "HDMI"');
else if (argv[0] === 'set-volume') { st.audio.volume = Math.min(1, parseFloat(argv[argv.length - 1])); save(); }
else if (argv[0] === 'set-mute') { st.audio.muted = argv[2] === 'toggle' ? !st.audio.muted : argv[2] === '1'; save(); }
else fail('fake wpctl: unhandled ' + a, 2);
`;

const BUSCTL = `
// SetBrightness ssu backlight <name> <value>: write it where the kernel would
if (argv.includes('SetBrightness')) {
  const name = argv[argv.length - 2], value = argv[argv.length - 1];
  fs.writeFileSync(st.backlightDir + '/' + name + '/brightness', value + '\\n');
} else fail('fake busctl: unhandled', 2);
`;

const DDCUTIL = `
if (!st.ddc) fail('No monitor detected', 1);
if (argv[0] === 'getvcp') out('VCP 10 C ' + st.ddc.level + ' 100');
else if (argv[0] === 'setvcp') { st.ddc.level = parseInt(argv[2], 10); save(); }
`;

const BLUETOOTHCTL = `
const args = argv[0] === '--timeout' ? argv.slice(2) : argv;
const a = args.join(' ');
const bt = st.bt;
const dev = (mac) => bt.devices.find((d) => d.mac === mac);
if (a === 'show') out('Controller AA:BB:CC:00:11:22 (public)\\n\\tName: null-os\\n\\tPowered: ' + (bt.powered ? 'yes' : 'no'));
else if (a === 'power on') { bt.powered = true; save(); out('Changing power on succeeded'); }
else if (a === 'devices Paired') out(bt.devices.filter((d) => d.paired).map((d) => 'Device ' + d.mac + ' ' + d.name).join('\\n'));
else if (a === 'devices') out(bt.devices.filter((d) => d.paired || d.visible).map((d) => 'Device ' + d.mac + ' ' + d.name).join('\\n'));
else if (a === 'scan on') { for (const d of bt.devices) if (d.inRange) d.visible = true; save(); out('Discovery started'); }
else if (args[0] === 'info') {
  const d = dev(args[1]); if (!d) fail('Device ' + args[1] + ' not available', 1);
  out('Device ' + d.mac + ' (public)\\n\\tName: ' + d.name + '\\n\\tAlias: ' + d.name + '\\n\\tIcon: ' + d.icon + '\\n\\tPaired: ' + (d.paired ? 'yes' : 'no') + '\\n\\tTrusted: ' + (d.trusted ? 'yes' : 'no') + '\\n\\tConnected: ' + (d.connected ? 'yes' : 'no') + (d.battery != null ? '\\n\\tBattery Percentage: 0x' + d.battery.toString(16) + ' (' + d.battery + ')' : ''));
}
else if (args[0] === 'pair') { const d = dev(args[1]); if (!d || !d.visible) fail('Failed to pair: org.bluez.Error.ConnectionAttemptFailed', 1); d.paired = true; save(); out('Pairing successful'); }
else if (args[0] === 'trust') { const d = dev(args[1]); if (d) { d.trusted = true; save(); } out('trust succeeded'); }
else if (args[0] === 'connect') { const d = dev(args[1]); if (!d || !d.paired || !d.inRange) fail('Failed to connect: org.bluez.Error.Failed', 1); d.connected = true; save(); out('Connection successful'); }
else if (args[0] === 'disconnect') { const d = dev(args[1]); if (d) { d.connected = false; save(); } out('Successful disconnected'); }
else if (args[0] === 'remove') { bt.devices = bt.devices.filter((d) => d.mac !== args[1]); save(); out('Device has been removed'); }
else fail('fake bluetoothctl: unhandled ' + a, 2);
`;

const SYSTEMCTL = `
st.power = argv[0]; save();
`;

function installFakeSystem(fx, overrides = {}) {
  const stateFile = path.join(fx.home, 'fake-system.json');
  const backlightDir = path.join(fx.home, 'sys-backlight');
  const state = {
    backlightDir,
    wifi: {
      enabled: true,
      connected: 'HomeNet',
      known: ['HomeNet'],
      networks: [
        { ssid: 'HomeNet', signal: 82, security: 'WPA2', freq: '5180 MHz', password: 'home-pass' },
        { ssid: 'Lab-5G', signal: 64, security: 'WPA2 WPA3', freq: '5745 MHz', password: 'correct horse' },
        { ssid: 'Cafe: Free', signal: 40, security: '', freq: '2437 MHz' },
        { ssid: 'HomeNet', signal: 30, security: 'WPA2', freq: '2412 MHz', password: 'home-pass' },
      ],
    },
    audio: { volume: 0.64, muted: false, name: 'HDMI / DisplayPort Audio' },
    ddc: null,
    bt: {
      powered: true,
      devices: [
        { mac: '9C:AA:1B:00:00:01', name: 'Xbox Wireless Controller', icon: 'input-gaming', paired: true, trusted: true, connected: true, inRange: true, battery: 70 },
        { mac: 'A0:5A:5C:00:00:02', name: 'DualSense Wireless Controller', icon: 'input-gaming', paired: true, trusted: true, connected: false, inRange: true, battery: null },
        { mac: '00:1B:66:00:00:03', name: 'Sony WH-1000XM4', icon: 'audio-headset', paired: true, trusted: true, connected: true, inRange: true },
        { mac: 'E4:17:D8:00:00:04', name: '8BitDo Pro 2', icon: 'input-gaming', paired: false, inRange: true },
        { mac: '70:3A:CB:00:00:05', name: 'Some Phone', icon: 'phone', paired: false, inRange: true },
      ],
    },
    power: null,
    ...overrides,
  };
  fs.writeFileSync(stateFile, JSON.stringify(state));
  if (overrides.noBacklight !== true) {
    fs.mkdirSync(path.join(backlightDir, 'intel_backlight'), { recursive: true });
    fs.writeFileSync(path.join(backlightDir, 'intel_backlight', 'max_brightness'), '19200\n');
    fs.writeFileSync(path.join(backlightDir, 'intel_backlight', 'brightness'), '15360\n');
    fs.writeFileSync(path.join(backlightDir, 'intel_backlight', 'type'), 'raw\n');
  }
  const scripts = { nmcli: NMCLI, wpctl: WPCTL, busctl: BUSCTL, ddcutil: DDCUTIL, bluetoothctl: BLUETOOTHCTL, systemctl: SYSTEMCTL };
  for (const [name, body] of Object.entries(scripts)) {
    const file = path.join(fx.bin, name);
    fs.writeFileSync(file, SCRIPT(name, body).replace('__STATE__', stateFile).replace('__LOG__', fx.log));
    fs.chmodSync(file, 0o755);
  }
  return {
    stateFile,
    backlightDir,
    read: () => JSON.parse(fs.readFileSync(stateFile, 'utf8')),
    write: (fn) => { const s = JSON.parse(fs.readFileSync(stateFile, 'utf8')); fn(s); fs.writeFileSync(stateFile, JSON.stringify(s)); },
    brightnessRaw: () => parseInt(fs.readFileSync(path.join(backlightDir, 'intel_backlight', 'brightness'), 'utf8'), 10),
  };
}

module.exports = { installFakeSystem };
