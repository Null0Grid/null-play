'use strict';
// Builds a throwaway $HOME with Steam, Heroic, Lutris and .desktop games, plus
// a bin/ folder of fake commands (xdg-open, gamemoderun, lutris, a game) that
// log how they were called. Used by the unit and end-to-end tests.
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

// a solid-color PNG of the given size, so the UI has real images to draw
function png(w, h, [r, g, b]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.alloc(1 + w * 3); for (let x = 0; x < w; x++) { row[1 + x * 3] = r; row[2 + x * 3] = g; row[3 + x * 3] = b; }
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function w(p, data, mode) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); if (mode) fs.chmodSync(p, mode); }

function acf(appid, name, flags = 4, extra = '') {
  return `"AppState"\n{\n\t"appid"\t\t"${appid}"\n\t"Universe"\t\t"1"\n\t"name"\t\t"${name}"\n\t"StateFlags"\t\t"${flags}"\n\t"SizeOnDisk"\t\t"4402341888"\n${extra}}\n`;
}

function makeHome(opts = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nullplay-home-'));
  const log = path.join(home, 'launch.log');
  const steam = path.join(home, '.local', 'share', 'Steam');
  const lib2 = path.join(home, 'Games', 'SteamLibrary');

  if (!opts.empty) {
    // ---- Steam: two library folders, a tool to skip, play time, art ----
    w(path.join(steam, 'steamapps', 'libraryfolders.vdf'), `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${steam}"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"${lib2}" // second drive\n\t}\n}\n`);
    w(path.join(steam, 'steamapps', 'appmanifest_1145360.acf'), acf(1145360, 'Hades'));
    w(path.join(steam, 'steamapps', 'appmanifest_228980.acf'), acf(228980, 'Steamworks Common Redistributables'));
    w(path.join(steam, 'steamapps', 'appmanifest_2805730.acf'), acf(2805730, 'Proton 9.0'));
    w(path.join(steam, 'steamapps', 'appmanifest_1517290.acf'), acf(1517290, 'Battlefield™ 2042'));
    w(path.join(steam, 'steamapps', 'appmanifest_976730.acf'), acf(976730, 'Halo: The Master Chief Collection'));
    w(path.join(steam, 'steamapps', 'appmanifest_1086940.acf'), acf(1086940, 'Baldur\'s Gate 3', 1026)); // first download still running
    w(path.join(lib2, 'steamapps', 'appmanifest_413150.acf'), acf(413150, 'Stardew Valley'));
    w(path.join(steam, 'userdata', '12345678', 'config', 'localconfig.vdf'),
      `"UserLocalConfigStore"\n{\n\t"Software"\n\t{\n\t\t"Valve"\n\t\t{\n\t\t\t"Steam"\n\t\t\t{\n\t\t\t\t"apps"\n\t\t\t\t{\n\t\t\t\t\t"1145360"\n\t\t\t\t\t{\n\t\t\t\t\t\t"LastPlayed"\t\t"${Math.floor(Date.now() / 1000) - 86400}"\n\t\t\t\t\t\t"Playtime"\t\t"2556"\n\t\t\t\t\t}\n\t\t\t\t\t"413150"\n\t\t\t\t\t{\n\t\t\t\t\t\t"LastPlayed"\t\t"${Math.floor(Date.now() / 1000) - 3 * 86400}"\n\t\t\t\t\t\t"Playtime"\t\t"7080"\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n}\n`);
    // new per-app layout (one hashed folder deep) and the old flat layout
    w(path.join(steam, 'appcache', 'librarycache', '1145360', 'library_600x900.jpg'), png(60, 90, [120, 30, 50]));
    w(path.join(steam, 'appcache', 'librarycache', '1145360', 'a1b2c3', 'library_hero.jpg'), png(96, 31, [90, 20, 40]));
    w(path.join(steam, 'appcache', 'librarycache', '413150_library_600x900.jpg'), png(60, 90, [40, 110, 60]));
    fs.mkdirSync(path.join(home, '.steam'), { recursive: true });
    fs.symlinkSync(steam, path.join(home, '.steam', 'steam'));

    // ---- Heroic: Epic, GOG, Amazon, sideloaded, play time ----
    const her = path.join(home, '.config', 'heroic');
    w(path.join(her, 'store_cache', 'legendary_library.json'), JSON.stringify({ library: [
      { app_name: 'Fortnite', title: 'Fortnite', store_url: 'https://store.epicgames.com/p/fortnite', art_square: 'https://cdn.example.invalid/fortnite.jpg' },
      { app_name: 'Hawk', title: 'Control', store_url: 'https://store.epicgames.com/p/control' },
      { app_name: 'DlcThing', title: 'Some DLC', is_dlc: true },
      { app_name: 'Owned1', title: 'Alan Wake 2' },
    ] }));
    w(path.join(her, 'legendaryConfig', 'legendary', 'installed.json'), JSON.stringify({ Fortnite: { app_name: 'Fortnite', install_size: 1 }, Hawk: { app_name: 'Hawk', install_size: 4e10 } }));
    w(path.join(her, 'store_cache', 'gog_library.json'), JSON.stringify({ games: [{ app_name: '1771589310', title: 'Disco Elysium' }] }));
    w(path.join(her, 'gog_store', 'installed.json'), JSON.stringify({ installed: [{ appName: '1771589310', install_path: '/games/disco', install_size: '20 GiB', platform: 'windows' }] }));
    w(path.join(her, 'store_cache', 'nile_library.json'), JSON.stringify({ library: [{ app_name: 'amzn1.adg.product.abc', title: 'Wolfenstein: The New Order' }] }));
    w(path.join(her, 'nile_config', 'nile', 'installed.json'), JSON.stringify([{ id: 'amzn1.adg.product.abc', path: '/games/wolf', size: 1 }]));
    w(path.join(her, 'store', 'timestamp.json'), JSON.stringify({ Hawk: { firstPlayed: '2026-09-01T10:00:00Z', lastPlayed: '2026-10-20T21:00:00Z', totalPlayed: 545 } }));

    // ---- .desktop games ----
    const apps = path.join(home, '.local', 'share', 'applications');
    w(path.join(apps, 'supertuxkart.desktop'), `[Desktop Entry]\nType=Application\nName=SuperTuxKart\nExec=supertuxkart %U\nIcon=supertuxkart\nCategories=Game;ArcadeGame;\n`);
    w(path.join(apps, 'retroarch.desktop'), `[Desktop Entry]\nType=Application\nName=RetroArch\nExec="retroarch" --menu\nCategories=Game;Emulator;\n`);
    w(path.join(apps, 'Hades.desktop'), `[Desktop Entry]\nName=Hades\nExec=steam steam://rungameid/1145360\nCategories=Game;\n`);
    w(path.join(apps, 'com.heroicgameslauncher.hgl.desktop'), `[Desktop Entry]\nName=Heroic Games Launcher\nExec=heroic\nCategories=Game;\n`);
    w(path.join(apps, 'hidden-game.desktop'), `[Desktop Entry]\nName=Hidden\nExec=hidden\nNoDisplay=true\nCategories=Game;\n`);
    w(path.join(apps, 'editor.desktop'), `[Desktop Entry]\nName=Some Editor\nExec=editor\nCategories=Utility;\n`);
    w(path.join(apps, 'localization.desktop'), `[Desktop Entry]\n[Desktop Action other]\nName=Wrong\n`);
    w(path.join(home, '.local', 'share', 'icons', 'hicolor', '256x256', 'apps', 'supertuxkart.png'), png(64, 64, [30, 90, 160]));
    const fp = path.join(home, '.local', 'share', 'flatpak', 'exports', 'share', 'applications');
    w(path.join(fp, 'net.veloren.airshipper.desktop'), `[Desktop Entry]\nType=Application\nName=Veloren\nExec=/usr/bin/flatpak run --branch=stable --arch=x86_64 --command=airshipper net.veloren.airshipper\nCategories=Game;\nX-Flatpak=net.veloren.airshipper\n`);
  }

  // ---- fake commands: log argv, exit quickly ----
  const bin = path.join(home, 'bin');
  const logger = (name) => `#!/bin/sh\nprintf '%s' "${name}" >> "${log}"\nfor a in "$@"; do printf ' [%s]' "$a" >> "${log}"; done\necho >> "${log}"\n`;
  for (const name of ['xdg-open', 'supertuxkart', 'retroarch', 'flatpak', 'heroic']) w(path.join(bin, name), logger(name), 0o755);
  // gamemoderun runs its arguments, like the real one
  w(path.join(bin, 'gamemoderun'), `#!/bin/sh\nprintf 'gamemoderun' >> "${log}"\necho >> "${log}"\nexec "$@"\n`, 0o755);
  if (!opts.empty) {
    w(path.join(bin, 'lutris'), `#!/bin/sh\necho "INFO 2026-10-27 lutris starting" \ncat <<'EOF'\n[{"id": 7, "slug": "ea-app-the-sims-4", "name": "The Sims 4", "runner": "wine", "platform": "Windows", "year": 2014, "directory": "/games/ea", "playtime": "12.5", "lastplayed": 1761400000},\n {"id": 9, "slug": "overwatch-2", "name": "Overwatch 2", "runner": "wine", "platform": "Windows", "playtime": "3 hours 20 minutes", "lastplayed": "2026-10-01 20:00:00"},\n {"id": 11, "slug": "hades", "name": "Hades", "runner": "steam", "platform": "Linux"}]\nEOF\n`, 0o755);
    w(path.join(home, '.local', 'share', 'lutris', 'coverart', 'overwatch-2.jpg'), png(60, 90, [200, 120, 30]));
  }

  return {
    home,
    log,
    bin,
    env: {
      HOME: home,
      PATH: bin + ':/usr/bin:/bin',
      XDG_DATA_HOME: path.join(home, '.local', 'share'),
      XDG_DATA_DIRS: path.join(home, 'no-system-share'),
    },
    readLog: () => { try { return fs.readFileSync(log, 'utf8'); } catch { return ''; } },
  };
}

module.exports = { makeHome, png };
