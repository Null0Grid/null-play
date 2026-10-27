#!/bin/bash

# Delete the link to the binary
# update-alternatives --remove <name> <path>: 'path' must be the registered alternative binary,
# not the generic symlink — see https://man7.org/linux/man-pages/man1/update-alternatives.1.html
if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --remove '${executable}' '/opt/${sanitizedProductName}/${executable}'
else
    rm -f '/usr/bin/${executable}'
fi

APPARMOR_PROFILE_DEST='/etc/apparmor.d/${executable}'

# Remove and unload apparmor profile.
if [ -f "$APPARMOR_PROFILE_DEST" ]; then
  # Unload the profile from the running kernel before deleting the file so the
  # policy is not left enforced until the next reboot.  Mirror the chroot guard
  # used in the after-install script — live AppArmor operations are not
  # meaningful inside a chroot.
  # https://wiki.debian.org/AppArmor/HowToUse
  if apparmor_status --enabled > /dev/null 2>&1; then
    if ! { [ -x '/usr/bin/ischroot' ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
      apparmor_parser --remove "$APPARMOR_PROFILE_DEST" || true
    fi
  fi
  rm -f "$APPARMOR_PROFILE_DEST"
fi
# ---------------------------------------------------------------------------
# NULL // PLAY: on removal (not on upgrade), take away what the installer added
# ---------------------------------------------------------------------------
case "$1" in
  remove|purge)
    rm -f /etc/skel/Desktop/null-play.desktop
    rmdir /etc/skel/Desktop 2>/dev/null || true
    if [ -f /var/lib/null-play/desktop-setup-done ]; then
      while read -r np_user; do
        np_ent="$(getent passwd "$np_user")" || continue
        np_uid="$(echo "$np_ent" | cut -d: -f3)"
        np_home="$(echo "$np_ent" | cut -d: -f6)"
        np_desk="$(runuser -u "$np_user" -- xdg-user-dir DESKTOP 2>/dev/null || true)"
        for f in "$np_home/Desktop/null-play.desktop" "${np_desk:-/nonexistent}/null-play.desktop"; do
          # only our own shortcut, never a file the user made
          if [ -f "$f" ] && grep -q '^Exec=/opt/null-play/null-play' "$f"; then rm -f "$f"; fi
        done
        np_bus="/run/user/$np_uid/bus"
        if [ -S "$np_bus" ] && command -v gdbus >/dev/null 2>&1; then
          runuser -u "$np_user" -- env DBUS_SESSION_BUS_ADDRESS="unix:path=$np_bus" \
            timeout 5 gdbus call --session --dest org.kde.plasmashell --object-path /PlasmaShell \
            --method org.kde.PlasmaShell.evaluateScript "panels().forEach(function(p){p.widgets().forEach(function(w){if(w.type!=='org.kde.plasma.taskmanager'&&w.type!=='org.kde.plasma.icontasks')return;w.currentConfigGroup=['General'];var c=w.readConfig('launchers',[]);var l=(Array.isArray(c)?c:String(c||'').split(',')).filter(function(s){return s&&s!=='applications:null-play.desktop';});w.writeConfig('launchers',l);if(typeof w.reloadConfig==='function')w.reloadConfig();});});" >/dev/null 2>&1 || true
        fi
      done < /var/lib/null-play/desktop-setup-done
    fi
    rm -rf /var/lib/null-play
    ;;
esac
exit 0
