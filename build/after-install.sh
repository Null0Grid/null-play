#!/bin/bash

if type update-alternatives >/dev/null 2>&1; then
    # Remove previous link if it doesn't use update-alternatives
    if [ -L '/usr/bin/${executable}' -a -e '/usr/bin/${executable}' -a "`readlink '/usr/bin/${executable}'`" != '/etc/alternatives/${executable}' ]; then
        rm -f '/usr/bin/${executable}'
    fi
    update-alternatives --install '/usr/bin/${executable}' '${executable}' '/opt/${sanitizedProductName}/${executable}' 100 || ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
else
    ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
fi

# Check if user namespaces are supported by the kernel and working with a quick test:
if ! { [[ -L /proc/self/ns/user ]] && unshare --user true; }; then
    # Use SUID chrome-sandbox only on systems without user namespaces:
    chmod 4755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
else
    chmod 0755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
fi

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi

# Install apparmor profile. (Ubuntu 24+)
# First check if the version of AppArmor running on the device supports our profile.
# This is in order to keep backwards compatibility with Ubuntu 22.04 which does not support abi/4.0.
# In that case, we just skip installing the profile since the app runs fine without it on 22.04.
#
# Those apparmor_parser flags are akin to performing a dry run of loading a profile.
# https://wiki.debian.org/AppArmor/HowToUse#Dumping_profiles
#
# Unfortunately, at the moment AppArmor doesn't have a good story for backwards compatibility.
# https://askubuntu.com/questions/1517272/writing-a-backwards-compatible-apparmor-profile
if apparmor_status --enabled > /dev/null 2>&1; then
  APPARMOR_PROFILE_SOURCE='/opt/${sanitizedProductName}/resources/apparmor-profile'
  APPARMOR_PROFILE_TARGET='/etc/apparmor.d/${executable}'
  if apparmor_parser --skip-kernel-load --debug "$APPARMOR_PROFILE_SOURCE" > /dev/null 2>&1; then
    cp -f "$APPARMOR_PROFILE_SOURCE" "$APPARMOR_PROFILE_TARGET"

    # Updating the current AppArmor profile is not possible and probably not meaningful in a chroot'ed environment.
    # Use cases are for example environments where images for clients are maintained.
    # There, AppArmor might correctly be installed, but live updating makes no sense.
    if ! { [ -x '/usr/bin/ischroot' ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
      # Extra flags taken from dh_apparmor:
      # > By using '-W -T' we ensure that any abstraction updates are also pulled in.
      # https://wiki.debian.org/AppArmor/Contribute/FirstTimeProfileImport
      apparmor_parser --replace --write-cache --skip-read-cache "$APPARMOR_PROFILE_TARGET"
    fi
  else
    echo "Skipping the installation of the AppArmor profile as this version of AppArmor does not seem to support the bundled profile"
  fi
fi

# ---------------------------------------------------------------------------
# NULL // PLAY: external-monitor brightness (ddcutil needs i2c-dev; it loads at
# every boot from /usr/lib/modules-load.d, and now, unless this is a chroot
# such as an ISO build)
# ---------------------------------------------------------------------------
if ! { [ -x /usr/bin/ischroot ] && /usr/bin/ischroot; }; then
  modprobe i2c-dev >/dev/null 2>&1 || true
fi

# ---------------------------------------------------------------------------
# NULL // PLAY: desktop shortcut and taskbar pin
# (`nullplay` and `gamemode` are shipped as files in /usr/bin)
# ---------------------------------------------------------------------------
NP_DESKTOP_FILE=/usr/share/applications/null-play.desktop
NP_TASKBAR_JS=/usr/share/plasma/shells/org.kde.plasma.desktop/contents/updates/null-play-taskbar.js
NP_STATE=/var/lib/null-play
NP_DONE="$NP_STATE/desktop-setup-done"
mkdir -p "$NP_STATE" && touch "$NP_DONE"

# New accounts (and the Null OS live user) get the shortcut from /etc/skel
if [ -f "$NP_DESKTOP_FILE" ]; then
  install -D -m 0755 "$NP_DESKTOP_FILE" /etc/skel/Desktop/null-play.desktop || true
fi

# Existing accounts, once each (a shortcut someone deleted never comes back
# on an upgrade): desktop shortcut, and the taskbar pin right away for anyone
# logged in now. Everyone else gets the pin from Plasma at their next login.
getent passwd | while IFS=: read -r np_user _ np_uid _ _ np_home _; do
  { [ "$np_uid" -ge 1000 ] && [ "$np_uid" -lt 60000 ]; } 2>/dev/null || continue
  [ -d "$np_home" ] || continue
  grep -qxF "$np_user" "$NP_DONE" && continue
  np_desk="$(runuser -u "$np_user" -- xdg-user-dir DESKTOP 2>/dev/null || true)"
  { [ -n "$np_desk" ] && [ "$np_desk" != "$np_home" ]; } || np_desk="$np_home/Desktop"
  if [ -d "$np_desk" ] && [ ! -e "$np_desk/null-play.desktop" ] && [ -f "$NP_DESKTOP_FILE" ]; then
    install -m 0755 -o "$np_user" -g "$(id -gn "$np_user")" "$NP_DESKTOP_FILE" "$np_desk/null-play.desktop" || true
  fi
  np_bus="/run/user/$np_uid/bus"
  if [ -S "$np_bus" ] && [ -f "$NP_TASKBAR_JS" ] && command -v gdbus >/dev/null 2>&1; then
    runuser -u "$np_user" -- env DBUS_SESSION_BUS_ADDRESS="unix:path=$np_bus" \
      timeout 5 gdbus call --session --dest org.kde.plasmashell --object-path /PlasmaShell \
      --method org.kde.PlasmaShell.evaluateScript "$(cat "$NP_TASKBAR_JS")" >/dev/null 2>&1 || true
  fi
  echo "$np_user" >> "$NP_DONE"
done
exit 0
