const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');

// All data lives in ONE json file in the user's profile (never leaves the computer).
const dataDir = () => app.getPath('userData');
const dataFile = () => path.join(dataDir(), 'kindergarten-data.json');
const backupDir = () => path.join(dataDir(), 'backups');
const MAX_BACKUPS = 60;

function ensureDirs() {
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.mkdirSync(backupDir(), { recursive: true });
}

// One snapshot per day (the first save of the day), keep the most recent MAX_BACKUPS.
function dailyBackup() {
  try {
    if (!fs.existsSync(dataFile())) return;
    const stamp = new Date().toISOString().slice(0, 10);
    const target = path.join(backupDir(), `kindergarten-data-${stamp}.json`);
    if (!fs.existsSync(target)) fs.copyFileSync(dataFile(), target);
    const files = fs.readdirSync(backupDir()).filter((f) => f.endsWith('.json')).sort();
    files.slice(0, Math.max(0, files.length - MAX_BACKUPS)).forEach((f) =>
      fs.unlinkSync(path.join(backupDir(), f))
    );
  } catch (e) {
    console.error('Backup failed:', e);
  }
}

// Write to a temp file then rename, so a crash/power cut mid-save can't corrupt the data.
function atomicWrite(file, text) {
  const tmp = file + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

ipcMain.handle('data:load', () => {
  ensureDirs();
  if (!fs.existsSync(dataFile())) return { ok: true, data: null };
  try {
    return { ok: true, data: JSON.parse(fs.readFileSync(dataFile(), 'utf8')) };
  } catch (e) {
    // Never silently overwrite a file we couldn't read: set it aside first.
    const broken = dataFile() + `.corrupt-${Date.now()}`;
    try { fs.copyFileSync(dataFile(), broken); } catch (_) {}
    return { ok: false, error: `Could not read saved data (a copy was kept at ${broken}): ${e.message}` };
  }
});

ipcMain.handle('data:save', (_e, data, opts) => {
  try {
    ensureDirs();
    dailyBackup();
    if (opts && opts.snapshot && fs.existsSync(dataFile())) {
      // e.g. right before a Restore overwrites everything: keep the current state too.
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      fs.copyFileSync(dataFile(), path.join(backupDir(), `kindergarten-data-${ts}-before-restore.json`));
    }
    atomicWrite(dataFile(), JSON.stringify(data, null, 2));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('data:info', () => ({ file: dataFile(), backups: backupDir() }));
ipcMain.handle('data:openFolder', () => shell.openPath(dataDir()));

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    title: 'Kindergarten Manager',
    backgroundColor: '#f6f7fb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // Never navigate away or open new windows from inside the app.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
}

if (!app.requestSingleInstanceLock()) {
  app.quit(); // two copies writing the same file would lose data
} else {
  app.on('second-instance', () => {
    const [w] = BrowserWindow.getAllWindows();
    if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
  });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'File', submenu: [{ role: 'quit' }] },
      { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    ]));
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
