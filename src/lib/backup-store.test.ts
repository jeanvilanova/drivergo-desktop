import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ── Mock electron BEFORE importing modules that depend on it ─────────────────
vi.mock('electron', () => ({
  app: {
    getPath: () => path.join(os.tmpdir(), 'drivego-test-backup-store'),
    isPackaged: false,
  },
}));

// Patch profile-store to use same temp dir without activeProfilePath logic
vi.mock('./profile-store', () => ({
  getProfileConfigPath: (filename: string) =>
    path.join(os.tmpdir(), 'drivego-test-backup-store', filename),
}));

import {
  getBackupConfigs, addBackupConfig, updateBackupConfig, removeBackupConfig,
  defaultConfig, isDue, computeNextRun, DB_DEFAULT_PORTS,
  type BackupConfig,
} from './backup-store';

const TEST_DIR = path.join(os.tmpdir(), 'drivego-test-backup-store');
const CONFIG_FILE = path.join(TEST_DIR, 'backup-config.json');

function makeConfig(overrides: Partial<BackupConfig> = {}): BackupConfig {
  return {
    id: 'test-1',
    name: 'Teste',
    type: 'files',
    createdAt: new Date().toISOString(),
    ...defaultConfig(),
    ...overrides,
  };
}

beforeEach(() => {
  fs.mkdirSync(TEST_DIR, { recursive: true });
  if (fs.existsSync(CONFIG_FILE)) fs.unlinkSync(CONFIG_FILE);
});

// ── CRUD ─────────────────────────────────────────────────────────────────────
describe('backup-store — CRUD', () => {
  it('returns empty array when no config file exists', () => {
    expect(getBackupConfigs()).toEqual([]);
  });

  it('adds a backup config', () => {
    addBackupConfig(makeConfig());
    expect(getBackupConfigs()).toHaveLength(1);
  });

  it('persists config across reads', () => {
    addBackupConfig(makeConfig({ name: 'Persistido' }));
    expect(getBackupConfigs()[0].name).toBe('Persistido');
  });

  it('adds multiple configs', () => {
    addBackupConfig(makeConfig({ id: 'a' }));
    addBackupConfig(makeConfig({ id: 'b' }));
    expect(getBackupConfigs()).toHaveLength(2);
  });

  it('updates a config by id', () => {
    addBackupConfig(makeConfig({ id: 'upd' }));
    updateBackupConfig('upd', { name: 'Atualizado', lastStatus: 'success' });
    const cfg = getBackupConfigs().find((c) => c.id === 'upd')!;
    expect(cfg.name).toBe('Atualizado');
    expect(cfg.lastStatus).toBe('success');
  });

  it('update does not affect other configs', () => {
    addBackupConfig(makeConfig({ id: 'x' }));
    addBackupConfig(makeConfig({ id: 'y', name: 'Y' }));
    updateBackupConfig('x', { name: 'X-updated' });
    expect(getBackupConfigs().find((c) => c.id === 'y')!.name).toBe('Y');
  });

  it('removes a config by id', () => {
    addBackupConfig(makeConfig({ id: 'del' }));
    removeBackupConfig('del');
    expect(getBackupConfigs().find((c) => c.id === 'del')).toBeUndefined();
  });

  it('remove leaves other configs intact', () => {
    addBackupConfig(makeConfig({ id: 'keep' }));
    addBackupConfig(makeConfig({ id: 'del2' }));
    removeBackupConfig('del2');
    expect(getBackupConfigs()).toHaveLength(1);
    expect(getBackupConfigs()[0].id).toBe('keep');
  });
});

// ── defaultConfig ─────────────────────────────────────────────────────────────
describe('backup-store — defaultConfig()', () => {
  it('returns keepCount=7 by default', () => {
    expect(defaultConfig().keepCount).toBe(7);
  });

  it('returns compress=true by default', () => {
    expect(defaultConfig().compress).toBe(true);
  });

  it('returns schedule=daily by default', () => {
    expect(defaultConfig().schedule).toBe('daily');
  });

  it('returns scheduleTime=02:00 by default', () => {
    expect(defaultConfig().scheduleTime).toBe('02:00');
  });

  it('returns lastStatus=idle by default', () => {
    expect(defaultConfig().lastStatus).toBe('idle');
  });
});

