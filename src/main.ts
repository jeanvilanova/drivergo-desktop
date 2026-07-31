import { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage, Notification } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import chokidar from 'chokidar';
import {
  getSyncFolders, addSyncFolder, removeSyncFolder,
  setSyncUserId, getSyncUserId,
  type SyncFolderConfig,
} from './lib/sync-store';
import { uploadFileFromDisk, walkFolder, listRemoteFileEtags, isLockedFileError } from './lib/uploader-main';
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
import { getDriveConfig, saveDriveConfig, getDriveRoot } from './lib/drive-store';
import {
  mapDrive, unmapDrive, restoreDriveOnStartup, getDriveStatus,
  syncMyFilesToDrive, syncSharedFilesToDrive, setDriveProgressCallback,
  type DriveSyncProgress,
} from './lib/drive-mapper';
import { listCloudFiles, listSharedWithMe, generateShareLink } from './lib/uploader-main';
import { activateProfile, deactivateProfile, getProfileConfigPath, type ProfileUser } from './lib/profile-store';
import {
  loadManifest, saveManifest, isUpToDate, markSynced, purgeFolderEntries, getManifestEntry,
  type SyncManifest,
} from './lib/sync-manifest';

// ─── State ──────────────────────────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null;

// ── Sync visual state — tracks active uploads across all folders ─────────────
let activeSyncCount = 0;   // number of folders currently syncing
let syncErrorCount  = 0;   // folders with errors this session

function syncStateChanged() {
  if (!mainWindow) return;

  if (activeSyncCount > 0) {
    // Blue animated progress bar while syncing
    mainWindow.setProgressBar(0.5, { mode: 'indeterminate' });
    tray?.setToolTip(`DriveGO — Sincronizando ${activeSyncCount} pasta${activeSyncCount > 1 ? 's' : ''}…`);
  } else if (syncErrorCount > 0) {
    // Red bar on error
    mainWindow.setProgressBar(1, { mode: 'error' });
    tray?.setToolTip(`DriveGO — ${syncErrorCount} erro${syncErrorCount > 1 ? 's' : ''} de sincronização`);
  } else {
    // Remove progress bar — all clear
    mainWindow.setProgressBar(-1);
    tray?.setToolTip('DriveGO — Sincronização em nuvem');
  }
}

function notifySyncComplete(folderName: string, fileCount: number) {
  if (!Notification.isSupported()) return;
  new Notification({
    title: 'DriveGO — Sincronização concluída',
    body: fileCount === 1
      ? `"${folderName}": 1 arquivo enviado para a nuvem`
      : `"${folderName}": ${fileCount} arquivos enviados para a nuvem`,
    silent: true,
  }).show();
}

function notifyUploadComplete(fileName: string) {
  if (!Notification.isSupported()) return;
  new Notification({
    title: 'DriveGO — Arquivo enviado',
    body: `"${fileName}" foi sincronizado com a nuvem`,
    silent: true,
  }).show();
}

function notifySyncError(folderName: string, errorMsg: string) {
  if (!Notification.isSupported()) return;
  new Notification({
    title: 'DriveGO — Erro de sincronização',
    body: `"${folderName}": ${errorMsg}`,
    silent: false,
    urgency: 'critical',
  }).show();
}

// ── Sync manifest — local cache that tracks which files are already synced ───
// Loaded once per profile activation; saved after each batch of uploads.
let manifest: SyncManifest = { version: 1, entries: {} };
let manifestPath = '';

// Debounced manifest save — prevents excessive disk writes when uploading
// many files in rapid succession.
let manifestSaveTimer: NodeJS.Timeout | null = null;
function scheduleSaveManifest() {
  if (manifestSaveTimer) clearTimeout(manifestSaveTimer);
  manifestSaveTimer = setTimeout(() => {
    if (manifestPath) saveManifest(manifestPath, manifest);
    manifestSaveTimer = null;
  }, 2000);
}
let tray: Tray | null = null;
let isQuitting = false;

// ── Startup status helper — feeds the renderer splash screen ─────────────────
const sendStartupStatus = (msg: string) => {
  mainWindow?.webContents.send('app:status', msg);
}

