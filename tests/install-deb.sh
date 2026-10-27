#!/bin/bash
# Installs the built .deb for real and checks what the installer sets up:
#   the null-play / nullplay / gamemode commands, the .desktop entry, the
#   desktop shortcut for existing users and /etc/skel, the Plasma taskbar
#   pin (update script + live pin for a logged-in user), no shortcut coming
#   back on reinstall after a user deleted it, and a clean removal.
# Needs root and a Debian/Ubuntu system:   sudo bash tests/install-deb.sh dist/null-play_*_amd64.deb
set -u
DEB="$(readlink -f "${1:?usage: install-deb.sh path/to/null-play_X_amd64.deb}")"
FAILS=0
pass() { echo "[pass] $1"; }
fail() { echo "[FAIL] $1"; FAILS=$((FAILS + 1)); }
check() { local label="$1"; shift; if "$@" >/dev/null 2>&1; then pass "$label"; else fail "$label"; fi; }

# ---- test users: one logged in with a Desktop, one without a Desktop, one who deletes the shortcut
for u in npgamer npnodesk npdeleter; do id "$u" >/dev/null 2>&1 || useradd -m -s /bin/bash "$u"; done
install -d -o npgamer -g npgamer /home/npgamer/Desktop
install -d -o npdeleter -g npdeleter /home/npdeleter/Desktop
rm -rf /home/npnodesk/Desktop
# a file of the user's own with the same name must never be removed
echo "[Desktop Entry]" > /home/npdeleter/notes.desktop

# ---- "logged in": a session bus socket and a gdbus stand-in that records calls
GAMER_UID="$(id -u npgamer)"
LOG=/tmp/np-gdbus.log; rm -f "$LOG"; touch "$LOG"; chmod 666 "$LOG"
mkdir -p "/run/user/$GAMER_UID"; chown npgamer: "/run/user/$GAMER_UID"
python3 -c "import socket,sys; s=socket.socket(socket.AF_UNIX); s.bind(sys.argv[1])" "/run/user/$GAMER_UID/bus"
# dpkg runs maintainer scripts with its own PATH, so stand in for /usr/bin/gdbus itself
if [ -e /usr/bin/gdbus ] && [ ! -e /usr/bin/gdbus.np-real ]; then mv /usr/bin/gdbus /usr/bin/gdbus.np-real; fi
cat > /usr/bin/gdbus <<EOF
#!/bin/sh
echo "\$(id -un) \$DBUS_SESSION_BUS_ADDRESS \$*" >> $LOG
EOF
chmod 755 /usr/bin/gdbus

# ---- install
DEBIAN_FRONTEND=noninteractive apt-get install -y "$DEB" > /tmp/np-apt.log 2>&1 || { tail -20 /tmp/np-apt.log; fail "apt install"; }
check "null-play command installed" test -x /usr/bin/null-play
check "nullplay command installed and opens null-play" grep -q 'exec /usr/bin/null-play' /usr/bin/nullplay
check "gamemode command installed and opens null-play" grep -q 'exec /usr/bin/null-play' /usr/bin/gamemode
check "nullplay is on PATH" sh -c 'command -v nullplay'
check ".desktop entry: Name=NULL // PLAY" grep -qx 'Name=NULL // PLAY' /usr/share/applications/null-play.desktop
check ".desktop entry: Categories=Game;" grep -qx 'Categories=Game;' /usr/share/applications/null-play.desktop
check "desktop shortcut for npgamer" test -x /home/npgamer/Desktop/null-play.desktop
check "  owned by npgamer" test "$(stat -c %U /home/npgamer/Desktop/null-play.desktop)" = npgamer
check "  same as the menu entry" cmp -s /usr/share/applications/null-play.desktop /home/npgamer/Desktop/null-play.desktop
check "desktop shortcut for npdeleter" test -f /home/npdeleter/Desktop/null-play.desktop
check "no Desktop folder created for npnodesk" test ! -e /home/npnodesk/Desktop
check "shortcut for new accounts in /etc/skel" test -x /etc/skel/Desktop/null-play.desktop
check "taskbar pin: Plasma update script installed" test -f /usr/share/plasma/shells/org.kde.plasma.desktop/contents/updates/null-play-taskbar.js
check "taskbar pin: pinned live for the logged-in user" sh -c "grep -q '^npgamer unix:path=/run/user/$GAMER_UID/bus .*org.kde.PlasmaShell.evaluateScript' '$LOG' && grep -q \"var LAUNCHER = 'applications:null-play.desktop'\" '$LOG'"
check "taskbar pin: users who aren't logged in were left alone" sh -c "! grep -qE '^(npnodesk|npdeleter) ' '$LOG'"

# a new account made after install gets the shortcut from /etc/skel
id npnew >/dev/null 2>&1 || useradd -m -s /bin/bash npnew
check "new account gets the shortcut" test -f /home/npnew/Desktop/null-play.desktop

# ---- the user deletes it; reinstalling / upgrading doesn't bring it back
rm -f /home/npdeleter/Desktop/null-play.desktop
: > "$LOG"
DEBIAN_FRONTEND=noninteractive apt-get install -y --reinstall "$DEB" > /tmp/np-apt2.log 2>&1 || fail "apt reinstall"
check "reinstall: deleted shortcut stays deleted" test ! -e /home/npdeleter/Desktop/null-play.desktop
check "reinstall: npgamer's shortcut still there" test -f /home/npgamer/Desktop/null-play.desktop
check "reinstall: no second taskbar pin call" test ! -s "$LOG"

# ---- removal
cp /usr/share/applications/null-play.desktop /tmp/np-entry.desktop
DEBIAN_FRONTEND=noninteractive apt-get remove -y null-play > /tmp/np-apt3.log 2>&1 || fail "apt remove"
check "remove: commands gone" sh -c '! test -e /usr/bin/nullplay && ! test -e /usr/bin/gamemode && ! test -e /usr/bin/null-play'
check "remove: npgamer's shortcut removed" test ! -e /home/npgamer/Desktop/null-play.desktop
check "remove: the user's own .desktop file kept" test -f /home/npdeleter/notes.desktop
check "remove: /etc/skel shortcut removed" test ! -e /etc/skel/Desktop/null-play.desktop
check "remove: taskbar unpinned live for the logged-in user" grep -q "^npgamer .*evaluateScript.*s!=='applications:null-play.desktop'" "$LOG"
check "remove: installer state cleared" test ! -e /var/lib/null-play

# ---- tidy up
rm -f /usr/bin/gdbus "/run/user/$GAMER_UID/bus"
if [ -e /usr/bin/gdbus.np-real ]; then mv /usr/bin/gdbus.np-real /usr/bin/gdbus; fi
for u in npgamer npnodesk npdeleter npnew; do userdel -r "$u" >/dev/null 2>&1; done

if [ "$FAILS" -eq 0 ]; then echo; echo "all passed"; exit 0; fi
echo; echo "$FAILS failed"; exit 1
