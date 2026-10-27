'use strict';

// Estate Tracker — desktop app. Runs the same engine as the server (src/) inside the app:
// the panel is served on 127.0.0.1 (random free port) and portals are searched from this computer.

const { app, BrowserWindow, Tray, Menu, Notification, shell, dialog, nativeImage, session } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const APP_ID = 'pl.estatetracker.app';
const pkg = require('../package.json');

// Tests can point the app at a separate data folder.
if (process.env.ET_USER_DATA) app.setPath('userData', process.env.ET_USER_DATA);

// Only one copy of the app at a time (a second launch focuses the first one).
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// ---- data folder & engine mode (must be set before the engine modules are loaded) ----
const userData = app.getPath('userData'); // macOS: ~/Library/Application Support/Estate Tracker, Windows: %APPDATA%\Estate Tracker
process.env.ET_DESKTOP = '1';
process.env.DATA_DIR = path.join(userData, 'data');
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });

// ---- log file (the packaged app has no console) ----
const logDir = path.join(userData, 'logs');
fs.mkdirSync(logDir, { recursive: true });
const logFile = path.join(logDir, 'estate-tracker.log');
try {
  if (fs.existsSync(logFile) && fs.statSync(logFile).size > 5 * 1024 * 1024) fs.renameSync(logFile, `${logFile}.1`);
} catch {}
for (const level of ['log', 'error', 'warn']) {
  const orig = console[level].bind(console);
  console[level] = (...args) => {
    orig(...args);
    try {
      fs.appendFileSync(logFile, `${args.map((a) => (a instanceof Error ? a.stack : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`);
    } catch {}
  };
}

// ---- desktop preferences (desktop.json in the user data folder) ----
const prefsFile = path.join(userData, 'desktop.json');
const DEFAULT_PREFS = { runInBackground: false, autostart: false, dismissedVersion: null };
function loadPrefs() {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(fs.readFileSync(prefsFile, 'utf8')) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}
let prefs = loadPrefs();
function savePrefs() {
  fs.writeFileSync(prefsFile, JSON.stringify(prefs, null, 2));
}

let win = null;
let tray = null;
let baseUrl = null;
let quitting = false;
const liveNotifications = new Set(); // keep references, otherwise clicks on old notifications are lost
let notificationsBlocked = false;

const assets = (name) => path.join(__dirname, 'assets', name);
const isMac = process.platform === 'darwin';
const startedHidden = process.argv.includes('--hidden') || (isMac && app.getLoginItemSettings().wasOpenedAsHidden);

// ---------------------------------------------------------------------------
function createWindow({ show = true } = {}) {
  win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 380,
    minHeight: 500,
    title: 'Estate Tracker',
    show: false,
    backgroundColor: '#0c1016',
    icon: isMac ? undefined : assets('icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  win.on('page-title-updated', (e) => e.preventDefault()); // keep "Estate Tracker" in the title bar
  win.loadURL(`${baseUrl}/`);
  win.once('ready-to-show', () => {
    if (show) win.show();
  });

  // Links to portals and to GitHub open in the normal web browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(baseUrl)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(baseUrl)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  win.on('close', (e) => {
    if (prefs.runInBackground && !quitting) {
      e.preventDefault();
      win.hide();
      if (isMac) app.dock?.hide();
    }
  });
  win.on('closed', () => {
    win = null;
  });
}

function showWindow(hash) {
  if (!win) createWindow({ show: false });
  if (isMac) app.dock?.show();
  if (hash) win.loadURL(`${baseUrl}/${hash}`);
  win.show();
  if (win.isMinimized()) win.restore();
  win.focus();
}

// ---------------------------------------------------------------------------
function updateTray() {
  if (!prefs.runInBackground) {
    tray?.destroy();
    tray = null;
    return;
  }
  if (!tray) {
    const img = isMac ? nativeImage.createFromPath(assets('trayTemplate.png')) : nativeImage.createFromPath(assets('tray.png'));
    if (isMac) img.setTemplateImage(true);
    tray = new Tray(img);
    tray.setToolTip('Estate Tracker — sprawdza oferty w tle');
    tray.on('click', () => {
      if (!isMac) showWindow();
    });
  }
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Otwórz Estate Tracker', click: () => showWindow() },
      { label: 'Sprawdź teraz', click: () => require('../src/checker').runAll('ręcznie z zasobnika').catch(() => {}) },
      { type: 'separator' },
      {
        label: 'Zakończ',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ])
  );
}

function setAutostart(on) {
  try {
    if (!!app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin === on) return; // nothing to change
    app.setLoginItemSettings({ openAtLogin: on, openAsHidden: on, args: on ? ['--hidden'] : [] });
  } catch (e) {
    console.error('[autostart]', e.message);
  }
}

// Bridge used by the panel's settings page (/api/desktop).
const bridge = {
  getState: () => ({
    runInBackground: prefs.runInBackground,
    autostart: prefs.autostart,
    version: app.getVersion(),
    dataDir: process.env.DATA_DIR,
    platform: process.platform,
    notificationsSupported: Notification.isSupported(),
    notificationsBlocked,
  }),
  testNotification() {
    notify({ title: 'Estate Tracker — test', body: 'Tak będą wyglądać powiadomienia o nowych ofertach. Kliknij, aby otworzyć aplikację.', onClick: () => showWindow('#/') });
  },
  setState(patch) {
    if (typeof patch.runInBackground === 'boolean') prefs.runInBackground = patch.runInBackground;
    if (typeof patch.autostart === 'boolean') prefs.autostart = patch.autostart;
    // Starting at login only makes sense when the app can keep running without a window, and vice versa.
    if (patch.autostart === true) prefs.runInBackground = true;
    if (patch.runInBackground === false) prefs.autostart = false;
    savePrefs();
    setAutostart(prefs.autostart);
    updateTray();
  },
};