// Iniciado pelo Windows com --hidden → começa minimizado na bandeja
const startHidden = process.argv.includes('--hidden');

// Resolve o caminho do ícone em dev e em produção (packaged)
const getIconPath = (): string => {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'assets', 'icon.ico');
  }
  return path.join(app.getAppPath(), 'assets', 'icon.ico');
}

// Caminho estável para o auto-start do Windows.
// O electron-wix-msi instala o binário em <root>\app-x.y.z\DriveGo.exe, mas mantém
// um STUB estável em <root>\DriveGo.exe que sempre lança a versão mais recente.
// Registrar o stub (e não o exe versionado) faz o auto-start sobreviver a updates.
const getStableLaunchPath = (): string => {
  const exe = path.basename(process.execPath);
  const dir = path.dirname(process.execPath);
  if (/^app-\d/i.test(path.basename(dir))) {
    const stub = path.join(path.dirname(dir), exe);
    if (fs.existsSync(stub)) return stub;
  }
  return process.execPath;
}

interface FolderStatus {
  localPath: string;
  status: 'idle' | 'syncing' | 'error' | 'watching' | 'paused';
  pendingFiles: number;
  syncedFiles: number;
  totalFiles: number;
  uploadProgress?: number;
  lastSynced: string | null;
  errorMessage: string | null;
}

const statusMap      = new Map<string, FolderStatus>();
const watchers       = new Map<string, chokidar.FSWatcher>();
const debounceTimers = new Map<string, NodeJS.Timeout>();
const uploadQueues   = new Map<string, Set<string>>();
const activeUploads  = new Map<string, boolean>();
const pausedFolders  = new Set<string>(); // pastas com sync pausada

// Track which folders already received their initial sync this session
const initialSyncDone = new Set<string>();

// ─── Update checker ──────────────────────────────────────────────────────────
const RELEASES_API = 'https://api.github.com/repos/jeanvilanova/drivergo-desktop/releases/latest';
const DOWNLOAD_URL = 'https://github.com/jeanvilanova/drivergo-desktop/releases/latest/download/DriveGo-Setup.msi';

let pendingUpdateVersion: string | null = null;
let updateInProgress = false;

function parseVersion(v: string): number[] {
  return v.replace(/^v/, '').split('.').map(Number);
}

