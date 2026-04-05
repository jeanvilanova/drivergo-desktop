export interface FolderStatus {
  localPath: string;
  status: 'idle' | 'syncing' | 'error' | 'watching';
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
  category: 'sistema' | 'sync' | 'upload' | 'pasta';
  message: string;
  detail?: string;
}
