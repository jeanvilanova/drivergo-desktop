import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock localStorage (browser API not available in Node) ────────────────────
const store: Record<string, string> = {};
const localStorageMock = {
  getItem:    (k: string) => store[k] ?? null,
  setItem:    (k: string, v: string) => { store[k] = v; },
  removeItem: (k: string) => { delete store[k]; },
  clear:      () => { Object.keys(store).forEach((k) => delete store[k]); },
};
vi.stubGlobal('localStorage', localStorageMock);

import { saveSession, loadSession, clearSession } from './session';
import type { CloudUser } from './CloudClient';

function makeUser(overrides: Partial<CloudUser> = {}): CloudUser {
  return {
    id: 'user-001',
    username: 'testuser',
    email: 'testuser@example.com',
    minio_bucket_name: 'testuser-bucket',
    sessionToken: 'token-abc',
    ...overrides,
  };
}

beforeEach(() => {
  localStorageMock.clear();
});

describe('session — saveSession()', () => {
  it('persists user to localStorage', () => {
    saveSession(makeUser());
    expect(store['drivergo_user']).toBeTruthy();
  });

  it('stores user as valid JSON', () => {
    saveSession(makeUser({ username: 'joao' }));
    const parsed = JSON.parse(store['drivergo_user']);
    expect(parsed.username).toBe('joao');
  });
});

describe('session — loadSession()', () => {
  it('returns null when nothing stored', () => {
    expect(loadSession()).toBeNull();
  });

  it('returns the saved user', () => {
    saveSession(makeUser({ id: 'abc-123' }));
    const loaded = loadSession();
    expect(loaded?.id).toBe('abc-123');
  });

  it('returns null for malformed JSON without throwing', () => {
    store['drivergo_user'] = '{invalid json';
    expect(loadSession()).toBeNull();
  });

  it('returns full user object with all fields', () => {
    const user = makeUser({ email: 'jean@example.com', minio_bucket_name: 'jean-bucket' });
    saveSession(user);
    const loaded = loadSession()!;
    expect(loaded.email).toBe('jean@example.com');
    expect(loaded.minio_bucket_name).toBe('jean-bucket');
  });
});

describe('session — clearSession()', () => {
  it('removes the stored session', () => {
    saveSession(makeUser());
    clearSession();
    expect(loadSession()).toBeNull();
  });

  it('does not throw when nothing is stored', () => {
    expect(() => clearSession()).not.toThrow();
  });
});
