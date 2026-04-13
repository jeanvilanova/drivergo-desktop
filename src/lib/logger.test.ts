import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  log, getEntries, clearEntries, setLogPush,
  logInfo, logSuccess, logWarn, logError,
  type LogEntry,
} from './logger';

// Suppress console output during tests
beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  clearEntries();
});

describe('logger — log()', () => {
  it('stores a log entry with correct fields', () => {
    log('info', 'sistema', 'App iniciado', 'detalhe');
    const entries = getEntries();
    expect(entries).toHaveLength(1);
    const e = entries[0];
    expect(e.level).toBe('info');
    expect(e.category).toBe('sistema');
    expect(e.message).toBe('App iniciado');
    expect(e.detail).toBe('detalhe');
    expect(e.id).toBeTruthy();
    expect(e.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('generates unique ids for each entry', () => {
    log('info', 'sistema', 'msg1');
    log('info', 'sistema', 'msg2');
    const [a, b] = getEntries();
    expect(a.id).not.toBe(b.id);
  });

  it('stores detail as undefined when omitted', () => {
    log('info', 'sistema', 'sem detalhe');
    expect(getEntries()[0].detail).toBeUndefined();
  });

  it('respects MAX_ENTRIES cap (500)', () => {
    for (let i = 0; i < 510; i++) log('info', 'sistema', `msg${i}`);
    expect(getEntries()).toHaveLength(500);
  });

  it('keeps the most recent entries when cap reached', () => {
    for (let i = 0; i < 505; i++) log('info', 'sistema', `msg${i}`);
    const entries = getEntries();
    expect(entries[0].message).toBe('msg5');
    expect(entries[499].message).toBe('msg504');
  });
});

describe('logger — getEntries()', () => {
  it('returns a defensive copy', () => {
    log('info', 'sistema', 'original');
    const copy = getEntries();
    copy.push({ id: 'x', time: '', level: 'info', category: 'sistema', message: 'injected' });
    expect(getEntries()).toHaveLength(1);
  });
});

describe('logger — clearEntries()', () => {
  it('empties the log', () => {
    log('info', 'sistema', 'a');
    log('error', 'sync', 'b');
    clearEntries();
    expect(getEntries()).toHaveLength(0);
  });
});

describe('logger — push callback', () => {
  it('calls push for each new entry', () => {
    const received: LogEntry[] = [];
    setLogPush((e) => received.push(e));
    log('warn', 'upload', 'aviso');
    expect(received).toHaveLength(1);
    expect(received[0].message).toBe('aviso');
    // Reset push callback — use a no-op so future log() calls don't accumulate
    setLogPush(() => {});
  });

  it('does not throw when push is not set', () => {
    expect(() => log('info', 'sistema', 'ok')).not.toThrow();
  });
});

describe('logger — convenience helpers', () => {
  it('logInfo sets level=info', () => {
    logInfo('sistema', 'msg');
    expect(getEntries()[0].level).toBe('info');
  });

  it('logSuccess sets level=success', () => {
    logSuccess('upload', 'ok');
    expect(getEntries()[0].level).toBe('success');
  });

  it('logWarn sets level=warn', () => {
    logWarn('sync', 'cuidado');
    expect(getEntries()[0].level).toBe('warn');
  });

  it('logError sets level=error', () => {
    logError('backup', 'falhou');
    expect(getEntries()[0].level).toBe('error');
  });
});