function isNewer(remote: string, current: string): boolean {
  const r = parseVersion(remote);
  const c = parseVersion(current);
  for (let i = 0; i < Math.max(r.length, c.length); i++) {
    const diff = (r[i] ?? 0) - (c[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

// Downloads the MSI following redirects, reports progress via callback
async function downloadFile(url: string, dest: string, onProgress: (pct: number) => void): Promise<void> {
  const https = await import('node:https');
  const http  = await import('node:http');

  return new Promise((resolve, reject) => {
    const follow = (currentUrl: string) => {
      const parsed = new URL(currentUrl);
      const transport = parsed.protocol === 'https:' ? https : http;

      transport.get(currentUrl, { headers: { 'User-Agent': `DriveGO/${app.getVersion()}` } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
          follow(res.headers.location!);
          return;
        }
        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }

        const total = parseInt(res.headers['content-length'] ?? '0', 10);
        let received = 0;
        const file = fs.createWriteStream(dest);

        res.on('data', (chunk: Buffer) => {
          received += chunk.length;
          if (total > 0) onProgress(Math.round((received / total) * 100));
        });
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
        file.on('error', reject);
        res.on('error', reject);
      }).on('error', reject);
    };

    follow(url);
  });
}

async function promptAndInstallUpdate(version: string): Promise<void> {
  if (updateInProgress) return;
  updateInProgress = true;

  // Show OK / Cancel dialog
  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: 'Atualização disponível',
    message: `DriveGO ${version} está disponível`,
    detail: 'Deseja baixar e instalar agora? O aplicativo será reiniciado automaticamente.',
    buttons: ['Atualizar agora', 'Cancelar'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });

  if (response !== 0) { updateInProgress = false; return; }

  // Download MSI to temp folder
  const tmpMsi = path.join(app.getPath('temp'), `DriveGo-Setup-${version}.msi`);

  tray?.displayBalloon?.({
    title: 'DriveGO — Baixando atualização',
    content: `Baixando versão ${version}… Aguarde.`,
    iconType: 'info',
  });
  tray?.setToolTip(`DriveGO — Baixando atualização ${version}…`);
  mainWindow?.setProgressBar(0.05, { mode: 'normal' });

  try {
    await downloadFile(DOWNLOAD_URL, tmpMsi, (pct) => {
      mainWindow?.setProgressBar(pct / 100, { mode: 'normal' });
      tray?.setToolTip(`DriveGO — Baixando ${pct}%`);
    });
  } catch (err) {
    updateInProgress = false;
    mainWindow?.setProgressBar(-1);
    tray?.setToolTip('DriveGO — Sincronização em nuvem');
    const msg = err instanceof Error ? err.message : String(err);
    logError('sistema', 'Falha ao baixar atualização', msg);
    dialog.showErrorBox('Erro no download', `Não foi possível baixar a atualização:\n${msg}`);
    return;
  }

  mainWindow?.setProgressBar(1, { mode: 'normal' });
  tray?.setToolTip('DriveGO — Instalando atualização…');
  logInfo('sistema', `Atualização ${version} baixada — iniciando instalação silenciosa`);

  // Launch MSI silently (/quiet = no UI, /norestart = don't reboot automatically)
  // The process is detached so it outlives this app instance.
  const { spawn } = await import('node:child_process');
  const installer = spawn('msiexec', ['/i', tmpMsi, '/quiet', '/norestart'], {
    detached: true,
    stdio: 'ignore',
  });
  installer.unref();

  // Give msiexec a moment to start, then quit
  setTimeout(() => {
    isQuitting = true;
    app.quit();
  }, 1500);
}

async function checkForUpdates(silent = true): Promise<void> {
  try {
    const res = await fetch(RELEASES_API, {
      headers: { 'User-Agent': `DriveGO/${app.getVersion()}` },
    });
    if (!res.ok) return;
    const data = await res.json() as { tag_name: string };
    const remote = data.tag_name;
    if (!isNewer(remote, app.getVersion())) return;

    pendingUpdateVersion = remote;
    rebuildTrayMenu();
    logInfo('sistema', `Nova versão disponível: ${remote}`);

    // Show balloon — clicking triggers the update prompt
    tray?.displayBalloon?.({
      title: `DriveGO ${remote} disponível`,
      content: 'Clique aqui para baixar e instalar a atualização.',
      iconType: 'info',
    });
  } catch {
    if (!silent) logWarn('sistema', 'Não foi possível verificar atualizações');
  }
}

// ─── Tray ────────────────────────────────────────────────────────────────────
const buildMenu = () => Menu.buildFromTemplate([
  {
    label: mainWindow?.isVisible() ? 'Ocultar DriveGO' : 'Mostrar DriveGO',
    click: () => toggleWindow(),
  },
  { type: 'separator' },
  ...(pendingUpdateVersion ? [{
    label: `⬇ Instalar atualização ${pendingUpdateVersion}`,
    click: () => promptAndInstallUpdate(pendingUpdateVersion!),
  }] : []),
  {
    label: 'Verificar atualizações',
    click: () => checkForUpdates(false),
  },
  { type: 'separator' as const },
  {
    label: 'Sair',
    click: () => { isQuitting = true; app.quit(); },
  },
]);

const rebuildTrayMenu = () => tray?.setContextMenu(buildMenu());

const createTray = () => {
  const icon = nativeImage.createFromPath(getIconPath());
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('DriveGO — Sincronização em nuvem');

  // Recria o menu cada vez que o usuário clica com botão direito (para atualizar label)
  tray.on('right-click', () => rebuildTrayMenu());
  rebuildTrayMenu();

  // Clique simples no ícone: mostra/oculta a janela
  tray.on('click', () => toggleWindow());

  // Clique no balloon de atualização → abre o diálogo OK/Cancelar
  tray.on('balloon-click', () => {
    if (pendingUpdateVersion) promptAndInstallUpdate(pendingUpdateVersion);
  });
}

const toggleWindow = () => {
  if (!mainWindow) return;
  if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

// ─── Window ─────────────────────────────────────────────────────────────────
const createWindow = () => {
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
const pushStatus = (localPath: string) => {
  if (!mainWindow) return;
  const s = statusMap.get(localPath);
  if (s) mainWindow.webContents.send('sync:status', s);
}

const setStatus = (localPath: string, patch: Partial<FolderStatus>) => {
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
const processQueue = async (folder: SyncFolderConfig) => {
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
  activeSyncCount++;
  syncStateChanged();
  setStatus(localPath, { status: 'syncing', pendingFiles: queue.size });

  const files = [...queue];
  let synced = 0;

  for (const filePath of files) {
    queue.delete(filePath);
    const fileName = path.basename(filePath);
    try {
      const relative   = path.relative(localPath, filePath).replace(/\\/g, '/');
      const remotePath = remotePrefix + relative;
      const expectedEtag = getManifestEntry(manifest, filePath)?.remoteEtag;
      let lastPct = -1;
      const result = await uploadFileFromDisk(userId, filePath, remotePath, (pct) => {
        if (pct === lastPct) return; // evita spam de IPC em arquivos pequenos
        lastPct = pct;
        setStatus(localPath, {
          status: 'syncing',
          pendingFiles: queue.size,
          syncedFiles: synced,
          uploadProgress: pct,
          errorMessage: null,
        });
      }, expectedEtag);
      synced++;
      try {
        const stats = fs.statSync(filePath);
        manifest = markSynced(manifest, filePath, stats, result.remotePath, result.etag ?? undefined);
      } catch { /* ignore */ }
      scheduleSaveManifest();
      setStatus(localPath, {
        status: 'syncing',
        pendingFiles: queue.size,
        syncedFiles: synced,
        uploadProgress: 0,
        errorMessage: null,
      });
      if (result.conflict) {
        logWarn('sync', `Conflito detectado: outro dispositivo já havia alterado ${fileName}`,
          `Sua versão foi preservada em: ${result.remotePath}`);
      } else {
        logSuccess('upload', `Arquivo enviado: ${fileName}`, remotePath);
      }
      // Notify for single-file uploads triggered by the watcher
      if (files.length === 1) notifyUploadComplete(fileName);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isLockedFileError(err)) {
        // File temporarily in use — it stays out of the manifest, so it will
        // be retried automatically on the next sync pass / app startup.
        logWarn('upload', `Ignorado (arquivo em uso, será reenviado): ${fileName}`, msg);
      } else {
        logError('upload', `Falha ao enviar: ${fileName}`, msg);
      }
    }
  }

  // Batch notification when multiple files were uploaded at once
  if (synced > 1) {
    const folder = getSyncFolders().find((f) => f.localPath === localPath);
    if (folder) notifySyncComplete(folder.name, synced);
  }

  activeSyncCount = Math.max(0, activeSyncCount - 1);
  syncStateChanged();

  setStatus(localPath, {
    status: queue.size > 0 ? 'syncing' : 'watching',
    pendingFiles: queue.size,
    lastSynced: new Date().toISOString(),
    errorMessage: null,
  });

  activeUploads.set(localPath, false);

  if (queue.size > 0) await processQueue(folder);
}

const scheduleUpload = (folder: SyncFolderConfig, filePath: string) => {
  const { localPath } = folder;
  if (pausedFolders.has(localPath)) return; // ignorar se pausado
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
const startWatcher = (folder: SyncFolderConfig) => {
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
    followSymlinks: false,   // prevents EPERM on Windows junctions (e.g. "Minhas Músicas")
    awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 500 },
  });

  watcher.on('add',    (fp) => scheduleUpload(folder, fp));
  watcher.on('change', (fp) => scheduleUpload(folder, fp));
  watcher.on('error',  (err) => {
    const msg = String(err);
    // Permission errors on Windows junctions/symlinks (e.g. "Minhas Músicas"
    // inside Documents) are non-fatal: the rest of the folder keeps syncing.
    // Log a warning but do NOT flag the whole folder as errored.
    if (isLockedFileError(err)) {
      logWarn('pasta', `Subpasta ignorada (sem permissão): ${folder.name}`, msg);
      return;
    }
    setStatus(localPath, { status: 'error', errorMessage: msg });
    logError('pasta', `Erro no monitoramento: ${folder.name}`, msg);
  });

  watchers.set(localPath, watcher);
}

const stopWatcher = (localPath: string) => {
  const w = watchers.get(localPath);
  if (w) { w.close(); watchers.delete(localPath); }
  uploadQueues.delete(localPath);
  statusMap.delete(localPath);
  initialSyncDone.delete(localPath);
  pausedFolders.delete(localPath);
}

const pauseWatcher = (localPath: string) => {
  if (pausedFolders.has(localPath)) return;
  pausedFolders.add(localPath);

  // Para o watcher e limpa a fila — o upload em andamento termina naturalmente
  const w = watchers.get(localPath);
  if (w) { w.close(); watchers.delete(localPath); }
  uploadQueues.get(localPath)?.clear();

  // Timers are keyed as `${localPath}:${filePath}` — clear all for this folder
  for (const [key, timer] of debounceTimers) {
    if (key.startsWith(`${localPath}:`)) {
      clearTimeout(timer);
      debounceTimers.delete(key);
    }
  }

  const prev = statusMap.get(localPath);
  setStatus(localPath, { status: 'paused', pendingFiles: 0, lastSynced: prev?.lastSynced ?? null });
  logInfo('sync', `Sincronização pausada: ${localPath}`);
}

const resumeWatcher = (localPath: string) => {
  if (!pausedFolders.has(localPath)) return;
  pausedFolders.delete(localPath);

  const folder = getSyncFolders().find((f) => f.localPath === localPath);
  if (!folder) return;

  logInfo('sync', `Sincronização retomada: ${folder.name}`);
  startWatcher(folder);
  // Faz sync diferencial para pegar arquivos criados enquanto pausado
  doInitialSync(folder, false);
}

// ─── Initial/differential sync ────────────────────────────────────────────────
// Two-level cache strategy:
//   1. Local manifest (size + mtime) — zero network cost on repeat startups
//   2. Remote listing via API — only for files not covered by the manifest
const doInitialSync = async (folder: SyncFolderConfig, forceAll = false) => {
  const { localPath } = folder;
  const userId = getSyncUserId();
  if (!userId) return;

  const localFiles = walkFolder(localPath);
  if (localFiles.length === 0) {
    logInfo('sync', `Pasta vazia: ${folder.name}`);
    setStatus(localPath, { status: 'watching', pendingFiles: 0, syncedFiles: 0, totalFiles: 0 });
    return;
  }

  // ── Level 1: manifest check (no network) ──────────────────────────────────
  const needsCheck: string[] = [];
  let manifestHits = 0;

  if (!forceAll) {
    for (const filePath of localFiles) {
      try {
        const stats = fs.statSync(filePath);
        if (isUpToDate(manifest, filePath, stats)) {
          manifestHits++;
        } else {
          needsCheck.push(filePath);
        }
      } catch {
        needsCheck.push(filePath);
      }
    }
  } else {
    needsCheck.push(...localFiles);
  }

  if (needsCheck.length === 0) {
    logSuccess('sync', `Tudo sincronizado: ${folder.name}`,
      `${manifestHits} arquivo(s) confirmado(s) pelo cache local — nenhuma chamada de rede necessária`);
    setStatus(localPath, {
      status: 'watching',
      pendingFiles: 0,
      syncedFiles: manifestHits,
      totalFiles: localFiles.length,
      lastSynced: new Date().toISOString(),
    });
    return;
  }

  // ── Level 2: remote listing — only for files not in manifest ──────────────
  logInfo('sync', `Verificando arquivos na nuvem: ${folder.name}`,
    manifestHits > 0 ? `${manifestHits} no cache · ${needsCheck.length} a verificar` : undefined);
  // Also fetches each file's ETag: files adopted here (already in the cloud,
  // never uploaded by this machine) still need a remoteEtag on record —
  // otherwise a future local edit to one of them would have nothing to
  // compare against, and a conflicting edit from another machine would go
  // undetected (silent overwrite instead of a conflict copy).
  const remoteEtags = forceAll ? new Map<string, string>() : await listRemoteFileEtags(userId, folder.remotePrefix);

  const pending: string[] = [];
  for (const filePath of needsCheck) {
    const relative   = path.relative(localPath, filePath).replace(/\\/g, '/');
    const remotePath = folder.remotePrefix + relative;
    if (remoteEtags.has(remotePath)) {
      // Already in cloud — backfill manifest so next startup is fully cached
      try {
        const stats = fs.statSync(filePath);
        manifest = markSynced(manifest, filePath, stats, remotePath, remoteEtags.get(remotePath));
      } catch { /* ignore */ }
    } else {
      pending.push(filePath);
    }
  }

  if (pending.length === 0) {
    scheduleSaveManifest();
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
  activeSyncCount++;
  syncStateChanged();

  let done = 0;
  const retryQueue: string[] = [];

  for (const filePath of pending) {
    const fileName = path.basename(filePath);
    try {
      const relative   = path.relative(localPath, filePath).replace(/\\/g, '/');
      const remotePath = folder.remotePrefix + relative;
      const expectedEtag = getManifestEntry(manifest, filePath)?.remoteEtag;
      let lastPct = -1;
      const result = await uploadFileFromDisk(userId, filePath, remotePath, (pct) => {
        if (pct === lastPct) return; // evita spam de IPC em arquivos pequenos
        lastPct = pct;
        setStatus(localPath, {
          status: 'syncing',
          syncedFiles: done,
          pendingFiles: pending.length - done,
          totalFiles: pending.length,
          uploadProgress: pct,
        });
      }, expectedEtag);
      done++;
      try {
        const stats = fs.statSync(filePath);
        manifest = markSynced(manifest, filePath, stats, result.remotePath, result.etag ?? undefined);
      } catch { /* ignore */ }
      scheduleSaveManifest();
      setStatus(localPath, {
        status: 'syncing',
        syncedFiles: done,
        pendingFiles: pending.length - done,
        totalFiles: pending.length,
        uploadProgress: 0,
      });
      if (result.conflict) {
        logWarn('sync', `Conflito detectado: outro dispositivo já havia alterado ${fileName}`,
          `Sua versão foi preservada em: ${result.remotePath}`);
      } else {
        logSuccess('upload', `Enviado: ${fileName}`, `${done}/${pending.length}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isLockedFileError(err)) {
        // File temporarily locked (e.g. open in accounting software) — retry later
        logWarn('upload', `Bloqueado (retry): ${fileName}`, msg);
        retryQueue.push(filePath);
      } else {
        logError('upload', `Falha: ${fileName}`, msg);
      }
    }
  }

  // Retry locked files once after a short delay
  if (retryQueue.length > 0) {
    logInfo('sync', `Retentando ${retryQueue.length} arquivo(s) bloqueado(s)…`);
    await new Promise((r) => setTimeout(r, 3000));
    for (const filePath of retryQueue) {
      const fileName = path.basename(filePath);
      try {
        const relative   = path.relative(localPath, filePath).replace(/\\/g, '/');
        const remotePath = folder.remotePrefix + relative;
        const expectedEtag = getManifestEntry(manifest, filePath)?.remoteEtag;
        const result = await uploadFileFromDisk(userId, filePath, remotePath, undefined, expectedEtag);
        done++;
        try {
          const stats = fs.statSync(filePath);
          manifest = markSynced(manifest, filePath, stats, result.remotePath, result.etag ?? undefined);
        } catch { /* ignore */ }
        scheduleSaveManifest();
        if (result.conflict) {
          logWarn('sync', `Conflito detectado (retry): outro dispositivo já havia alterado ${fileName}`,
            `Sua versão foi preservada em: ${result.remotePath}`);
        } else {
          logSuccess('upload', `Enviado (retry): ${fileName}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logWarn('upload', `Ignorado (arquivo em uso): ${fileName}`, msg);
      }
    }
  }

  activeSyncCount = Math.max(0, activeSyncCount - 1);
  syncStateChanged();

  setStatus(localPath, {
    status: 'watching',
    pendingFiles: 0,
    syncedFiles: done,
    totalFiles: pending.length,
    lastSynced: new Date().toISOString(),
  });

  logSuccess('sync', `Sincronização concluída: ${folder.name}`,
    `${done}/${pending.length} arquivo(s) enviado(s)`);

  if (done > 0) notifySyncComplete(folder.name, done);
}

// ─── Start saved watchers at launch (before userId is known) ─────────────────
const startSavedWatchers = () => {
  const folders = getSyncFolders();
  if (folders.length === 0) return;
  logInfo('sistema', `Carregando ${folders.length} pasta(s) salva(s)`);
  for (const folder of folders) {
    if (folder.enabled) startWatcher(folder);
  }
}

// ─── IPC Handlers ────────────────────────────────────────────────────────────

// ── Perfis de usuário ─────────────────────────────────────────────────────────
// Ativado no login: cria diretório e profile.json para o usuário logado,
// garantindo que cada usuário DriveGO tenha suas próprias configurações.
ipcMain.handle('profile:activate', async (_e, user: ProfileUser) => {
  await activateProfile(user);
  // Load the sync manifest for this user profile
  manifestPath = getProfileConfigPath('sync-manifest.json');
  manifest = loadManifest(manifestPath);
  logInfo('sistema', `Manifesto de sync carregado: ${Object.keys(manifest.entries).length} entrada(s)`);
  // Inicia os watchers DEPOIS do perfil estar ativo, garantindo que
  // getSyncFolders() leia o sync-config.json correto para este usuário.
  startSavedWatchers();
});

// Ativado no logout: para todos os watchers e zera o perfil ativo
// para que o próximo usuário comece com estado limpo.
ipcMain.handle('profile:deactivate', () => {
  // Flush manifest before clearing state
  if (manifestSaveTimer) {
    clearTimeout(manifestSaveTimer);
    manifestSaveTimer = null;
    if (manifestPath) saveManifest(manifestPath, manifest);
  }
  manifest = { version: 1, entries: {} };
  manifestPath = '';
  // Para todos os watchers do usuário atual
  for (const watcher of watchers.values()) watcher.close();
  watchers.clear();
  statusMap.clear();
  uploadQueues.clear();
  activeUploads.clear();
  pausedFolders.clear();
  initialSyncDone.clear();
  for (const timer of debounceTimers.values()) clearTimeout(timer);
  debounceTimers.clear();
  deactivateProfile();
});

ipcMain.handle('app:getVersion', () => app.getVersion());

ipcMain.handle('qr:generate', async (_e, url: string) => {
  const QRCode = await import('qrcode');
  return QRCode.toDataURL(url, {
    width: 240,
    margin: 2,
    errorCorrectionLevel: 'H',
    color: { dark: '#000000', light: '#ffffff' },
  });
});

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
  doInitialSync(folder).catch((err) => {
    setStatus(localPath, { status: 'error', errorMessage: err instanceof Error ? err.message : String(err) });
    logError('sync', `Erro na sincronização inicial: ${name}`, String(err));
  });
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
  // Purge manifest entries for this folder so a re-add starts fresh
  manifest = purgeFolderEntries(manifest, localPath);
  scheduleSaveManifest();
});

ipcMain.handle('sync:resync', async (_e, localPath: string) => {
  const folder = getSyncFolders().find((f) => f.localPath === localPath);
  if (!folder) return;
  logInfo('sync', `Ressincronização manual: ${folder.name}`);
  await doInitialSync(folder, true); // forceAll=true — re-upload everything
});

ipcMain.handle('sync:pause', (_e, localPath: string) => {
  pauseWatcher(localPath);
});

ipcMain.handle('sync:resume', (_e, localPath: string) => {
  resumeWatcher(localPath);
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
  const root = getDriveRoot();
  const target = subfolder === 'mine'
    ? path.join(root, 'Meus Arquivos')
    : path.join(root, 'Compartilhado comigo');
  shell.openPath(target);
});

// ─── File operations IPC (large file upload via streaming, folder creation, rename) ────
ipcMain.handle('files:uploadFromDisk', async (event, localPath: string, remotePath: string, name: string) => {
  const userId = getSyncUserId();
  if (!userId) throw new Error('Usuário não autenticado');

  await uploadFileFromDisk(userId, localPath, remotePath, (pct) => {
    event.sender.send('upload:progress', { name, pct });
  });
});

// Fetch presigned URL for renderer-side direct upload (fallback for drag-drop blobs)
ipcMain.handle('files:getUploadUrl', async (_e, remotePath: string, contentType: string) => {
  const userId = getSyncUserId();
  if (!userId) throw new Error('Usuário não autenticado');
  const BASE_URL = 'https://sotduhwtkbswokzrorpf.supabase.co/functions/v1';
  const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNvdGR1aHd0a2Jzd29renJvcnBmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyMTkwNTcsImV4cCI6MjA5MDc5NTA1N30.cXfR1DaHRQ2XwsXppbTn7W1FYEnKtlZVkSh9sMN2ikk';
  const res = await fetch(`${BASE_URL}/get-upload-url`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, filePath: remotePath, contentType }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { url } = await res.json();
  return url as string;
});

ipcMain.handle('files:createFolder', async (_e, folderPath: string) => {
  const userId = getSyncUserId();
  if (!userId) throw new Error('Usuário não autenticado');
  const BASE_URL = 'https://sotduhwtkbswokzrorpf.supabase.co/functions/v1';
  const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNvdGR1aHd0a2Jzd29renJvcnBmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyMTkwNTcsImV4cCI6MjA5MDc5NTA1N30.cXfR1DaHRQ2XwsXppbTn7W1FYEnKtlZVkSh9sMN2ikk';
  const res = await fetch(`${BASE_URL}/create-folder`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, folderPath }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error((j as { error?: string }).error || `HTTP ${res.status}`);
  }
});

