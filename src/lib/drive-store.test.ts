import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const TEST_DIR = path.join(os.tmpdir(), 'drivego-test-drive-store');

vi.mock('electron', () => ({
  app: { getPath: () => TEST_DIR, isPackaged: false },
}));

vi.mock('./profile-store', () => ({
  getProfileConfigPath: (filename: string) => path.join(TEST_DIR, filename),
}));

import { getDriveConfig, saveDriveConfig, getDriveRoot } from './drive-store';

const CONFIG_FILE = path.join(TEST_DIR, 'drive-config.json');

beforeEach(() => {
  fs.mkdirSync(TEST_DIR, { recursive: true });
  if (fs.existsSync(CONFIG_FILE)) fs.unlinkSync(CONFIG_FILE);
});

describe('drive-store — getDriveConfig()', () => {
  it('returns default config when no file exists', () => {
    const cfg = getDriveConfig();
    expect(cfg.letter).toBe('G');
    expect(cfg.enabled).toBe(false);
  });

  it('parses stored config correctly', () => {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ letter: 'Z', enabled: true }));
    const cfg = getDriveConfig();
    expect(cfg.letter).toBe('Z');
    expect(cfg.enabled).toBe(true);
  });
});

describe('drive-store — saveDriveConfig()', () => {
  it('persists config to disk', () => {
    saveDriveConfig({ letter: 'H', enabled: true });
    const cfg = getDriveConfig();
    expect(cfg.letter).toBe('H');
    expect(cfg.enabled).toBe(true);
  });

  it('overwrites previous config', () => {
    saveDriveConfig({ letter: 'X', enabled: true });
    saveDriveConfig({ letter: 'Y', enabled: false });
    expect(getDriveConfig().letter).toBe('Y');
    expect(getDriveConfig().enabled).toBe(false);
  });
});

describe('drive-store — getDriveRoot()', () => {
  it('returns a path inside userData', () => {
    const root = getDriveRoot();
    expect(root).toContain('drivego-drive');
    expect(path.isAbsolute(root)).toBe(true);
  });
});
