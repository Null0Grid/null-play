# NULL // PLAY

**Gamer Mode for Null OS.**

A full-screen game launcher that puts every game on your machine in one place: Steam, Epic, GOG and Amazon (through Heroic), Lutris (EA app, Ubisoft Connect, Battle.net, itch.io…), Flathub and any other installed game. Built for a controller (Xbox, PlayStation, generic) or WASD / arrow keys; a mouse works too.

Part of the Null Grid suite: Null Search · Null Grid · Null Notes · Null Drive · Null Scribe · Null OS.

Linux only for now.

## Status

Phase 1 of 6: library scan, library grid with source filters, launching, controller / keyboard / mouse navigation, anti-cheat flags. Home (hero + Continue row), startup animation, quick settings, store, social / cloud tiles and the Null OS integration come next; see the design doc in the Null Grid project (`null-grid/null-play-design.md`).

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
| Favorite | X | □ | X | |
| Next filter | Y | △ | F (Shift+F back) | click a chip |
| Switch tabs | LB / RB | L1 / R1 | 1 / 3, Tab | click a tab |
| Page | LT / RT | L2 / R2 | PgUp / PgDn | wheel |
| Rescan | | | R, F5 | |
| Exit to desktop | View + Menu | Share + Options | Ctrl+Q | |

The hint bar switches to the buttons of whatever you touched last.

## Privacy

Everything is read from local files. The only network requests are the weekly anti-cheat list from GitHub and cover art Heroic already references (Epic / GOG CDNs). No accounts, no telemetry.

## Develop

```
npm ci
npm start                       # windowed
npm test                        # scanners, anti-cheat matching, launch commands
xvfb-run -a -s "-screen 0 1440x900x24" node tests/ui-phase1.test.js   # the real app; needs xdotool
npm run dist:linux              # .deb, AppImage, .tar.gz for x64 + arm64 into dist/
```

Tests run against a generated fake home folder (`tests/fixtures/make-home.js`) with Steam, Heroic, Lutris and `.desktop` games and logging stand-ins for `xdg-open`, `gamemoderun` and `lutris`.

## Release

Push a tag matching `package.json`'s version (`v0.1.0` or `0.1.0`). The Release workflow tests, builds x64 + arm64 `.deb`, AppImage and `.tar.gz`, checks the `.deb` contains `/usr/bin/gamemode` and a `NULL // PLAY` `.desktop` entry (`Categories=Game`), and attaches everything to the GitHub release. Null OS pulls `null-play_<version>_amd64.deb` at ISO build time.

## License

Copyright (c) NULLGRID. All rights reserved. See `LICENSE` for third-party components.