ipcMain.handle('files:renameFile', async (_e, oldPath: string, newPath: string) => {
  const userId = getSyncUserId();
  if (!userId) throw new Error('Usuário não autenticado');
  const BASE_URL = 'https://sotduhwtkbswokzrorpf.supabase.co/functions/v1';
  const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNvdGR1aHd0a2Jzd29renJvcnBmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyMTkwNTcsImV4cCI6MjA5MDc5NTA1N30.cXfR1DaHRQ2XwsXppbTn7W1FYEnKtlZVkSh9sMN2ikk';
  const res = await fetch(`${BASE_URL}/rename-file`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, oldPath, newPath }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error((j as { error?: string }).error || `HTTP ${res.status}`);
  }
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

// ─── Single instance lock ────────────────────────────────────────────────────
// Garante que apenas uma instância do app rode por vez.
// Se o usuário tentar abrir um segundo executável, a janela existente é
// trazida ao foco e a nova instância é encerrada imediatamente.
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.on('ready', () => {
  // Registrar para iniciar automaticamente com o Windows (minimizado).
  // Só em produção (evita registrar o electron.exe de desenvolvimento, que abre
  // a tela padrão do Electron no boot) e apontando para o STUB ESTÁVEL — assim o
  // auto-start sempre abre a versão mais recente, sobrevivendo a atualizações.
  if (app.isPackaged && process.platform === 'win32') {
    app.setLoginItemSettings({
      openAtLogin: true,
      path: getStableLaunchPath(),
      args: ['--hidden'],   // abre direto na bandeja
    });
  }

  createWindow();
  createTray();

  // Send startup status messages to renderer splash screen
  sendStartupStatus('Inicializando DriveGO…');

  setTimeout(() => {
    sendStartupStatus('Carregando configurações…');
  }, 200);

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

  // ── Update checker — verifica 30s após iniciar e depois a cada 4h ──────────
  setTimeout(() => checkForUpdates(), 30_000);
  setInterval(() => checkForUpdates(), 4 * 60 * 60_000);

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
  for (const timer of debounceTimers.values()) clearTimeout(timer);
  debounceTimers.clear();
});

