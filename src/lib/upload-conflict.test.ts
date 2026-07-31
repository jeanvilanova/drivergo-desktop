import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import EventEmitter from 'node:events';

// Bug 3 (multi-station conflict): when the server reports that another
// machine already changed a synced file (409 from get-upload-url/multipart),
// uploadFileFromDisk() must never let the second machine silently overwrite
// it — it should retry against a conflict-copy path instead, preserving
// both versions.

// Fake node:https/node:http transport — simulates a PUT response with a
// configurable status/etag so we can exercise putDirectToS3() without a
// real socket.
class FakeClientRequest extends EventEmitter {
  destroy() { /* no-op */ }
}

function makeFakeResponse(statusCode: number, etag: string | null) {
  const res = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string> };
  res.statusCode = statusCode;
  res.headers = etag ? { etag: `"${etag}"` } : {};
  return res;
}

function mockTransport(statusCode: number, etag: string | null) {
  const requestImpl = (_opts: unknown, cb: (res: unknown) => void) => {
    const req = new FakeClientRequest();
    // fileStream.pipe(req) needs req to look writable — provide no-op write/end
    (req as any).write = () => true;
    (req as any).end = () => {
      const res = makeFakeResponse(statusCode, etag);
      cb(res);
      res.emit('data', Buffer.from(''));
      res.emit('end');
    };
    return req;
  };
  vi.doMock('node:https', () => ({ default: { request: requestImpl, Agent: class {} } }));
  vi.doMock('node:http', () => ({ default: { request: requestImpl, Agent: class {} } }));
}

let tmpDir: string;
let filePath: string;

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drivego-conflict-'));
  filePath = path.join(tmpDir, 'relatorio.docx');
  fs.writeFileSync(filePath, 'conteudo de teste');
});

describe('uploadFileFromDisk() — Bug 3 conflict handling', () => {
  it('uploads normally when the server reports no conflict', async () => {
    mockTransport(200, 'etag-v1');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, json: () => Promise.resolve({ url: 'https://s3.example/put' }),
    }));

    const { uploadFileFromDisk } = await import('./uploader-main');
    const result = await uploadFileFromDisk('user-1', filePath, 'sync/relatorio.docx', undefined, 'etag-v0');

    expect(result.conflict).toBe(false);
    expect(result.remotePath).toBe('sync/relatorio.docx');
    expect(result.etag).toBe('etag-v1');
  });

  it('retries to a conflict-copy path when the server rejects with 409', async () => {
    mockTransport(200, 'etag-mine');
    const fetchMock = vi.fn()
      // First attempt — server says another machine already changed the file
      .mockResolvedValueOnce({
        ok: false, status: 409, json: () => Promise.resolve({ conflict: true, currentEtag: 'etag-other-machine' }),
      })
      // Retry against the conflict-copy path — succeeds
      .mockResolvedValueOnce({
        ok: true, status: 200, json: () => Promise.resolve({ url: 'https://s3.example/put-conflict' }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const { uploadFileFromDisk } = await import('./uploader-main');
    const result = await uploadFileFromDisk(
      'user-1', filePath, 'sync/relatorio.docx', undefined, 'etag-stale',
    );

    expect(result.conflict).toBe(true);
    expect(result.remotePath).not.toBe('sync/relatorio.docx');
    expect(result.remotePath).toContain('relatorio (conflito -');
    expect(result.remotePath.endsWith('.docx')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // The retry must not send the stale ETag again — it's a brand new key.
    const retryBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(retryBody.expectedEtag).toBeUndefined();
  });

  it('does not send expectedEtag on the very first upload of a file', async () => {
    mockTransport(200, 'etag-new');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: () => Promise.resolve({ url: 'https://s3.example/put' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { uploadFileFromDisk } = await import('./uploader-main');
    await uploadFileFromDisk('user-1', filePath, 'sync/new-file.docx');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.expectedEtag).toBeUndefined();
  });
});

describe('buildConflictPath()', () => {
  it('inserts "(conflito - HOST - timestamp)" before the file extension', async () => {
    const { buildConflictPath } = await import('./uploader-main');
    const result = buildConflictPath('sync/Documentos/relatorio.docx');
    expect(result).toMatch(/^sync\/Documentos\/relatorio \(conflito - .+\)\.docx$/);
  });

  it('preserves files with no extension', async () => {
    const { buildConflictPath } = await import('./uploader-main');
    const result = buildConflictPath('sync/README');
    expect(result).toMatch(/^sync\/README \(conflito - .+\)$/);
  });
});
