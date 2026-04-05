import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

export type BackupType = 'files' | 'firebird' | 'sqlserver' | 'postgresql' | 'db2' | 'oracle';
export type ScheduleType = 'daily' | 'weekly';
export type BackupStatus = 'idle' | 'running' | 'success' | 'error';

export interface BackupConfig {
  id: string;
  name: string;
  type: BackupType;
  enabled: boolean;
  createdAt: string;

  // ── File backup ────────────────────────────────────────────────────
  sourceFolders: string[];

  // ── Database connection ────────────────────────────────────────────
  dbHost: string;
  dbPort: string;
  dbName: string;
  dbUser: string;
  dbPassword: string;
  dbFile: string;      // Firebird: path to .fdb file
  dbToolPath: string;  // Custom path to dump tool (optional)

  // ── Schedule ───────────────────────────────────────────────────────
  schedule: ScheduleType;
  scheduleTime: string;        // "HH:MM" (24h)
  scheduleDayOfWeek: number;   // 0=Dom … 6=Sáb (weekly only)

  // ── Retention ─────────────────────────────────────────────────────
  keepCount: number;   // keep last N backups, delete older ones

  // ── Runtime state (written by runner) ─────────────────────────────
  lastRun: string | null;
  lastStatus: BackupStatus;
  lastError: string | null;
}

// ── Defaults ──────────────────────────────────────────────────────────────────
export function defaultConfig(): Omit<BackupConfig, 'id' | 'name' | 'type' | 'createdAt'> {
  return {
    enabled: true,
    sourceFolders: [],
    dbHost: 'localhost', dbPort: '', dbName: '', dbUser: '', dbPassword: '',
    dbFile: '', dbToolPath: '',
    schedule: 'daily', scheduleTime: '02:00', scheduleDayOfWeek: 1,
    keepCount: 7,
    lastRun: null, lastStatus: 'idle', lastError: null,
  };
}

// ── Persistence ───────────────────────────────────────────────────────────────
function configPath() {
  return path.join(app.getPath('userData'), 'backup-config.json');
}

export function getBackupConfigs(): BackupConfig[] {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    return JSON.parse(raw) as BackupConfig[];
  } catch {
    return [];
  }
}

function saveConfigs(configs: BackupConfig[]) {
  fs.writeFileSync(configPath(), JSON.stringify(configs, null, 2));
}

export function addBackupConfig(cfg: BackupConfig) {
  const configs = getBackupConfigs();
  configs.push(cfg);
  saveConfigs(configs);
}

export function updateBackupConfig(id: string, patch: Partial<BackupConfig>) {
  const configs = getBackupConfigs().map((c) =>
    c.id === id ? { ...c, ...patch } : c
  );
  saveConfigs(configs);
}

export function removeBackupConfig(id: string) {
  saveConfigs(getBackupConfigs().filter((c) => c.id !== id));
}

// ── Schedule helpers ──────────────────────────────────────────────────────────
export function computeNextRun(cfg: BackupConfig): Date {
  const [hh, mm] = cfg.scheduleTime.split(':').map(Number);
  const now = new Date();
  const next = new Date();
  next.setHours(hh, mm, 0, 0);

  if (cfg.schedule === 'daily') {
    if (next <= now) next.setDate(next.getDate() + 1);
    return next;
  }

  // Weekly — find next occurrence of scheduleDayOfWeek
  const dow = cfg.scheduleDayOfWeek ?? 1;
  let daysAhead = (dow - now.getDay() + 7) % 7;
  if (daysAhead === 0 && next <= now) daysAhead = 7;
  next.setDate(next.getDate() + daysAhead);
  return next;
}

export function isDue(cfg: BackupConfig): boolean {
  if (!cfg.enabled || cfg.lastStatus === 'running') return false;
  const [hh, mm] = cfg.scheduleTime.split(':').map(Number);
  const now = new Date();

  if (cfg.schedule === 'daily') {
    if (now.getHours() !== hh || now.getMinutes() !== mm) return false;
  } else {
    if (now.getDay() !== cfg.scheduleDayOfWeek) return false;
    if (now.getHours() !== hh || now.getMinutes() !== mm) return false;
  }

  // Avoid running twice in the same minute
  if (cfg.lastRun) {
    const last = new Date(cfg.lastRun);
    const diffMin = (now.getTime() - last.getTime()) / 60_000;
    if (diffMin < 1) return false;
  }

  return true;
}

export const DB_DEFAULT_PORTS: Record<BackupType, string> = {
  files: '', firebird: '3050', sqlserver: '1433',
  postgresql: '5432', db2: '50000', oracle: '1521',
};
