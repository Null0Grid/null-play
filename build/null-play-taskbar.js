// NULL // PLAY: pin to the Plasma taskbar.
// Installed to plasma-desktop's updates/ folder, so Plasma runs it once per
// user at their next login; the installer also runs it right away for anyone
// logged in. Safe to run again: it only adds the launcher where it's missing.
var LAUNCHER = 'applications:null-play.desktop';
var TASK_WIDGETS = ['org.kde.plasma.taskmanager', 'org.kde.plasma.icontasks'];
panels().forEach(function (panel) {
  panel.widgets().forEach(function (w) {
    if (TASK_WIDGETS.indexOf(w.type) === -1) return;
    w.currentConfigGroup = ['General'];
    var cur = w.readConfig('launchers', []);
    var list = Array.isArray(cur) ? cur.slice() : String(cur || '').split(',');
    list = list.filter(function (s) { return s && s.length; });
    if (list.indexOf(LAUNCHER) !== -1) return;
    list.push(LAUNCHER);
    w.writeConfig('launchers', list);
    if (typeof w.reloadConfig === 'function') w.reloadConfig();
  });
});
