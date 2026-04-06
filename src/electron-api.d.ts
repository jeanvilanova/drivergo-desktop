// Global type declaration for the contextBridge API exposed by preload.ts
import type { FolderStatus, SyncFolderInfo, DefaultFolder, LogEntry, BackupConfig, CloudFileEntry, SharedWithMeEntry, DriveSyncProgress } from './preload';

declare global {
  interface Window {
    electronAPI: {
      // App info
      getVersion: () => Promise<string>;
      generateQR: (url: string) => Promise<string>;

      // File / URL helpers
      openFiles: () => Promise<string[]>;
      openExternal: (url: string) => Promise<void>;
      savePath: (defaultName: string) => Promise<string | null>;

      // Sync
      syncSetUser: (userId: string) => Promise<void>;
      syncGetFolders: () => Promise<SyncFolderInfo[]>;
      syncGetDefaultFolders: () => Promise<DefaultFolder[]>;
      syncPickFolder: () => Promise<string | null>;
      syncAddFolder: (localPath: string, name: string) => Promise<SyncFolderInfo>;
      syncRemoveFolder: (localPath: string) => Promise<void>;
      syncResync:  (localPath: string) => Promise<void>;
      syncPause:   (localPath: string) => Promise<void>;
      syncResume:  (localPath: string) => Promise<void>;
      onSyncStatus: (cb: (status: FolderStatus) => void) => void;
      offSyncStatus: () => void;

      // Log
      logGetEntries: () => Promise<LogEntry[]>;
      logClear: () => Promise<void>;
      onLogEntry: (cb: (entry: LogEntry) => void) => (e: Electron.IpcRendererEvent, entry: LogEntry) => void;
      offLogEntry: (handler: (e: Electron.IpcRendererEvent, entry: LogEntry) => void) => void;

      // Startup status
      onAppStatus: (cb: (msg: string) => void) => (e: Electron.IpcRendererEvent, msg: string) => void;
      offAppStatus: (handler: (e: Electron.IpcRendererEvent, msg: string) => void) => void;

      // Backup agendado
      backupGetConfigs: () => Promise<BackupConfig[]>;
      backupSaveConfig: (cfg: BackupConfig) => Promise<void>;
      backupRemoveConfig: (id: string) => Promise<void>;
      backupRunNow: (id: string) => Promise<void>;

      // Unidade mapeada
      driveGetConfig: () => Promise<{ letter: string; enabled: boolean }>;
      driveSetConfig: (cfg: { letter: string; enabled: boolean }) => Promise<void>;
      driveMap: (letter: string) => Promise<void>;
      driveUnmap: (letter: string) => Promise<void>;
      driveGetStatus: () => Promise<DriveSyncProgress>;
      driveSyncNow: () => Promise<void>;
      driveListMyFiles: (prefix: string) => Promise<CloudFileEntry[]>;
      driveListSharedWithMe: () => Promise<SharedWithMeEntry[]>;
      driveGenerateShareLink: (filePath: string, isFolder: boolean) => Promise<string>;
      driveOpenFolder: (subfolder: 'mine' | 'shared') => Promise<void>;
      onDriveProgress: (cb: (p: DriveSyncProgress) => void) => (e: Electron.IpcRendererEvent, p: DriveSyncProgress) => void;
      offDriveProgress: (handler: (e: Electron.IpcRendererEvent, p: DriveSyncProgress) => void) => void;
    };
  }
}
