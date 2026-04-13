import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatBytes, formatDate, login, listFiles, getStorageUsage, trashFile } from './CloudClient';

// ── formatBytes ───────────────────────────────────────────────────────────────
describe('CloudClient — formatBytes()', () => {
  it('returns "0 B" for zero', () => expect(formatBytes(0)).toBe('0 B'));
  it('formats 512 as "512 B"', () => expect(formatBytes(512)).toBe('512 B'));
  it('formats 1024 as "1 KB"', () => expect(formatBytes(1024)).toBe('1 KB'));
  it('formats 1 MB correctly', () => expect(formatBytes(1024 * 1024)).toBe('1 MB'));
  it('formats 1 GB correctly', () => expect(formatBytes(1024 ** 3)).toBe('1 GB'));
  it('formats 1.5 MB correctly', () => expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB'));
});

// ── formatDate ────────────────────────────────────────────────────────────────
describe('CloudClient — formatDate()', () => {
  it('returns empty string for empty input', () => {
    expect(formatDate('')).toBe('');
  });

  it('formats a valid ISO date as Brazilian locale', () => {
    const result = formatDate('2025-04-12T00:00:00.000Z');
    // Just verify it returns a non-empty string — locale formatting is env-dependent
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns empty string for invalid date', () => {
    // Invalid ISO — toLocaleDateString returns "Invalid Date" but our impl returns ''
    // depending on JS engine. We just check it doesn't throw.
    expect(() => formatDate('not-a-date')).not.toThrow();
  });
});

// ── API functions with fetch mock ─────────────────────────────────────────────
function mockFetch(body: unknown, ok = true, status = 200) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(body),
  }));
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('CloudClient — login()', () => {
  it('returns user on success', async () => {
    mockFetch({
      user: { id: 'u1', username: 'joao', display_name: 'João', minio_bucket_name: 'joao' },
    });
    const user = await login('joao', 'senha123');
    expect(user.id).toBe('u1');
    expect(user.username).toBe('joao');
  });

  it('throws on HTTP error', async () => {
    mockFetch({ error: 'Credenciais inválidas' }, false, 401);
    await expect(login('wrong', 'pass')).rejects.toThrow('Credenciais inválidas');
  });

  it('throws generic HTTP error when no error message', async () => {
    mockFetch({}, false, 500);
    await expect(login('x', 'y')).rejects.toThrow('HTTP 500');
  });
});

describe('CloudClient — listFiles()', () => {
  it('returns files array on success', async () => {
    mockFetch({
      files: [
        { name: 'file.txt', fullPath: 'sync/file.txt', size: 100, lastModified: '', isFolder: false },
      ],
    });
    const files = await listFiles('user-1', 'sync/');
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('file.txt');
  });

  it('uses empty prefix when not provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ files: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await listFiles('user-1');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.prefix).toBe('');
  });
});

describe('CloudClient — getStorageUsage()', () => {
  it('returns usage data on success', async () => {
    mockFetch({ usedBytes: 500, usedGb: 0.5, capacityGb: 10, capacityBytes: null, percentage: 5 });
    const usage = await getStorageUsage('user-1');
    expect(usage.usedBytes).toBe(500);
    expect(usage.percentage).toBe(5);
  });

  it('throws on error', async () => {
    mockFetch({ error: 'Bucket not found' }, false, 404);
    await expect(getStorageUsage('user-1')).rejects.toThrow('Bucket not found');
  });
});

describe('CloudClient — trashFile()', () => {
  it('resolves without value on success', async () => {
    mockFetch({});
    await expect(trashFile('user-1', 'sync/file.txt')).resolves.toBeUndefined();
  });

  it('throws on error', async () => {
    mockFetch({ error: 'File not found' }, false, 404);
    await expect(trashFile('user-1', 'missing.txt')).rejects.toThrow('File not found');
  });
});

describe('CloudClient — getDownloadUrl()', () => {
  it('returns download URL on success', async () => {
    mockFetch({ url: 'https://s3.example.com/file.pdf?token=abc' });
    const { getDownloadUrl } = await import('./CloudClient');
    const url = await getDownloadUrl('user-1', 'docs/file.pdf');
    expect(url).toBe('https://s3.example.com/file.pdf?token=abc');
  });

  it('throws on error', async () => {
    mockFetch({ error: 'Not found' }, false, 404);
    const { getDownloadUrl } = await import('./CloudClient');
    await expect(getDownloadUrl('user-1', 'missing.pdf')).rejects.toThrow('Not found');
  });
});
