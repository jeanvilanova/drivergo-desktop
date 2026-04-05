import { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage, autoUpdater } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import chokidar from 'chokidar';
import {
  getSyncFolders, addSyncFolder, removeSyncFolder,
  setSyncUserId, getSyncUserId,
  type SyncFolderConfig,
} from './lib/sync-store';
import { uploadFileFromDisk, walkFolder, listRemotePaths } from './lib/uploader-main';
import {
  setLogPush, getEntries, clearEntries,
  logInfo, logSuccess, logWarn, logError,
  type LogEntry,
} from './lib/logger';
import {
  getBackupConfigs, addBackupConfig, updateBackupConfig, removeBackupConfig, isDue,
  type BackupConfig,
} from './lib/backup-store';
import { runBackup } from './lib/backup-runner';
import { getDriveConfig, saveDriveConfig } from './lib/drive-store';
import {
  mapDrive, unmapDrive, restoreDriveOnStartup, getDriveStatus,
  syncMyFilesToDrive, syncSharedFilesToDrive, setDriveProgressCallback,
  type DriveSyncProgress,
} from './lib/drive-mapper';
import { listCloudFiles, listSharedWithMe, generateShareLink } from './lib/uploader-main';

// ─── Squirrel installer events ────────────────────────────────────────────────
// Handles install/update/uninstall events and shows a branded splash window.
function handleSquirrelEvent(): boolean {
  if (process.platform !== 'win32') return false;
  const squirrelEvent = process.argv[1];
  if (!squirrelEvent?.startsWith('--squirrel')) return false;

  const updateExe = path.resolve(path.dirname(process.execPath), '..', 'Update.exe');
  const exeName   = path.basename(process.execPath);

  const spawnUpdate = (...args: string[]) => {
    try { execFile(updateExe, args); } catch { /* non-fatal */ }
  };

  const installSplashHtml = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #0d1117; color: #fff;
    font-family: 'Segoe UI', system-ui, sans-serif;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    height: 100vh; gap: 18px; user-select: none;
    -webkit-app-region: drag;
  }
  .cloud { margin-bottom: 4px; }
  .logo { font-size: 30px; font-weight: 900; letter-spacing: -1px; line-height: 1; }
  .logo .drive { color: #fff; }
  .logo .go    { color: #5caeff; }
  .tagline { font-size: 12px; color: #5a7a9a; }
  .status {
    font-size: 12px; color: #8899b4; min-height: 18px;
    transition: opacity .3s;
  }
  .bar-outer {
    width: 220px; height: 3px; border-radius: 3px;
    background: rgba(255,255,255,.08);
  }
  .bar-inner {
    height: 100%; border-radius: 3px; background: #5caeff;
    transition: width .5s ease;
  }
  .version { font-size: 10px; color: #3a4a5a; margin-top: 4px; }
</style></head>
<body>
  <svg class="cloud" width="52" height="38" viewBox="0 0 14 10" fill="none">
    <path d="M7 0C4.8 0 3 1.8 3 4c0 .3.1.7.2 1A2 2 0 0 0 3 9h8a1.5 1.5 0 0 0 .1-3A3 3 0 0 0 7 0z" fill="#5caeff" opacity=".9"/>
  </svg>
  <div class="logo"><span class="drive">Drive</span><span class="go">GO</span></div>
  <div class="tagline">Sincronização e backup em nuvem</div>
  <div class="status" id="status">Preparando instalação…</div>
  <div class="bar-outer"><div class="bar-inner" id="bar" style="width:0%"></div></div>
  <div class="version">Versão 1.0.0 · SuporteGO</div>
  <script>
    const steps = [
      [10,  'Criando arquivos do sistema…'],
      [30,  'Registrando o aplicativo…'],
      [55,  'Criando atalhos na Área de Trabalho…'],
      [70,  'Configurando inicialização automática…'],
      [88,  'Aplicando configurações finais…'],
      [100, 'Instalação concluída!'],
    ];
    const bar = document.getElementById('bar');
    const status = document.getElementById('status');
    let i = 0;
    function next() {
      if (i >= steps.length) return;
      const [pct, msg] = steps[i++];
      bar.style.width = pct + '%';
      status.textContent = msg;
      if (i < steps.length) setTimeout(next, 600);
    }
    setTimeout(next, 300);
  </script>
</body></html>`;

  app.on('ready', () => {
    const win = new BrowserWindow({
      width: 420, height: 340,
      frame: false, resizable: false, center: true,
      backgroundColor: '#0d1117',
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(installSplashHtml)}`);

    switch (squirrelEvent) {
      case '--squirrel-install':
      case '--squirrel-updated':
        spawnUpdate('--createShortcut', exeName);
        break;
      case '--squirrel-uninstall':
        spawnUpdate('--removeShortcut', exeName);
        break;
    }

    // Show splash for 3.5 s then quit
    setTimeout(() => app.quit(), 3500);
  });

  return true;
}

