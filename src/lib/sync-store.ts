import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export interface SyncFolderConfig {
  localPath: string;
  name: string;         // display name (e.g. "Documentos")
  remotePrefix: string; // remote folder prefix (e.g. "sync/Documentos/")
  enabled: boolean;
  addedAt: string;
}

interface SyncConfig {
  userId: string | null;
  folders: SyncFolderConfig[];
}

function configPath(): string {
  return path.join(app.getPath('userData'), 'sync-config.json');
}

function readConfig(): SyncConfig {
  try {
    const raw = fs.readFileSync(configPath(), 'utf-8');
    return JSON.parse(raw) as SyncConfig;
  } catch {
    return { userId: null, folders: [] };
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
