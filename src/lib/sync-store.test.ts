import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const TEST_DIR = path.join(os.tmpdir(), 'drivego-test-sync-store');

vi.mock('electron', () => ({
  app: { getPath: () => TEST_DIR, isPackaged: false },
}));

vi.mock('./profile-store', () => ({
  getProfileConfigPath: (filename: string) => path.join(TEST_DIR, filename),
}));

import {
  getSyncFolders, addSyncFolder, removeSyncFolder,
  setSyncUserId, getSyncUserId,
  type SyncFolderConfig,
} from './sync-store';

const CONFIG_FILE = path.join(TEST_DIR, 'sync-config.json');

function makeFolder(overrides: Partial<SyncFolderConfig> = {}): SyncFolderConfig {
  return {
    localPath: 'C:\\Users\\test\\Documentos',
    name: 'Documentos',
    remotePrefix: 'sync/Documentos/',
    enabled: true,
    addedAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  fs.mkdirSync(TEST_DIR, { recursive: true });
  if (fs.existsSync(CONFIG_FILE)) fs.unlinkSync(CONFIG_FILE);
});

// ── Folders ───────────────────────────────────────────────────────────────────
describe('sync-store — folders', () => {
  it('returns empty array when no config exists', () => {
    expect(getSyncFolders()).toEqual([]);
  });

  it('adds a folder', () => {
    addSyncFolder(makeFolder());
    expect(getSyncFolders()).toHaveLength(1);
  });

  it('persists folder data across reads', () => {
    addSyncFolder(makeFolder({ name: 'Imagens', remotePrefix: 'sync/Imagens/' }));
    const folders = getSyncFolders();
    expect(folders[0].name).toBe('Imagens');
    expect(folders[0].remotePrefix).toBe('sync/Imagens/');
  });

  it('adds multiple distinct folders', () => {
    addSyncFolder(makeFolder({ localPath: 'C:\\A', name: 'A' }));
    addSyncFolder(makeFolder({ localPath: 'C:\\B', name: 'B' }));
    expect(getSyncFolders()).toHaveLength(2);
  });

  it('replaces existing folder with same localPath (upsert)', () => {
    addSyncFolder(makeFolder({ localPath: 'C:\\Docs', name: 'v1' }));
    addSyncFolder(makeFolder({ localPath: 'C:\\Docs', name: 'v2' }));
    const folders = getSyncFolders();
    expect(folders).toHaveLength(1);
    expect(folders[0].name).toBe('v2');
  });

  it('removes a folder by localPath', () => {
    addSyncFolder(makeFolder({ localPath: 'C:\\Remove' }));
    removeSyncFolder('C:\\Remove');
    expect(getSyncFolders()).toHaveLength(0);
  });

  it('remove leaves other folders intact', () => {
    addSyncFolder(makeFolder({ localPath: 'C:\\Keep' }));
    addSyncFolder(makeFolder({ localPath: 'C:\\Del' }));
    removeSyncFolder('C:\\Del');
    expect(getSyncFolders()).toHaveLength(1);
    expect(getSyncFolders()[0].localPath).toBe('C:\\Keep');
  });

  it('remove of non-existent path does not throw', () => {
    expect(() => removeSyncFolder('C:\\NaoExiste')).not.toThrow();
  });

  it('preserves enabled flag', () => {
    addSyncFolder(makeFolder({ enabled: false }));
    expect(getSyncFolders()[0].enabled).toBe(false);
  });
});

// ── userId ────────────────────────────────────────────────────────────────────
describe('sync-store — userId', () => {
  it('returns null when not set', () => {
    expect(getSyncUserId()).toBeNull();
  });

  it('persists userId after set', () => {
    setSyncUserId('user-abc-123');
    expect(getSyncUserId()).toBe('user-abc-123');
  });

  it('overwrites previous userId', () => {
    setSyncUserId('first');
    setSyncUserId('second');
    expect(getSyncUserId()).toBe('second');
  });

  it('setSyncUserId does not lose existing folders', () => {
    addSyncFolder(makeFolder({ name: 'Mantida' }));
    setSyncUserId('user-xyz');
    expect(getSyncFolders()[0].name).toBe('Mantida');
  });
});
