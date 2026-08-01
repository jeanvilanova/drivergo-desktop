import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { getDriveRoot } from './drive-store';
import {
  listCloudFiles, listSharedWithMe, downloadFileToLocal, downloadSharedFileToLocal,
} from './uploader-main';
import { logInfo, logSuccess, logError } from './logger';

const execFileAsync = promisify(execFile);

export type DriveMapStatus = 'mapped' | 'unmapped' | 'error';

export interface DriveSyncProgress {
  status: DriveMapStatus;
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

let syncProgress: DriveSyncProgress = {
  status: 'unmapped',
  letter: 'G',
  syncingMyFiles: false,
  syncingShared: false,
  myFilesTotal: 0,
  myFilesDone: 0,
  sharedTotal: 0,
  sharedDone: 0,
  lastSynced: null,
  error: null,
};

let onProgressCb: ((p: DriveSyncProgress) => void) | null = null;

export function setDriveProgressCallback(cb: (p: DriveSyncProgress) => void) {
  onProgressCb = cb;
}

function push(patch: Partial<DriveSyncProgress>) {
  syncProgress = { ...syncProgress, ...patch };
  onProgressCb?.(syncProgress);
}

// ── subst helpers ─────────────────────────────────────────────────────────────

export async function isDriveMapped(letter: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('subst', [], { windowsHide: true });
    const upper = letter.toUpperCase();
    return stdout.split('\n').some((line) => line.startsWith(`${upper}:\\`));
  } catch {
    return false;
  }
}

export async function mapDrive(letter: string): Promise<void> {
  const root = getDriveRoot();
  fs.mkdirSync(path.join(root, 'Meus Arquivos'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Compartilhado comigo'), { recursive: true });

  const upper = letter.toUpperCase();

  // Unmap first if already mapped to avoid error
  try {
    await execFileAsync('subst', [`${upper}:`, '/D'], { windowsHide: true });
  } catch { /* not mapped — ok */ }

  await execFileAsync('subst', [`${upper}:`, root], { windowsHide: true });
  push({ status: 'mapped', letter: upper, error: null });
  logSuccess('sistema', `Unidade ${upper}: mapeada`, root);
}

export async function unmapDrive(letter: string): Promise<void> {
  const upper = letter.toUpperCase();
  await execFileAsync('subst', [`${upper}:`, '/D'], { windowsHide: true });
  push({ status: 'unmapped', error: null });
  logInfo('sistema', `Unidade ${upper}: desmapeada`);
}

export function getDriveStatus(): DriveSyncProgress {
  return { ...syncProgress };
}

// ── File sync to drive folder ─────────────────────────────────────────────────

export async function syncMyFilesToDrive(userId: string): Promise<void> {
  if (syncProgress.syncingMyFiles) return;
  push({ syncingMyFiles: true, myFilesTotal: 0, myFilesDone: 0 });
  logInfo('sync', 'Sincronizando Meus Arquivos para unidade mapeada');

  try {
    const root    = path.join(getDriveRoot(), 'Meus Arquivos');
    const allFiles = await listCloudFiles(userId, '', true);
    const files    = allFiles.filter((f) => !f.isFolder);

    push({ myFilesTotal: files.length });

    let done = 0;
    for (const file of files) {
      const localPath = path.join(root, ...file.fullPath.split('/'));
      const alreadyExists = fs.existsSync(localPath) &&
        fs.statSync(localPath).size === file.size;

      if (!alreadyExists) {
        try {
          await downloadFileToLocal(userId, file.fullPath, localPath);
          logSuccess('upload', `Drive: baixado ${file.name}`, file.fullPath);
        } catch (err) {
          logError('upload', `Drive: falha ao baixar ${file.name}`, String(err));
        }
      }
      done++;
      push({ myFilesDone: done });
    }

    push({ syncingMyFiles: false, lastSynced: new Date().toISOString() });
    logSuccess('sync', 'Meus Arquivos sincronizados com unidade mapeada', `${files.length} arquivo(s)`);
  } catch (err) {
    push({ syncingMyFiles: false, error: String(err) });
    logError('sync', 'Erro ao sincronizar Meus Arquivos', String(err));
  }
}

export async function syncSharedFilesToDrive(userId: string): Promise<void> {
  if (syncProgress.syncingShared) return;
  push({ syncingShared: true, sharedTotal: 0, sharedDone: 0 });
  logInfo('sync', 'Sincronizando Compartilhado comigo para unidade mapeada');

  try {
    const root   = path.join(getDriveRoot(), 'Compartilhado comigo');
    const shares = await listSharedWithMe(userId);
    const fileShares = shares.filter((s) => !s.is_folder);

    push({ sharedTotal: fileShares.length });

    let done = 0;
    for (const share of fileShares) {
      const fileName = share.file_path.split('/').filter(Boolean).pop() || share.id;
      const ownerLabel = share.owner_username || share.owner_email || 'desconhecido';
      const localPath = path.join(root, ownerLabel, fileName);

      if (!fs.existsSync(localPath)) {
        try {
          await downloadSharedFileToLocal(userId, share.id, localPath);
          logSuccess('upload', `Compartilhado: baixado ${fileName}`, ownerLabel);
        } catch (err) {
          logError('upload', `Compartilhado: falha ao baixar ${fileName}`, String(err));
        }
      }
      done++;
      push({ sharedDone: done });
    }

    push({ syncingShared: false });
    logSuccess('sync', 'Compartilhado comigo sincronizado', `${fileShares.length} arquivo(s)`);
  } catch (err) {
    push({ syncingShared: false, error: String(err) });
    logError('sync', 'Erro ao sincronizar Compartilhado comigo', String(err));
  }
}

// ── Auto-restore on startup ───────────────────────────────────────────────────

export async function restoreDriveOnStartup(letter: string): Promise<void> {
  try {
    const already = await isDriveMapped(letter);
    if (!already) {
      await mapDrive(letter);
    } else {
      push({ status: 'mapped', letter: letter.toUpperCase() });
    }
  } catch (err) {
    push({ status: 'error', error: String(err) });
    logError('sistema', `Erro ao restaurar unidade ${letter}:`, String(err));
  }
}
