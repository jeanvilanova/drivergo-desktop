import { contextBridge, ipcRenderer } from 'electron';

export interface FolderStatus {
  localPath: string;
  status: 'idle' | 'syncing' | 'error' | 'watching' | 'paused';
  pendingFiles: number;
  syncedFiles: number;
  totalFiles: number;
  lastSynced: string | null;
  errorMessage: string | null;
}

export interface SyncFolderInfo {
  localPath: string;
  name: string;
  remotePrefix: string;
  enabled: boolean;
  addedAt: string;
  status: FolderStatus;
}

export interface DefaultFolder {
  name: string;
  path: string;
}

export interface LogEntry {
  id: string;
  time: string;
  level: 'info' | 'success' | 'warn' | 'error';
  category: 'sistema' | 'sync' | 'upload' | 'pasta' | 'backup';
  message: string;
  detail?: string;
}

export interface BackupConfig {
  id: string;
  name: string;
  type: 'files' | 'firebird' | 'sqlserver' | 'postgresql' | 'db2' | 'oracle';
  enabled: boolean;
  createdAt: string;
  sourceFolders: string[];
  dbHost: string;
  dbPort: string;
  dbName: string;
  dbUser: string;
  dbPassword: string;
  dbFile: string;
  dbToolPath: string;
  schedule: 'daily' | 'weekly';
  scheduleTime: string;
  scheduleDayOfWeek: number;
  keepCount: number;
  compress: boolean;
  lastRun: string | null;
  lastStatus: 'idle' | 'running' | 'success' | 'error';
  lastError: string | null;
}

export interface CloudFileEntry {
  name: string;
  fullPath: string;
  size: number;
  lastModified: string;
  isFolder: boolean;
}

export interface SharedWithMeEntry {
  id: string;
  owner_user_id: string;
  file_path: string;
  is_folder: boolean;
  permission: string;
  created_at: string;
  owner_username: string;
  owner_display_name: string;
}

export interface DriveSyncProgress {
  status: 'mapped' | 'unmapped' | 'error';
  letter: string;
  syncingMyFiles: boolean;
  syncingShared: boolean;
  myFilesTotal: number;
  myFilesDone: number;
  sharedTotal: number;
  sharedDone: number;
  lastSynced: string | null;
  error: string | null;
}

contextBridge.exposeInMainWorld('electronAPI', {
  // Perfil de usuário
  setActiveProfile: (user: {
    id: string; username: string; display_name: string; minio_bucket_name: string;
  }): Promise<void> => ipcRenderer.invoke('profile:activate', user),
  clearActiveProfile: (): Promise<void> => ipcRenderer.invoke('profile:deactivate'),

  // App info
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),
  generateQR: (url: string): Promise<string> => ipcRenderer.invoke('qr:generate', url),

  // File operations
  openFiles: (): Promise<string[]> => ipcRenderer.invoke('dialog:openFiles'),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url),
  savePath: (defaultName: string): Promise<string | null> => ipcRenderer.invoke('dialog:savePath', defaultName),

  // Sync
  syncSetUser: (userId: string): Promise<void> => ipcRenderer.invoke('sync:setUser', userId),
  syncGetFolders: (): Promise<SyncFolderInfo[]> => ipcRenderer.invoke('sync:getFolders'),
  syncGetDefaultFolders: (): Promise<DefaultFolder[]> => ipcRenderer.invoke('sync:getDefaultFolders'),
  syncPickFolder: (): Promise<string | null> => ipcRenderer.invoke('sync:pickFolder'),
  syncAddFolder: (localPath: string, name: string): Promise<SyncFolderInfo> =>
    ipcRenderer.invoke('sync:addFolder', localPath, name),
  syncRemoveFolder: (localPath: string): Promise<void> => ipcRenderer.invoke('sync:removeFolder', localPath),
  syncResync:  (localPath: string): Promise<void> => ipcRenderer.invoke('sync:resync', localPath),
  syncPause:   (localPath: string): Promise<void> => ipcRenderer.invoke('sync:pause', localPath),
  syncResume:  (localPath: string): Promise<void> => ipcRenderer.invoke('sync:resume', localPath),

  // Push events from main to renderer
  onSyncStatus: (cb: (status: FolderStatus) => void) => {
    ipcRenderer.on('sync:status', (_event, status) => cb(status));
  },
  offSyncStatus: () => {
    ipcRenderer.removeAllListeners('sync:status');
  },

  // Log — usa listener nomeado para que cada chamador possa remover só o seu
  logGetEntries: (): Promise<LogEntry[]> => ipcRenderer.invoke('log:getEntries'),
  logClear: (): Promise<void> => ipcRenderer.invoke('log:clear'),
  onLogEntry: (cb: (entry: LogEntry) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, entry: LogEntry) => cb(entry);
    ipcRenderer.on('log:entry', handler);
    return handler; // retorna a referência para poder remover depois
  },
  offLogEntry: (handler: (e: Electron.IpcRendererEvent, entry: LogEntry) => void) => {
    ipcRenderer.removeListener('log:entry', handler);
  },

  // Backup agendado
  backupGetConfigs: (): Promise<BackupConfig[]> => ipcRenderer.invoke('backup:getConfigs'),
  backupSaveConfig: (cfg: BackupConfig): Promise<void> => ipcRenderer.invoke('backup:saveConfig', cfg),
  backupRemoveConfig: (id: string): Promise<void> => ipcRenderer.invoke('backup:removeConfig', id),
  backupRunNow: (id: string): Promise<void> => ipcRenderer.invoke('backup:runNow', id),

  // Startup status
  onAppStatus: (cb: (msg: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, msg: string) => cb(msg);
    ipcRenderer.on('app:status', handler);
    return handler;
  },
  offAppStatus: (handler: (e: Electron.IpcRendererEvent, msg: string) => void) => {
    ipcRenderer.removeListener('app:status', handler);
  },

  // Unidade mapeada
  driveGetConfig: (): Promise<{ letter: string; enabled: boolean }> => ipcRenderer.invoke('drive:getConfig'),
  driveSetConfig: (cfg: { letter: string; enabled: boolean }): Promise<void> => ipcRenderer.invoke('drive:setConfig', cfg),
  driveMap: (letter: string): Promise<void> => ipcRenderer.invoke('drive:map', letter),
  driveUnmap: (letter: string): Promise<void> => ipcRenderer.invoke('drive:unmap', letter),
  driveGetStatus: (): Promise<DriveSyncProgress> => ipcRenderer.invoke('drive:getStatus'),
  driveSyncNow: (): Promise<void> => ipcRenderer.invoke('drive:syncNow'),
  driveListMyFiles: (prefix: string): Promise<CloudFileEntry[]> => ipcRenderer.invoke('drive:listMyFiles', prefix),
  driveListSharedWithMe: (): Promise<SharedWithMeEntry[]> => ipcRenderer.invoke('drive:listSharedWithMe'),
  driveGenerateShareLink: (filePath: string, isFolder: boolean): Promise<string> => ipcRenderer.invoke('drive:generateShareLink', filePath, isFolder),
  driveOpenFolder: (subfolder: 'mine' | 'shared'): Promise<void> => ipcRenderer.invoke('drive:openFolder', subfolder),
  onDriveProgress: (cb: (p: DriveSyncProgress) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, p: DriveSyncProgress) => cb(p);
    ipcRenderer.on('drive:progress', handler);
    return handler;
  },
  offDriveProgress: (handler: (e: Electron.IpcRendererEvent, p: DriveSyncProgress) => void) => {
    ipcRenderer.removeListener('drive:progress', handler);
  },
});
