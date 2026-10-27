# NULL // PLAY

**Gamer Mode for Null OS.**

A full-screen game launcher that puts every game on your machine in one place: Steam, Epic, GOG and Amazon (through Heroic), Lutris (EA app, Ubisoft Connect, Battle.net, itch.io…), Flathub and any other installed game. Built for a controller (Xbox, PlayStation, generic) or WASD / arrow keys; a mouse works too.

Part of the Null Grid suite: Null Search · Null Grid · Null Notes · Null Drive · Null Scribe · Null OS.

Linux only for now.

## Status

Phases 1–3 of 6 are in:
- **Phase 1:** library scan, library grid with source filters, launching, controller / keyboard / mouse navigation, anti-cheat flags.
- **Phase 2:** Home (hero banner + Continue row + library peek), the game page, artwork (launcher art → SteamGridDB → your own), the startup animation and the CRT-collapse exit.
- **Phase 3:** quick settings (Wi-Fi, volume, brightness, controllers, sleep / power off) and an on-screen keyboard.

Store, social / cloud tiles and the Null OS integration come next; see the design doc in the Null Grid project (`null-grid/null-play-design.md`).

## Screens

- **Startup:** about 1.6 s. The NULL // PLAY wordmark glitches in, then Packet walks along the bar while the libraries are scanned. Any button skips it; with reduced motion it's a plain fade.
- **HOME:** a hero banner for the focused game (art, source, play time, last played, PLAY / DETAILS / ★), the **Continue** row of recently played games, and a peek at the library. Opens on the last game you played.
- **LIBRARY:** every game as a cover grid, with source filters, sort and INSTALLED ONLY.
- **Game page** (X on any game): stats, PLAY, favorite, OPEN IN STEAM / HEROIC / LUTRIS, and per-game options: Feral GameMode on/off, Hide from Continue, Set artwork.
- **Quick settings** (☰ Menu / Q, or the icons top right): a side panel with
  - **Wi-Fi:** current network and signal; the network list (strongest band per network, current first); join with the on-screen keyboard for the password; Wi-Fi on / off.
  - **Volume** and **Brightness** sliders (◀ ▶ in steps of 5; A mutes). Brightness works on laptop screens and, through ddcutil, on external monitors that support DDC/CI.
  - **Controllers:** paired gamepads with battery level; A connects / disconnects; PAIR NEW CONTROLLER scans and pairs (headphones, phones and other Bluetooth devices are left out).
  - **Exit to desktop**, **Sleep**, **Power off** (each asks first).
- **On-screen keyboard:** for typing with a controller (Wi-Fi passwords, the SteamGridDB key). A types, X deletes, Y space, LB shift, RB symbols, ☰ done, B cancel. A physical keyboard works too. Passwords show as dots until you press SHOW.
- **Exit to desktop:** CRT collapse to a line, then the app closes. Games you started keep running.

## Quick settings: what it uses

| | Tool | Notes |
|---|---|---|
| Wi-Fi | `nmcli` (NetworkManager) | the password goes to nmcli on stdin (`--ask`), never on a command line |
| Volume | `wpctl` (PipeWire / WirePlumber) | the default output |
| Brightness | `/sys/class/backlight` + logind `SetBrightness` (laptops, no root); else `ddcutil` (external monitors) | never goes fully black |
| Controllers | `bluetoothctl` (BlueZ) | pair, trust, connect |
| Sleep / power off | `systemctl suspend` / `poweroff` | allowed for the logged-in user by logind |

A missing tool just shows that section as unavailable.

## Artwork

For each game and each kind of art (cover, hero banner, logo) NULL // PLAY uses, in order:
1. art you set on the game page (copied into NULL // PLAY's own folder);
2. the launcher's local art (Steam's library cache, Lutris covers);
3. **SteamGridDB**, if you added an API key;
4. Heroic's online art, downloaded once and cached.

SteamGridDB is optional. Get a free key at steamgriddb.com → Preferences → API and paste it into the artwork picker (Set artwork on any game page). With a key, games missing a cover get one automatically, recently played games get a hero banner, and the picker shows up to 12 options per kind. The key is kept in the system keyring when one is available (KWallet / GNOME Keyring). Steam games are matched by app id; others by exact title.

## Open it

- `gamemode` in a terminal, or **NULL // PLAY** in the start menu's Games section
- `null-play --windowed` runs it in a window (handy while developing)

## Libraries