if (handleSquirrelEvent()) {
  // Squirrel event: splash is shown, app will quit after 3.5 s
} else {

// ─── State ──────────────────────────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

// ── Startup status helper — feeds the renderer splash screen ─────────────────
function sendStartupStatus(msg: string) {
  mainWindow?.webContents.send('app:status', msg);
}

// Iniciado pelo Windows com --hidden → começa minimizado na bandeja
const startHidden = process.argv.includes('--hidden');

// Resolve o caminho do ícone em dev e em produção (packaged)
function getIconPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'assets', 'icon.ico');
  }
  return path.join(app.getAppPath(), 'assets', 'icon.ico');
}

interface FolderStatus {
  localPath: string;
  status: 'idle' | 'syncing' | 'error' | 'watching';
  pendingFiles: number;
  syncedFiles: number;
  totalFiles: number;
  lastSynced: string | null;
  errorMessage: string | null;
}

const statusMap      = new Map<string, FolderStatus>();
const watchers       = new Map<string, chokidar.FSWatcher>();
const debounceTimers = new Map<string, NodeJS.Timeout>();
const uploadQueues   = new Map<string, Set<string>>();
const activeUploads  = new Map<string, boolean>();

// Track which folders already received their initial sync this session
const initialSyncDone = new Set<string>();

// ─── Tray ────────────────────────────────────────────────────────────────────
function createTray() {
  const icon = nativeImage.createFromPath(getIconPath());
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('DriveGO — Sincronização em nuvem');

  const buildMenu = () => Menu.buildFromTemplate([
    {
      label: mainWindow?.isVisible() ? 'Ocultar DriveGO' : 'Mostrar DriveGO',
      click: () => toggleWindow(),
    },
    { type: 'separator' },
    {
      label: 'Sair',
      click: () => { isQuitting = true; app.quit(); },
    },
  ]);

  // Recria o menu cada vez que o usuário clica com botão direito (para atualizar label)
  tray.on('right-click', () => tray?.setContextMenu(buildMenu()));
  tray.setContextMenu(buildMenu());

  // Clique simples no ícone: mostra/oculta a janela
  tray.on('click', () => toggleWindow());
}

