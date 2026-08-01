import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const TEST_DIR = path.join(os.tmpdir(), 'drivego-test-profile-store');

vi.mock('electron', () => ({
  app: { getPath: () => TEST_DIR, isPackaged: false },
}));

import { activateProfile, deactivateProfile, getProfileConfigPath, type ProfileUser } from './profile-store';

function makeUser(overrides: Partial<ProfileUser> = {}): ProfileUser {
  return {
    id: 'user-001',
    username: 'joao',
    email: 'joao@example.com',
    minio_bucket_name: 'joao-bucket',
    ...overrides,
  };
}

beforeEach(async () => {
  // Ensure clean state: deactivate any active profile
  deactivateProfile();
  // Clean test directory
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });
});

// ── getProfileConfigPath — sem perfil ativo ──────────────────────────────────
describe('profile-store — getProfileConfigPath (no active profile)', () => {
  it('falls back to userData root when no profile is active', () => {
    const p = getProfileConfigPath('sync-config.json');
    expect(p).toBe(path.join(TEST_DIR, 'sync-config.json'));
  });
});

// ── activateProfile ───────────────────────────────────────────────────────────
describe('profile-store — activateProfile()', () => {
  it('creates the profile directory', async () => {
    await activateProfile(makeUser());
    const profileDir = path.join(TEST_DIR, 'profiles', 'user-001');
    expect(fs.existsSync(profileDir)).toBe(true);
  });

  it('writes profile.json with correct fields', async () => {
    await activateProfile(makeUser());
    const profileJson = path.join(TEST_DIR, 'profiles', 'user-001', 'profile.json');
    const data = JSON.parse(fs.readFileSync(profileJson, 'utf-8'));
    expect(data.id).toBe('user-001');
    expect(data.username).toBe('joao');
    expect(data.email).toBe('joao@example.com');
    expect(data.loginAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('getProfileConfigPath returns path inside profile dir after activation', async () => {
    await activateProfile(makeUser({ id: 'user-002' }));
    const p = getProfileConfigPath('sync-config.json');
    expect(p).toBe(path.join(TEST_DIR, 'profiles', 'user-002', 'sync-config.json'));
  });

  it('is idempotent — calling twice overwrites profile.json', async () => {
    const user = makeUser();
    await activateProfile(user);
    await activateProfile(user);
    const profileJson = path.join(TEST_DIR, 'profiles', 'user-001', 'profile.json');
    expect(fs.existsSync(profileJson)).toBe(true);
  });

  it('switches to different user correctly', async () => {
    await activateProfile(makeUser({ id: 'user-A' }));
    await activateProfile(makeUser({ id: 'user-B' }));
    const p = getProfileConfigPath('sync-config.json');
    expect(p).toContain('user-B');
    expect(p).not.toContain('user-A');
  });
});

// ── deactivateProfile ─────────────────────────────────────────────────────────
describe('profile-store — deactivateProfile()', () => {
  it('resets getProfileConfigPath to userData root after deactivation', async () => {
    await activateProfile(makeUser());
    deactivateProfile();
    const p = getProfileConfigPath('sync-config.json');
    expect(p).toBe(path.join(TEST_DIR, 'sync-config.json'));
  });

  it('calling deactivate without prior activate does not throw', () => {
    expect(() => deactivateProfile()).not.toThrow();
  });
});

// ── segurança: path traversal ─────────────────────────────────────────────────
describe('profile-store — path traversal protection', () => {
  const profilesBase = path.join(TEST_DIR, 'profiles');

  it('path stays inside profiles/ with a slashed ID', async () => {
    await activateProfile(makeUser({ id: '../../../etc/passwd' }));
    const p = path.resolve(getProfileConfigPath('sync-config.json'));
    // The resolved path must start with the profiles base — no escape
    expect(p.startsWith(path.resolve(profilesBase))).toBe(true);
  });

  it('path stays inside profiles/ with a backslashed ID', async () => {
    await activateProfile(makeUser({ id: '..\\..\\Windows\\System32' }));
    const p = path.resolve(getProfileConfigPath('sync-config.json'));
    expect(p.startsWith(path.resolve(profilesBase))).toBe(true);
  });

  it('path stays inside profiles/ with null bytes in ID', async () => {
    await activateProfile(makeUser({ id: 'user\0malicious' }));
    const p = getProfileConfigPath('sync-config.json');
    expect(p).not.toContain('\0');
    expect(path.resolve(p).startsWith(path.resolve(profilesBase))).toBe(true);
  });

  it('sanitized directory is created as a literal name, not resolved path', async () => {
    await activateProfile(makeUser({ id: '../escape' }));
    // Must be a direct child of profiles/, not go up a level
    const profileDir = path.dirname(getProfileConfigPath('sync-config.json'));
    expect(path.dirname(profileDir)).toBe(profilesBase);
  });
});

// ── isolação entre usuários ───────────────────────────────────────────────────
describe('profile-store — user isolation', () => {
  it('user A and user B have separate config paths', async () => {
    await activateProfile(makeUser({ id: 'user-A' }));
    const pathA = getProfileConfigPath('sync-config.json');

    await activateProfile(makeUser({ id: 'user-B' }));
    const pathB = getProfileConfigPath('sync-config.json');

    expect(pathA).not.toBe(pathB);
    expect(pathA).toContain('user-A');
    expect(pathB).toContain('user-B');
  });
});
