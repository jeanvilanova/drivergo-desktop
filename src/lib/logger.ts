// ── In-process activity logger ────────────────────────────────────────────────
// Keeps the last MAX_ENTRIES log entries in memory and forwards each new entry
// to the renderer via a push callback (set by main.ts after window is ready).

export interface LogEntry {
  id: string;
  time: string;   // ISO timestamp
  level: 'info' | 'success' | 'warn' | 'error';
  category: 'sistema' | 'sync' | 'upload' | 'pasta' | 'backup';
  message: string;
  detail?: string;
}

const MAX_ENTRIES = 500;
const entries: LogEntry[] = [];
let push: ((entry: LogEntry) => void) | null = null;

export function setLogPush(cb: (entry: LogEntry) => void) {
  push = cb;
}

export function log(
  level: LogEntry['level'],
  category: LogEntry['category'],
  message: string,
  detail?: string,
): void {
  const entry: LogEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    time: new Date().toISOString(),
    level,
    category,
    message,
    detail,
  };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.shift();
  push?.(entry);
  // Also mirror to Node console for debugging
  const prefix = `[${level.toUpperCase()}][${category}]`;
  if (level === 'error') console.error(prefix, message, detail ?? '');
  else if (level === 'warn') console.warn(prefix, message, detail ?? '');
  else console.log(prefix, message, detail ?? '');
}

export function getEntries(): LogEntry[] {
  return [...entries];
}

export function clearEntries(): void {
  entries.length = 0;
}

// Convenience helpers
export const logInfo    = (cat: LogEntry['category'], msg: string, detail?: string) => log('info',    cat, msg, detail);
export const logSuccess = (cat: LogEntry['category'], msg: string, detail?: string) => log('success', cat, msg, detail);
export const logWarn    = (cat: LogEntry['category'], msg: string, detail?: string) => log('warn',    cat, msg, detail);
export const logError   = (cat: LogEntry['category'], msg: string, detail?: string) => log('error',   cat, msg, detail);