| Library | How NULL // PLAY finds it | How it launches |
|---|---|---|
| Steam (native or Flatpak) | every library folder in `libraryfolders.vdf`, `appmanifest_*.acf`; play time and last played from `userdata/*/config/localconfig.vdf`; art from Steam's library cache | `steam://rungameid/<id>` |
| Epic, GOG, Amazon, sideloaded (Heroic, native or Flatpak) | Heroic's library caches and installed lists; play time from `store/timestamp.json` | `heroic://launch/<runner>/<app>` |
| Lutris (native or Flatpak) | `lutris -l -o -j` | `lutris:rungameid/<id>` |
| Flathub and other installed games | `.desktop` files with `Categories=Game` (launchers and entries Steam / Heroic / Lutris generated are skipped) | runs the entry's command under `gamemoderun` |

Owned-but-not-installed games show with **INSTALLED ONLY** switched off; picking one opens its launcher to install it.

## Feral GameMode

- Installed / Flathub games run under `gamemoderun`.
- Steam games: Steam starts the game itself, so NULL // PLAY finds the game's process (by its `SteamAppId`) and registers it with `gamemoded` over D-Bus.
- Heroic and Lutris have their own per-game GameMode switch; NULL // PLAY leaves those to it.

## Anti-cheat flags

Games whose anti-cheat doesn't work on Linux get a red **⚠ ANTI-CHEAT BLOCKS LINUX** / **⚠ ANTI-CHEAT BROKEN ON LINUX** badge, and launching one asks first (BACK is the default). Games that run but may lose online play get an amber badge. The list comes from [AreWeAntiCheatYet](https://areweanticheatyet.com) (MIT): a snapshot ships with the app and refreshes weekly when online. Matching is by Steam app id, Epic slug or exact title, never a loose name match.

## Controls

| Action | Xbox / generic | PlayStation | Keyboard | Mouse |
|---|---|---|---|---|
| Move | D-pad, left stick | D-pad, left stick | WASD, arrows | hover |
| Play / select | A | ✕ | Enter, Space | click |
| Back | B | ○ | Esc, Backspace | |
| Game page | X | □ | X, I | |
| Next filter | Y | △ | F (Shift+F back) | click a chip |
| Switch tabs | LB / RB | L1 / R1 | 1 / 3, Tab | click a tab |
| Page | LT / RT | L2 / R2 | PgUp / PgDn | wheel |
| Rescan | | | R, F5 | |
| Quick settings | ☰ Menu | Options | Q | top-right icons |
| Exit to desktop | View + Menu | Share + Options | Ctrl+Q | |

In the artwork picker, LB / RB (1 / 3) switch between cover, hero and logo.

The hint bar switches to the buttons of whatever you touched last.

## Privacy

Everything is read from local files. The only network requests are:
- the weekly anti-cheat list from GitHub;
- art Heroic already references (Epic / GOG / Amazon CDNs), fetched once;
- SteamGridDB, only if you add a key, only for games missing art, with each miss remembered for a week.

No accounts, no telemetry.

## Develop

```
npm ci
npm start                       # windowed
npm test                        # scanners, anti-cheat matching, launch commands
xvfb-run -a -s "-screen 0 1440x900x24" node tests/ui-phase1.test.js   # library, nav, launching; needs xdotool
xvfb-run -a -s "-screen 0 1440x900x24" node tests/ui-phase2.test.js   # home, game page, art, animations
xvfb-run -a -s "-screen 0 1440x900x24" node tests/ui-phase3.test.js   # quick settings, on-screen keyboard
npm run dist:linux              # .deb, AppImage, .tar.gz for x64 + arm64 into dist/
```

Tests run against a generated fake home folder (`tests/fixtures/make-home.js`) with Steam, Heroic, Lutris and `.desktop` games and logging stand-ins for `xdg-open`, `gamemoderun` and `lutris`. The Phase 3 tests use stand-ins for `nmcli`, `wpctl`, `busctl`, `ddcutil`, `bluetoothctl` and `systemctl` (`tests/fixtures/fake-system.js`). The Phase 2 test runs a stand-in SteamGridDB on localhost (`NULLPLAY_SGDB_BASE`); `NULLPLAY_TEST_PICK_FILE` replaces the native file dialog there.

## Release

Push a tag matching `package.json`'s version (`v0.3.0` or `0.3.0`). The Release workflow tests, builds x64 + arm64 `.deb`, AppImage and `.tar.gz`, checks the `.deb` contains `/usr/bin/gamemode` and a `NULL // PLAY` `.desktop` entry (`Categories=Game`), and attaches everything to the GitHub release. Null OS pulls `null-play_<version>_amd64.deb` at ISO build time.

## License

Copyright (c) NULLGRID. All rights reserved. See `LICENSE` for third-party components.