// ── DB_DEFAULT_PORTS ──────────────────────────────────────────────────────────
describe('backup-store — DB_DEFAULT_PORTS', () => {
  it('has correct Firebird port', () => expect(DB_DEFAULT_PORTS.firebird).toBe('3050'));
  it('has correct SQL Server port', () => expect(DB_DEFAULT_PORTS.sqlserver).toBe('1433'));
  it('has correct PostgreSQL port', () => expect(DB_DEFAULT_PORTS.postgresql).toBe('5432'));
  it('has correct DB2 port', () => expect(DB_DEFAULT_PORTS.db2).toBe('50000'));
  it('has correct Oracle port', () => expect(DB_DEFAULT_PORTS.oracle).toBe('1521'));
  it('files has empty port', () => expect(DB_DEFAULT_PORTS.files).toBe(''));
});

// ── isDue ─────────────────────────────────────────────────────────────────────
describe('backup-store — isDue()', () => {
  it('returns false when disabled', () => {
    const cfg = makeConfig({ enabled: false });
    expect(isDue(cfg)).toBe(false);
  });

  it('returns false when lastStatus=running', () => {
    const cfg = makeConfig({ lastStatus: 'running' });
    expect(isDue(cfg)).toBe(false);
  });

  it('returns false when time does not match', () => {
    const now = new Date();
    const wrongHour = (now.getHours() + 1) % 24;
    const cfg = makeConfig({ scheduleTime: `${String(wrongHour).padStart(2, '0')}:00` });
    expect(isDue(cfg)).toBe(false);
  });

  it('returns false for weekly when day does not match', () => {
    const now = new Date();
    const wrongDay = (now.getDay() + 1) % 7;
    const cfg = makeConfig({
      schedule: 'weekly',
      scheduleDayOfWeek: wrongDay,
      scheduleTime: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    });
    expect(isDue(cfg)).toBe(false);
  });

  it('returns false when last run was less than 1 minute ago', () => {
    const now = new Date();
    const cfg = makeConfig({
      scheduleTime: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
      lastRun: new Date(now.getTime() - 30_000).toISOString(),
    });
    expect(isDue(cfg)).toBe(false);
  });

  it('returns true for daily when time matches and no previous run', () => {
    const fakeNow = new Date(2025, 0, 15, 2, 0, 0); // 02:00
    vi.setSystemTime(fakeNow);
    const cfg = makeConfig({ schedule: 'daily', scheduleTime: '02:00', lastRun: null });
    expect(isDue(cfg)).toBe(true);
    vi.useRealTimers();
  });

  it('returns true for weekly when day and time match with old last run', () => {
    // Fix to a Monday (getDay() === 1) at 03:00
    const fakeNow = new Date(2025, 0, 13, 3, 0, 0); // Monday 2025-01-13 03:00
    vi.setSystemTime(fakeNow);
    const cfg = makeConfig({
      schedule: 'weekly',
      scheduleDayOfWeek: 1, // Monday
      scheduleTime: '03:00',
      lastRun: new Date(2025, 0, 6, 3, 0, 0).toISOString(), // 7 days ago
    });
    expect(isDue(cfg)).toBe(true);
    vi.useRealTimers();
  });
});

// ── computeNextRun ────────────────────────────────────────────────────────────
describe('backup-store — computeNextRun()', () => {
  it('returns a Date in the future for daily schedule', () => {
    const cfg = makeConfig({ schedule: 'daily', scheduleTime: '02:00' });
    const next = computeNextRun(cfg);
    expect(next).toBeInstanceOf(Date);
    expect(next.getHours()).toBe(2);
    expect(next.getMinutes()).toBe(0);
  });

  it('returns a Date for weekly schedule', () => {
    const cfg = makeConfig({ schedule: 'weekly', scheduleTime: '03:00', scheduleDayOfWeek: 1 });
    const next = computeNextRun(cfg);
    expect(next).toBeInstanceOf(Date);
    expect(next.getDay()).toBe(1); // Monday
  });

  it('advances to tomorrow when daily time already passed', () => {
    const now = new Date();
    const pastHour = now.getHours() === 0 ? 23 : now.getHours() - 1;
    const cfg = makeConfig({ schedule: 'daily', scheduleTime: `${String(pastHour).padStart(2, '0')}:00` });
    const next = computeNextRun(cfg);
    expect(next.getTime()).toBeGreaterThan(now.getTime());
  });
});