function toggleWindow() {
  if (!mainWindow) return;
  if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

// ─── Window ─────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 800,
    minHeight: 560,
    backgroundColor: '#0d1117',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#111820',
      symbolColor: '#5caeff',
      height: 40,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Wire up the log push → send to renderer
  setLogPush((entry: LogEntry) => {
    mainWindow?.webContents.send('log:entry', entry);
  });

  // Wire up drive sync progress → send to renderer
  setDriveProgressCallback((progress: DriveSyncProgress) => {
    mainWindow?.webContents.send('drive:progress', progress);
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  // Fechar a janela minimiza para a bandeja em vez de encerrar
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
      tray?.displayBalloon?.({
        title: 'DriveGO',
        content: 'Continua em execução na bandeja do sistema.',
        iconType: 'info',
      });
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  // Iniciar minimizado na bandeja se chamado pelo Windows na inicialização
  if (startHidden) {
    mainWindow.hide();
  }

  logInfo('sistema', 'Aplicativo iniciado', app.getVersion());
}

// ─── Status helpers ──────────────────────────────────────────────────────────
function pushStatus(localPath: string) {
  if (!mainWindow) return;
  const s = statusMap.get(localPath);
  if (s) mainWindow.webContents.send('sync:status', s);
}

function setStatus(localPath: string, patch: Partial<FolderStatus>) {
  const current = statusMap.get(localPath) ?? {
    localPath,
    status: 'idle' as const,
    pendingFiles: 0,
    syncedFiles: 0,
    totalFiles: 0,
    lastSynced: null,
    errorMessage: null,
  };
  statusMap.set(localPath, { ...current, ...patch });
  pushStatus(localPath);
}

// ─── Upload queue processor ──────────────────────────────────────────────────
async function processQueue(folder: SyncFolderConfig) {
  const { localPath, remotePrefix } = folder;
  const userId = getSyncUserId();
  if (!userId) return;
  if (activeUploads.get(localPath)) return;

  const queue = uploadQueues.get(localPath);
  if (!queue || queue.size === 0) {
    setStatus(localPath, { status: 'watching', pendingFiles: 0 });
    return;
  }

  activeUploads.set(localPath, true);
  setStatus(localPath, { status: 'syncing', pendingFiles: queue.size });

  const files = [...queue];
  let synced = 0;

  for (const filePath of files) {
    queue.delete(filePath);
    const fileName = path.basename(filePath);
    try {
      const relative   = path.relative(localPath, filePath).replace(/\\/g, '/');
      const remotePath = remotePrefix + relative;
      await uploadFileFromDisk(userId, filePath, remotePath);
      synced++;
      setStatus(localPath, {
        status: 'syncing',
        pendingFiles: queue.size,
        syncedFiles: synced,
        errorMessage: null,
      });
      logSuccess('upload', `Arquivo enviado: ${fileName}`, remotePath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError('upload', `Falha ao enviar: ${fileName}`, msg);
    }
  }

  setStatus(localPath, {
    status: queue.size > 0 ? 'syncing' : 'watching',
    pendingFiles: queue.size,
    lastSynced: new Date().toISOString(),
    errorMessage: null,
  });

  activeUploads.set(localPath, false);

  if (queue.size > 0) await processQueue(folder);
}

function scheduleUpload(folder: SyncFolderConfig, filePath: string) {
  const { localPath } = folder;
  const key = `${localPath}:${filePath}`;

  if (debounceTimers.has(key)) clearTimeout(debounceTimers.get(key)!);

  const timer = setTimeout(() => {
    debounceTimers.delete(key);
    let q = uploadQueues.get(localPath);
    if (!q) { q = new Set(); uploadQueues.set(localPath, q); }
    q.add(filePath);
    logInfo('sync', `Mudança detectada: ${path.basename(filePath)}`, localPath);
    processQueue(folder);
  }, 2500);

  debounceTimers.set(key, timer);
}

// ─── Watcher management ──────────────────────────────────────────────────────
function startWatcher(folder: SyncFolderConfig) {
  const { localPath } = folder;
  if (watchers.has(localPath)) return;

  if (!fs.existsSync(localPath)) {
    setStatus(localPath, { status: 'error', errorMessage: 'Pasta não encontrada' });
    logError('pasta', `Pasta não encontrada: ${folder.name}`, localPath);
    return;
  }

  setStatus(localPath, { status: 'watching', pendingFiles: 0 });
  logInfo('pasta', `Monitorando pasta: ${folder.name}`, localPath);

  const watcher = chokidar.watch(localPath, {
    ignored: /(^|[/\\])\../,
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 500 },
  });

  watcher.on('add',    (fp) => scheduleUpload(folder, fp));
  watcher.on('change', (fp) => scheduleUpload(folder, fp));
  watcher.on('error',  (err) => {
    const msg = String(err);
    setStatus(localPath, { status: 'error', errorMessage: msg });
    logError('pasta', `Erro no monitoramento: ${folder.name}`, msg);
  });

  watchers.set(localPath, watcher);
}

function stopWatcher(localPath: string) {
  const w = watchers.get(localPath);
  if (w) { w.close(); watchers.delete(localPath); }
  uploadQueues.delete(localPath);
  statusMap.delete(localPath);
  initialSyncDone.delete(localPath);
}

// ─── Initial/differential sync ────────────────────────────────────────────────
// Compares local files against what's already in the cloud and uploads only
// what's missing. This ensures files created while the app was closed are
// always uploaded without re-sending files that are already synced.
async function doInitialSync(folder: SyncFolderConfig, forceAll = false) {
  const { localPath } = folder;
  const userId = getSyncUserId();
  if (!userId) return;

  const localFiles = walkFolder(localPath);
  if (localFiles.length === 0) {
    logInfo('sync', `Pasta vazia: ${folder.name}`);
    setStatus(localPath, { status: 'watching', pendingFiles: 0, syncedFiles: 0, totalFiles: 0 });
    return;
  }

  // Fetch the set of remote paths already in the cloud for this folder prefix
  logInfo('sync', `Verificando arquivos na nuvem: ${folder.name}`);
  const remoteSet = forceAll ? new Set<string>() : await listRemotePaths(userId, folder.remotePrefix);

  // Filter to only files not yet in the cloud
  const pending = localFiles.filter((filePath) => {
    const relative   = path.relative(localPath, filePath).replace(/\\/g, '/');
    const remotePath = folder.remotePrefix + relative;
    return !remoteSet.has(remotePath);
  });

  if (pending.length === 0) {
    logSuccess('sync', `Tudo sincronizado: ${folder.name}`, `${localFiles.length} arquivo(s) já na nuvem`);
    setStatus(localPath, {
      status: 'watching',
      pendingFiles: 0,
      syncedFiles: localFiles.length,
      totalFiles: localFiles.length,
      lastSynced: new Date().toISOString(),
    });
    return;
  }

  logInfo('sync', `Sincronização iniciada: ${folder.name}`,
    `${pending.length} novo(s) de ${localFiles.length} total`);
  setStatus(localPath, {
    status: 'syncing',
    totalFiles: pending.length,
    syncedFiles: 0,
    pendingFiles: pending.length,
  });

  let done = 0;
  for (const filePath of pending) {
    const fileName = path.basename(filePath);
    try {
      const relative   = path.relative(localPath, filePath).replace(/\\/g, '/');
      const remotePath = folder.remotePrefix + relative;
      await uploadFileFromDisk(userId, filePath, remotePath);
      done++;
      setStatus(localPath, {
        status: 'syncing',
        syncedFiles: done,
        pendingFiles: pending.length - done,
        totalFiles: pending.length,
      });
      logSuccess('upload', `Enviado: ${fileName}`, `${done}/${pending.length}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError('upload', `Falha: ${fileName}`, msg);
    }
  }

  setStatus(localPath, {
    status: 'watching',
    pendingFiles: 0,
    syncedFiles: done,
    totalFiles: pending.length,
    lastSynced: new Date().toISOString(),
  });

  logSuccess('sync', `Sincronização concluída: ${folder.name}`,
    `${done}/${pending.length} arquivo(s) enviado(s)`);
}

// ─── Start saved watchers at launch (before userId is known) ─────────────────
function startSavedWatchers() {
  const folders = getSyncFolders();
  if (folders.length === 0) return;
  logInfo('sistema', `Carregando ${folders.length} pasta(s) salva(s)`);
  for (const folder of folders) {
    if (folder.enabled) startWatcher(folder);
  }
}

// ─── IPC Handlers ────────────────────────────────────────────────────────────

ipcMain.handle('dialog:openFiles', async () => {
  if (!mainWindow) return [];
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    title: 'Selecionar arquivos para upload',
  });
  return canceled ? [] : filePaths;
});

ipcMain.handle('shell:openExternal', (_e, url: string) => shell.openExternal(url));

ipcMain.handle('dialog:savePath', async (_e, defaultName: string) => {
  if (!mainWindow) return null;
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, { defaultPath: defaultName });
  return canceled ? null : filePath;
});

// Set current user — also triggers auto-sync for all saved folders
ipcMain.handle('sync:setUser', (_e, userId: string) => {
  setSyncUserId(userId);
  logInfo('sistema', `Usuário autenticado: ${userId.slice(0, 8)}…`);

  // Trigger drive file sync once per session (after auth)
  const driveCfgOnAuth = getDriveConfig();
  if (driveCfgOnAuth.enabled) {
    syncMyFilesToDrive(userId).catch(console.error);
    syncSharedFilesToDrive(userId).catch(console.error);
  }

  const folders = getSyncFolders();
  for (const folder of folders) {
    if (!folder.enabled) continue;

    // Ensure watcher is running
    if (!watchers.has(folder.localPath)) startWatcher(folder);

    // Auto-sync once per session per folder
    if (!initialSyncDone.has(folder.localPath)) {
      initialSyncDone.add(folder.localPath);
      logInfo('sync', `Sincronização automática agendada: ${folder.name}`);
      doInitialSync(folder).catch((err) => {
        logError('sync', `Erro na sincronização automática: ${folder.name}`, String(err));
      });
    }
  }
});

ipcMain.handle('sync:getFolders', () => {
  const folders = getSyncFolders();
  return folders.map((f) => ({
    ...f,
    status: statusMap.get(f.localPath) ?? {
      localPath: f.localPath,
      status: 'idle',
      pendingFiles: 0,
      syncedFiles: 0,
      totalFiles: 0,
      lastSynced: null,
      errorMessage: null,
    },
  }));
});

ipcMain.handle('sync:getDefaultFolders', () => [
  { name: 'Documentos',       path: app.getPath('documents') },
  { name: 'Imagens',          path: app.getPath('pictures') },
  { name: 'Área de Trabalho', path: app.getPath('desktop') },
  { name: 'Downloads',        path: app.getPath('downloads') },
  { name: 'Vídeos',           path: app.getPath('videos') },
  { name: 'Músicas',          path: app.getPath('music') },
]);

ipcMain.handle('sync:pickFolder', async () => {
  if (!mainWindow) return null;
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Selecionar pasta para sincronizar',
  });
  return canceled ? null : filePaths[0];
});

ipcMain.handle('sync:addFolder', async (_e, localPath: string, name: string) => {
  const remotePrefix = `sync/${name}/`;
  const folder: SyncFolderConfig = {
    localPath, name, remotePrefix, enabled: true, addedAt: new Date().toISOString(),
  };
  addSyncFolder(folder);
  logInfo('pasta', `Pasta adicionada: ${name}`, localPath);
  startWatcher(folder);
  initialSyncDone.add(localPath); // mark as handled — doInitialSync below covers it
  doInitialSync(folder).catch(console.error);
  return {
    ...folder,
    status: statusMap.get(localPath) ?? {
      localPath,
      status: 'syncing',
      pendingFiles: 0, syncedFiles: 0, totalFiles: 0,
      lastSynced: null, errorMessage: null,
    },
  };
});

ipcMain.handle('sync:removeFolder', (_e, localPath: string) => {
  const folders = getSyncFolders();
  const folder  = folders.find((f) => f.localPath === localPath);
  logWarn('pasta', `Pasta removida: ${folder?.name ?? localPath}`);
  stopWatcher(localPath);
  removeSyncFolder(localPath);
});

ipcMain.handle('sync:resync', async (_e, localPath: string) => {
  const folder = getSyncFolders().find((f) => f.localPath === localPath);
  if (!folder) return;
  logInfo('sync', `Ressincronização manual: ${folder.name}`);
  await doInitialSync(folder, true); // forceAll=true — re-upload everything
});

// Log IPC
ipcMain.handle('log:getEntries', () => getEntries());
ipcMain.handle('log:clear',      () => clearEntries());

// ─── Drive / Unidade Mapeada IPC ─────────────────────────────────────────────
ipcMain.handle('drive:getConfig', () => getDriveConfig());

ipcMain.handle('drive:setConfig', async (_e, cfg: { letter: string; enabled: boolean }) => {
  saveDriveConfig(cfg);
});

ipcMain.handle('drive:map', async (_e, letter: string) => {
  await mapDrive(letter);
  saveDriveConfig({ letter, enabled: true });
});

ipcMain.handle('drive:unmap', async (_e, letter: string) => {
  await unmapDrive(letter);
  saveDriveConfig({ letter, enabled: false });
});

ipcMain.handle('drive:getStatus', () => getDriveStatus());

ipcMain.handle('drive:syncNow', async () => {
  const userId = getSyncUserId();
  if (!userId) throw new Error('Usuário não autenticado');
  syncMyFilesToDrive(userId).catch(console.error);
  syncSharedFilesToDrive(userId).catch(console.error);
});

ipcMain.handle('drive:listMyFiles', async (_e, prefix: string) => {
  const userId = getSyncUserId();
  if (!userId) return [];
  return listCloudFiles(userId, prefix, false);
});

ipcMain.handle('drive:listSharedWithMe', async () => {
  const userId = getSyncUserId();
  if (!userId) return [];
  return listSharedWithMe(userId);
});

ipcMain.handle('drive:generateShareLink', async (_e, filePath: string, isFolder: boolean) => {
  const userId = getSyncUserId();
  if (!userId) throw new Error('Usuário não autenticado');
  return generateShareLink(userId, filePath, isFolder);
});

ipcMain.handle('drive:openFolder', (_e, subfolder: 'mine' | 'shared') => {
  const { getDriveRoot } = require('./lib/drive-store');
  const root = getDriveRoot();
  const target = subfolder === 'mine'
    ? require('node:path').join(root, 'Meus Arquivos')
    : require('node:path').join(root, 'Compartilhado comigo');
  shell.openPath(target);
});

// ─── Backup IPC ───────────────────────────────────────────────────────────────
ipcMain.handle('backup:getConfigs', () => getBackupConfigs());

ipcMain.handle('backup:saveConfig', (_e, cfg: BackupConfig) => {
  const exists = getBackupConfigs().some((c) => c.id === cfg.id);
  if (exists) {
    updateBackupConfig(cfg.id, cfg);
  } else {
    addBackupConfig(cfg);
  }
});

ipcMain.handle('backup:removeConfig', (_e, id: string) => {
  removeBackupConfig(id);
});

ipcMain.handle('backup:runNow', async (_e, id: string) => {
  const cfg    = getBackupConfigs().find((c) => c.id === id);
  if (!cfg) return;
  const userId = getSyncUserId();
  if (!userId) throw new Error('Usuário não autenticado');
  await runBackup(cfg, userId);
});

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.on('ready', () => {
  // Registrar para iniciar automaticamente com o Windows (minimizado)
  app.setLoginItemSettings({
    openAtLogin: true,
    args: ['--hidden'],   // abre direto na bandeja
  });

  createWindow();
  createTray();

  // Send startup status messages to renderer splash screen
  sendStartupStatus('Inicializando DriveGO…');

  setTimeout(() => {
    sendStartupStatus('Carregando configurações…');
  }, 200);

  setTimeout(() => {
    sendStartupStatus('Iniciando monitoramento de pastas…');
    startSavedWatchers();
  }, 500);

  setTimeout(() => {
    // ── Auto-restore drive mapping on startup ────────────────────────────────
    const driveCfg = getDriveConfig();
    if (driveCfg.enabled) {
      sendStartupStatus(`Restaurando unidade ${driveCfg.letter}:…`);
      restoreDriveOnStartup(driveCfg.letter).catch(console.error);
    } else {
      sendStartupStatus('Verificando sessão…');
    }
  }, 900);

  setTimeout(() => sendStartupStatus('Pronto.'), 1400);

  // ── Auto-updater (Squirrel.Windows via update.electronjs.org) ───────────────
  if (app.isPackaged) {
    const feedURL = `https://update.electronjs.org/jeanvilanova/drivergo-desktop/win32/${app.getVersion()}`;
    try {
      autoUpdater.setFeedURL({ url: feedURL });

      autoUpdater.on('update-downloaded', (_event, _notes, releaseName) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (!win) { autoUpdater.quitAndInstall(); return; }

        dialog.showMessageBox(win, {
          type: 'info',
          title: 'Atualização disponível',
          message: `Nova versão ${releaseName} baixada.`,
          detail: 'O DriveGO será reiniciado para aplicar a atualização.',
          buttons: ['Reiniciar agora', 'Mais tarde'],
          defaultId: 0,
        }).then(({ response }) => {
          if (response === 0) autoUpdater.quitAndInstall();
        });
      });

      autoUpdater.on('error', (err) => {
        logWarn('sistema', 'AutoUpdater erro', String(err));
      });

      // Check on startup, then every 4 hours
      setTimeout(() => autoUpdater.checkForUpdates(), 10_000);
      setInterval(() => autoUpdater.checkForUpdates(), 4 * 60 * 60 * 1000);
    } catch (err) {
      logWarn('sistema', 'AutoUpdater não disponível', String(err));
    }
  }

  // ── Backup scheduler — checks every minute if a backup is due ──────────────
  setInterval(() => {
    const userId = getSyncUserId();
    if (!userId) return;
    for (const cfg of getBackupConfigs()) {
      if (isDue(cfg)) {
        logInfo('backup', `Backup agendado iniciado: ${cfg.name}`);
        runBackup(cfg, userId).catch((err) => {
          logError('backup', `Backup agendado falhou: ${cfg.name}`, String(err));
        });
      }
    }
  }, 60_000);
});

// Não encerrar quando todas as janelas são fechadas — o app fica na bandeja
app.on('window-all-closed', () => {
  // No macOS o comportamento padrão é manter o app aberto sem janelas
  // No Windows/Linux mantemos via tray — só sai quando isQuitting = true
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  isQuitting = true;
  logInfo('sistema', 'Aplicativo encerrado');
  tray?.destroy();
  for (const watcher of watchers.values()) watcher.close();
});

} // end else (non-squirrel startup)