// ---------------------------------------------------------------------------
function fmtPrice(n) {
  return n ? `${Math.round(n).toLocaleString('pl-PL').replace(/ /g, ' ')} zł` : 'cena nieznana';
}

function notify({ title, body, onClick }) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: isMac ? undefined : assets('icon.png'), silent: false });
  liveNotifications.add(n);
  const drop = () => setTimeout(() => liveNotifications.delete(n), 60 * 60 * 1000);
  n.on('click', () => {
    liveNotifications.delete(n);
    onClick?.();
  });
  n.on('close', drop);
  n.on('failed', (e, err) => {
    console.error('[powiadomienie] nie wyświetlono:', err);
    notificationsBlocked = true; // shown in the panel with instructions
  });
  n.on('show', () => {
    notificationsBlocked = false;
    console.log(`[powiadomienie] ${title}`);
  });
  n.show();
}

function setupNotifications() {
  const events = require('../src/events');
  const MAX = 5; // a burst of offers: a few individual notifications + one summary
  events.on('offers', ({ search, offers, more }) => {
    offers.slice(0, MAX).forEach((o) => {
      const parts = [fmtPrice(o.price), o.area ? `${Math.round(o.area)} m²` : null, o.location].filter(Boolean).join(' · ');
      notify({
        title: `Nowa oferta: ${search.name}`,
        body: `${parts}\n${o.title || ''} (${o.portal})`,
        onClick: () => showWindow(`#/offer/${encodeURIComponent(search.id)}/${encodeURIComponent(o.key)}`),
      });
    });
    const rest = Math.max(0, offers.length - MAX) + (more || 0);
    if (rest > 0) {
      notify({
        title: `Estate Tracker: jeszcze ${rest} nowych ofert`,
        body: search.name,
        onClick: () => showWindow(`#/offers?search=${encodeURIComponent(search.id)}`),
      });
    }
  });
  events.on('warning', (text) => notify({ title: 'Estate Tracker — ostrzeżenie', body: text, onClick: () => showWindow('#/') }));
}

// ---------------------------------------------------------------------------
// New version check (GitHub Releases). The repository is set in package.json → estateTracker.updateRepo.
function newer(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number);
  const pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

async function checkForUpdate() {
  const repo = pkg.estateTracker?.updateRepo;
  if (!repo) return;
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { 'user-agent': `EstateTracker/${app.getVersion()}`, accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return; // no releases yet / private repo / offline — nothing to say
    const rel = await res.json();
    const latest = String(rel.tag_name || '').replace(/^v/, '');
    if (!latest || !newer(latest, app.getVersion()) || prefs.dismissedVersion === latest) return;
    const { response } = await dialog.showMessageBox(win && win.isVisible() ? win : undefined, {
      type: 'info',
      title: 'Dostępna nowa wersja',
      message: `Jest nowa wersja Estate Tracker: ${latest} (masz ${app.getVersion()}).`,
      detail: 'Pobierz ją i zainstaluj tak jak poprzednią — Twoje wyszukiwania i ustawienia zostaną zachowane.',
      buttons: ['Pobierz', 'Później', 'Nie przypominaj o tej wersji'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) shell.openExternal(rel.html_url || `https://github.com/${repo}/releases/latest`);
    if (response === 2) {
      prefs.dismissedVersion = latest;
      savePrefs();
    }
  } catch (e) {
    console.log('[aktualizacja] nie sprawdzono:', e.message);
  }
}

// ---------------------------------------------------------------------------
function buildMenu() {
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' },
    {
      label: 'Widok',
      submenu: [{ role: 'reload', label: 'Odśwież' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }],
    },
    {
      label: 'Pomoc',
      submenu: [
        { label: 'Otwórz folder z danymi', click: () => shell.openPath(userData) },
        { label: 'Otwórz plik dziennika', click: () => shell.openPath(logFile) },
        { label: 'Narzędzia programisty', role: 'toggleDevTools' },
        ...(pkg.estateTracker?.updateRepo ? [{ label: 'Strona z wersjami', click: () => shell.openExternal(`https://github.com/${pkg.estateTracker.updateRepo}/releases`) }] : []),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
app.on('second-instance', () => showWindow());

app.on('before-quit', () => {
  quitting = true;
});

app.on('window-all-closed', () => {
  if (!prefs.runInBackground) app.quit();
});

app.on('activate', () => showWindow());

app.whenReady().then(async () => {
  app.setAppUserModelId(APP_ID); // Windows: notifications are attributed to the app
  buildMenu();
  const token = crypto.randomBytes(24).toString('hex');
  let port;
  try {
    ({ port } = await require('../src/app').start({ host: '127.0.0.1', port: 0, desktop: { token, bridge } }));
  } catch (e) {
    dialog.showErrorBox('Estate Tracker nie mógł wystartować', String(e.stack || e));
    app.exit(1);
    return;
  }
  baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Estate Tracker ${app.getVersion()}: panel ${baseUrl}, dane ${process.env.DATA_DIR}`);
  await session.defaultSession.cookies.set({ url: baseUrl, name: 'et_token', value: token, httpOnly: true, sameSite: 'strict' });

  // "Eksportuj": ask where to save the .json file.
  session.defaultSession.on('will-download', (e, item) => {
    item.setSaveDialogOptions({ title: 'Zapisz wyszukiwania', defaultPath: path.join(app.getPath('documents'), item.getFilename()) });
  });

  setupNotifications();
  updateTray();
  setAutostart(prefs.autostart);
  const hidden = startedHidden && prefs.runInBackground;
  createWindow({ show: !hidden });
  if (hidden && isMac) app.dock?.hide();
  setTimeout(checkForUpdate, 8000);
});
