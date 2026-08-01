import fs from 'node:fs';
import { getProfileConfigPath } from './profile-store';

export interface SyncFolderConfig {
  localPath: string;
  name: string;         // display name (e.g. "Documentos")
  remotePrefix: string; // remote folder prefix (e.g. "sync/Documentos/")
  enabled: boolean;
  addedAt: string;
}

interface SyncConfig {
  userId: string | null;
  sessionToken: string | null;
  folders: SyncFolderConfig[];
}

function configPath(): string {
  return getProfileConfigPath('sync-config.json');
}

function readConfig(): SyncConfig {
  try {
    const raw = fs.readFileSync(configPath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<SyncConfig>;
    return { userId: null, sessionToken: null, folders: [], ...parsed };
  } catch {
    return { userId: null, sessionToken: null, folders: [] };
  }
}

function writeConfig(cfg: SyncConfig): void {
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf-8');
}

export function getSyncFolders(): SyncFolderConfig[] {
  return readConfig().folders;
}

export function addSyncFolder(folder: SyncFolderConfig): void {
  const cfg = readConfig();
  const existing = cfg.folders.findIndex((f) => f.localPath === folder.localPath);
  if (existing >= 0) {
    cfg.folders[existing] = folder;
  } else {
    cfg.folders.push(folder);
  }
  writeConfig(cfg);
}

export function removeSyncFolder(localPath: string): void {
  const cfg = readConfig();
  cfg.folders = cfg.folders.filter((f) => f.localPath !== localPath);
  writeConfig(cfg);
}

export function setSyncUserId(userId: string): void {
  const cfg = readConfig();
  cfg.userId = userId;
  writeConfig(cfg);
}

export function getSyncUserId(): string | null {
  return readConfig().userId;
}

export function setSyncSessionToken(sessionToken: string): void {
  const cfg = readConfig();
  cfg.sessionToken = sessionToken;
  writeConfig(cfg);
}

export function getSyncSessionToken(): string | null {
  return readConfig().sessionToken;
}
