import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { formatBytes, walkFolder, listRemotePaths, listCloudFiles, listSharedWithMe, generateShareLink } from './uploader-main';

function mockFetch(body: unknown, ok = true, status = 200) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(body),
  }));
}

beforeEach(() => vi.unstubAllGlobals());

// ── formatBytes ───────────────────────────────────────────────────────────────
describe('uploader-main — formatBytes()', () => {
  it('returns "0 B" for zero', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('formats bytes', () => {
    expect(formatBytes(512)).toBe('512 B');
  });

  it('formats kilobytes', () => {
    expect(formatBytes(1024)).toBe('1 KB');
  });

  it('formats megabytes', () => {
    expect(formatBytes(1024 * 1024)).toBe('1 MB');
  });

  it('formats gigabytes', () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1 GB');
  });

  it('formats fractional MB with one decimal', () => {
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB');
  });

  it('formats large TB value', () => {
    expect(formatBytes(2 * 1024 ** 4)).toBe('2 TB');
  });
});

// ── walkFolder ────────────────────────────────────────────────────────────────
describe('uploader-main — walkFolder()', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drivego-walk-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty array for empty folder', () => {
    expect(walkFolder(tmpDir)).toEqual([]);
  });

  it('returns files in root folder', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'a');
    fs.writeFileSync(path.join(tmpDir, 'b.txt'), 'b');
    const result = walkFolder(tmpDir);
    expect(result).toHaveLength(2);
    expect(result.some((f) => f.endsWith('a.txt'))).toBe(true);
    expect(result.some((f) => f.endsWith('b.txt'))).toBe(true);
  });

  it('recurses into subdirectories', () => {
    const sub = path.join(tmpDir, 'sub');
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(sub, 'nested.txt'), 'n');
    const result = walkFolder(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('nested.txt');
  });

  it('skips hidden files (starting with .)', () => {
    fs.writeFileSync(path.join(tmpDir, '.hidden'), 'h');
    fs.writeFileSync(path.join(tmpDir, 'visible.txt'), 'v');
    const result = walkFolder(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('visible.txt');
  });

  it('skips hidden directories', () => {
    const hiddenDir = path.join(tmpDir, '.git');
    fs.mkdirSync(hiddenDir);
    fs.writeFileSync(path.join(hiddenDir, 'HEAD'), 'ref: main');
    const result = walkFolder(tmpDir);
    expect(result).toHaveLength(0);
  });

  it('handles deep nesting', () => {
    const deep = path.join(tmpDir, 'a', 'b', 'c');
    fs.mkdirSync(deep, { recursive: true });
    fs.writeFileSync(path.join(deep, 'deep.txt'), 'd');
    expect(walkFolder(tmpDir)).toHaveLength(1);
  });

  it('returns absolute paths', () => {
    fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'x');
    const result = walkFolder(tmpDir);
    expect(path.isAbsolute(result[0])).toBe(true);
  });

  it('does not throw for non-existent folder', () => {
    expect(() => walkFolder('/caminho/inexistente/xyz')).not.toThrow();
  });

  it('returns empty array for non-existent folder', () => {
    expect(walkFolder('/caminho/inexistente/xyz')).toEqual([]);
  });
});

// ── listRemotePaths ───────────────────────────────────────────────────────────
describe('uploader-main — listRemotePaths()', () => {
  it('returns a Set of remote paths', async () => {
    mockFetch({
      files: [
        { fullPath: 'sync/a.txt', isFolder: false },
        { fullPath: 'sync/b.txt', isFolder: false },
      ],
    });
    const result = await listRemotePaths('user-1', 'sync/');
    expect(result instanceof Set).toBe(true);
    expect(result.has('sync/a.txt')).toBe(true);
    expect(result.has('sync/b.txt')).toBe(true);
  });

  it('excludes folders from the set', async () => {
    mockFetch({
      files: [
        { fullPath: 'sync/folder', isFolder: true },
        { fullPath: 'sync/file.txt', isFolder: false },
      ],
    });
    const result = await listRemotePaths('user-1', 'sync/');
    expect(result.has('sync/folder')).toBe(false);
    expect(result.has('sync/file.txt')).toBe(true);
  });

  it('returns empty Set on HTTP error', async () => {
    mockFetch({}, false, 500);
    const result = await listRemotePaths('user-1', 'sync/');
    expect(result.size).toBe(0);
  });

  it('returns empty Set on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network down')));
    const result = await listRemotePaths('user-1', 'sync/');
    expect(result.size).toBe(0);
  });
});

// ── listCloudFiles ────────────────────────────────────────────────────────────
describe('uploader-main — listCloudFiles()', () => {
  it('returns files array on success', async () => {
    mockFetch({ files: [{ name: 'test.pdf', fullPath: 'sync/test.pdf', size: 1024, isFolder: false }] });
    const result = await listCloudFiles('user-1', 'sync/');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('test.pdf');
  });

  it('returns empty array on HTTP error', async () => {
    mockFetch({}, false, 500);
    expect(await listCloudFiles('user-1')).toEqual([]);
  });

  it('uses empty prefix by default', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ files: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    await listCloudFiles('user-1');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.prefix).toBe('');
  });
});

// ── listSharedWithMe ──────────────────────────────────────────────────────────
describe('uploader-main — listSharedWithMe()', () => {
  it('returns shares on success', async () => {
    mockFetch({ shares: [{ id: 'sh1', file_path: 'docs/file.pdf', is_folder: false }] });
    const result = await listSharedWithMe('user-1');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('sh1');
  });

  it('returns empty array on HTTP error', async () => {
    mockFetch({}, false, 500);
    expect(await listSharedWithMe('user-1')).toEqual([]);
  });
});

// ── generateShareLink ─────────────────────────────────────────────────────────
describe('uploader-main — generateShareLink()', () => {
  it('returns absolute URL as-is', async () => {
    mockFetch({ shareUrl: 'https://drivego.app.br/share/abc123' });
    const url = await generateShareLink('user-1', 'docs/file.pdf');
    expect(url).toBe('https://drivego.app.br/share/abc123');
  });

  it('prefixes relative URL with base URL', async () => {
    mockFetch({ shareUrl: '/share/abc123' });
    const url = await generateShareLink('user-1', 'docs/file.pdf');
    expect(url).toBe('https://drivego.app.br/share/abc123');
  });

  it('throws on HTTP error with server message', async () => {
    mockFetch({ error: 'Arquivo não encontrado' }, false, 404);
    await expect(generateShareLink('user-1', 'missing.pdf')).rejects.toThrow('Arquivo não encontrado');
  });

  it('throws generic error when no message', async () => {
    mockFetch({}, false, 500);
    await expect(generateShareLink('user-1', 'x.pdf')).rejects.toThrow('HTTP 500');
  });
});
