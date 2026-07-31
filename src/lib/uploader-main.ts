import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import os from 'node:os';

const BASE_URL = 'https://sotduhwtkbswokzrorpf.supabase.co/functions/v1';
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNvdGR1aHd0a2Jzd29renJvcnBmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyMTkwNTcsImV4cCI6MjA5MDc5NTA1N30.cXfR1DaHRQ2XwsXppbTn7W1FYEnKtlZVkSh9sMN2ikk';

const MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon',
  tiff: 'image/tiff',
  pdf: 'application/pdf',
  mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo',
  mkv: 'video/x-matroska', wmv: 'video/x-ms-wmv', webm: 'video/webm',
  m4v: 'video/x-m4v', flv: 'video/x-flv',
  mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', aac: 'audio/aac',
  ogg: 'audio/ogg', m4a: 'audio/mp4', wma: 'audio/x-ms-wma',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  txt: 'text/plain', csv: 'text/csv', json: 'application/json',
  html: 'text/html', css: 'text/css', js: 'text/javascript',
  ts: 'text/typescript', xml: 'application/xml',
  zip: 'application/zip', rar: 'application/x-rar-compressed',
  '7z': 'application/x-7z-compressed', tar: 'application/x-tar',
  gz: 'application/gzip', bz2: 'application/x-bzip2',
};

function getMime(filePath: string): string {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return MIME_MAP[ext] || 'application/octet-stream';
}

// Files larger than this go through S3 multipart upload. The single-PUT path
// hits EntityTooLarge above 5 GB on Hetzner/Ceph; multipart also adds
// per-part retry resilience for everything above the threshold.
const MULTIPART_THRESHOLD = 100 * 1024 * 1024; // 100 MB
const MIN_PART_SIZE = 64 * 1024 * 1024; // 64 MB
const MAX_PARTS = 9500; // safety margin below S3's 10 000-part hard limit
// Redes instáveis (ex.: link saturado para o Hetzner) derrubam conexões no
// meio de uploads grandes. Tentativas generosas + backoff exponencial fazem
// uma parte sobreviver a quedas transitórias em vez de abortar o upload todo.
const PART_RETRIES = 8;
const CONTROL_RETRIES = 4; // initiate/sign-part/complete/abort
// Timeout de OCIOSIDADE do socket: se a conexão travar (sem bytes) por esse
// tempo, presumimos socket morto e re-tentamos — em vez de esperar 1 h.
const PART_IDLE_TIMEOUT = 120_000; // 2 min sem atividade

// Conexões keep-alive reduzem reconexões TLS e quedas em links instáveis.
const keepAliveHttpsAgent = new https.Agent({ keepAlive: true, maxSockets: 4 });
const keepAliveHttpAgent = new http.Agent({ keepAlive: true, maxSockets: 4 });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Backoff exponencial (cap 30s) com jitter para espalhar re-tentativas. */
function backoffDelay(attempt: number): number {
  const base = Math.min(30_000, 500 * 2 ** (attempt - 1));
  return base + Math.floor(Math.random() * 500);
}

// Prefix path with \\?\ to bypass Windows MAX_PATH (260 chars) limit.
function toSafePath(localPath: string): string {
  return process.platform === 'win32' && !localPath.startsWith('\\\\')
    ? `\\\\?\\${localPath}`
    : localPath;
}

// Part size scales up for very large files so we never exceed MAX_PARTS,
// rounded to an 8 MB boundary.
function computePartSize(totalBytes: number): number {
  if (totalBytes / MIN_PART_SIZE <= MAX_PARTS) return MIN_PART_SIZE;
  const eightMB = 8 * 1024 * 1024;
  return Math.ceil(totalBytes / MAX_PARTS / eightMB) * eightMB;
}

/**
 * Classifies an error as a transient "file locked / not accessible" condition,
 * as opposed to a genuine failure. Locked files (e.g. NFe XMLs held open by
 * fiscal software, or Windows junctions) are not fatal — they get retried on
 * the next sync pass instead of being reported as hard errors.
 */
export function isLockedFileError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /EPERM|EBUSY|EACCES|ENOENT|não acessível|Erro ao ler arquivo/i.test(msg);
}

/**
 * Thrown when the server rejects an upload because the remote object was
 * modified since this machine last saw it (another machine synced a newer
 * version in between). Callers should not retry the same remotePath — see
 * uploadFileFromDisk(), which handles this by saving to a conflict copy.
 */
export class UploadConflictError extends Error {
  constructor(public readonly currentEtag: string | null) {
    super('O arquivo foi alterado por outro dispositivo antes deste envio.');
    this.name = 'UploadConflictError';
  }
}

/**
 * Builds a Dropbox-style conflict-copy path: "dir/name (conflito - HOST - timestamp).ext".
 * Used when the server reports that another machine changed the file first,
 * so both versions are preserved instead of one silently overwriting the other.
 */
export function buildConflictPath(remotePath: string): string {
  const ext = path.extname(remotePath);
  const base = remotePath.slice(0, remotePath.length - ext.length);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const host = os.hostname().replace(/[\\/:*?"<>|]/g, '_');
  return `${base} (conflito - ${host} - ${stamp})${ext}`;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Step 1 — ask the edge function for a presigned PUT URL.
 * This is a tiny JSON request, no file data involved.
 */
async function getPresignedPutUrl(
  userId: string,
  remotePath: string,
  contentType: string,
  expectedEtag?: string,
): Promise<string> {
  const res = await fetch(`${BASE_URL}/get-upload-url`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ANON_KEY}`,
      apikey: ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ userId, filePath: remotePath, contentType, expectedEtag }),
  });

  if (res.status === 409) {
    const j = await res.json().catch(() => ({}));
    throw new UploadConflictError(j.currentEtag ?? null);
  }

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); msg = j.error || msg; } catch { /* ignore */ }
    throw new Error(`Falha ao obter URL de upload: ${msg}`);
  }

  const { url } = await res.json();
  return url as string;
}

/**
 * Step 2 — PUT the file directly to S3 using the presigned URL.
 * Uses Node's native https.request() for reliable streaming of large files
 * without timeouts or buffering issues (unlike fetch + ReadableStream).
 */
async function putDirectToS3(
  url: string,
  localPath: string,
  contentType: string,
  onProgress?: (pct: number) => void,
): Promise<string | null> {
  // Prefix path with \\?\ to bypass Windows MAX_PATH (260 chars) limit
  const safePath = process.platform === 'win32' && !localPath.startsWith('\\\\')
    ? `\\\\?\\${localPath}`
    : localPath;

  let stat: fs.Stats;
  try {
    stat = fs.statSync(safePath);
  } catch {
    throw new Error(`Arquivo não acessível: ${path.basename(localPath)}`);
  }

  const totalBytes = stat.size;
  const parsed = new URL(url);
  const isHttps = parsed.protocol === 'https:';
  const transport = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const options: https.RequestOptions = {
      method: 'PUT',
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      headers: {
        'Content-Type': contentType,
        'Content-Length': totalBytes,
      },
      // 2 hour timeout — enough for very large files on slow connections
      timeout: 7200_000,
    };

    const req = transport.request(options, (res) => {
      let body = '';
      res.on('data', (c: Buffer) => { body += c.toString(); });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          const etag = res.headers.etag;
          resolve(etag ? etag.replace(/^"|"$/g, '') : null);
        } else {
          reject(new Error(`S3 PUT falhou: ${res.statusCode} — ${body.slice(0, 200)}`));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('S3 PUT expirou (timeout)'));
    });

    req.on('error', (err) => reject(new Error(`S3 PUT erro de rede: ${err.message}`)));

    // Stream file directly into the request — no buffering in memory
    let uploadedBytes = 0;
    const fileStream = fs.createReadStream(safePath);

    fileStream.on('data', (chunk: Buffer) => {
      uploadedBytes += chunk.length;
      if (onProgress && totalBytes > 0) {
        onProgress(Math.round((uploadedBytes / totalBytes) * 100));
      }
    });

    fileStream.on('error', (err) => {
      req.destroy();
      reject(new Error(`Erro ao ler arquivo: ${err.message}`));
    });

    fileStream.pipe(req);
  });
}

/**
 * List all remote paths under a given prefix.
 * Used by doInitialSync to skip files already in the cloud.
 * Returns a Set of full remote paths (e.g. "sync/Documentos/relatorio.pdf").
 */
export async function listRemotePaths(
  userId: string,
  prefix: string,
): Promise<Set<string>> {
  try {
    const res = await fetch(`${BASE_URL}/list-files`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ANON_KEY}`,
        apikey: ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId, prefix }),
    });
    if (!res.ok) return new Set();
    const json = await res.json();
    const files: Array<{ fullPath: string; isFolder: boolean }> = json.files ?? [];
    return new Set(files.filter((f) => !f.isFolder).map((f) => f.fullPath));
  } catch {
    return new Set(); // on error, treat as empty — upload everything
  }
}

/**
 * Like listRemotePaths(), but also returns each file's current ETag.
 * Used by the initial/differential sync to backfill the local manifest's
 * remoteEtag for files that were already in the cloud and therefore never
 * went through an upload on this machine — without this, a later local edit
 * to one of those files would have no ETag to compare against, and a
 * conflicting edit made from another machine in between would go undetected.
 */
export async function listRemoteFileEtags(
  userId: string,
  prefix: string,
): Promise<Map<string, string>> {
  try {
    const res = await fetch(`${BASE_URL}/list-files`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ANON_KEY}`,
        apikey: ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId, prefix }),
    });
    if (!res.ok) return new Map();
    const json = await res.json();
    const files: Array<{ fullPath: string; isFolder: boolean; etag?: string }> = json.files ?? [];
    const map = new Map<string, string>();
    for (const f of files) {
      if (!f.isFolder && f.etag) map.set(f.fullPath, f.etag);
    }
    return map;
  } catch {
    return new Map();
  }
}

// ---- Multipart upload (large files) ---------------------------------------

interface PartRef {
  partNumber: number;
  etag: string;
}

/**
 * Calls the `multipart` edge function for one control action, retrying
 * transient failures (network drop reaching the function, 5xx, 429) with
 * exponential backoff. Client errors (4xx other than 429) fail fast.
 */
async function multipartCall(
  userId: string,
  remotePath: string,
  action: 'initiate' | 'sign-part' | 'complete' | 'abort',
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= CONTROL_RETRIES; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${BASE_URL}/multipart`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ANON_KEY}`,
          apikey: ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userId, filePath: remotePath, action, ...extra }),
      });
    } catch (err) {
      // Couldn't even reach the edge function (network blip) — retry.
      lastErr = err;
      if (attempt < CONTROL_RETRIES) { await sleep(backoffDelay(attempt)); continue; }
      throw new Error(`Multipart ${action} sem rede: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (res.ok) return (await res.json()) as Record<string, unknown>;

    if (res.status === 409) {
      const j = await res.json().catch(() => ({}));
      throw new UploadConflictError(j.currentEtag ?? null);
    }

    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); msg = j.error || msg; } catch { /* ignore */ }
    // 5xx / 429 are transient — retry; other 4xx are client errors — fail fast.
    if ((res.status >= 500 || res.status === 429) && attempt < CONTROL_RETRIES) {
      lastErr = new Error(msg);
      await sleep(backoffDelay(attempt));
      continue;
    }
    throw new Error(`Multipart ${action} falhou: ${msg}`);
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** PUTs a single byte range [start, end] of the file, returning the ETag. */
function putPart(
  url: string,
  safePath: string,
  start: number,
  end: number,
  partLen: number,
  onPartProgress: (sent: number) => void,
): Promise<string> {
  const parsed = new URL(url);
  const isHttps = parsed.protocol === 'https:';
  const transport = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const options: https.RequestOptions = {
      method: 'PUT',
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      headers: { 'Content-Length': partLen },
      agent: isHttps ? keepAliveHttpsAgent : keepAliveHttpAgent,
      timeout: PART_IDLE_TIMEOUT, // socket idle timeout — detecta stall e re-tenta
    };

    let sent = 0;
    let settled = false;
    const fileStream = fs.createReadStream(safePath, { start, end });

    // Single teardown path: ensures both the socket and the file handle are
    // released on any outcome, so 8 retries × hundreds of parts never leak fds.
    const finish = (err: Error | null, etag?: string) => {
      if (settled) return;
      settled = true;
      fileStream.destroy();
      if (err) { req.destroy(); reject(err); }
      else resolve(etag!);
    };

    const req = transport.request(options, (res) => {
      let body = '';
      res.on('data', (c: Buffer) => { body += c.toString(); });
      res.on('end', () => {
        const etag = res.headers.etag; // Node lowercases header names
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300 && etag) {
          finish(null, etag);
        } else {
          finish(new Error(`Parte falhou: ${res.statusCode} — ${body.slice(0, 200)}`));
        }
      });
    });

    req.on('timeout', () => finish(new Error('Parte travada (sem dados por 2 min)')));
    req.on('error', (err) => finish(new Error(`Parte erro de rede: ${err.message}`)));

    fileStream.on('data', (chunk: Buffer) => { sent += chunk.length; onPartProgress(sent); });
    fileStream.on('error', (err) => finish(new Error(`Erro ao ler arquivo: ${err.message}`)));
    fileStream.pipe(req);
  });
}

/** Uploads one part with retries (re-signs the URL on each attempt). */
async function uploadPartWithRetry(
  userId: string,
  remotePath: string,
  uploadId: string,
  partNumber: number,
  safePath: string,
  start: number,
  end: number,
  partLen: number,
  onPartProgress: (sent: number) => void,
): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= PART_RETRIES; attempt++) {
    try {
      const signed = await multipartCall(userId, remotePath, 'sign-part', { uploadId, partNumber });
      const url = signed.url as string;
      return await putPart(url, safePath, start, end, partLen, onPartProgress);
    } catch (err) {
      lastErr = err;
      if (attempt < PART_RETRIES) {
        await sleep(backoffDelay(attempt)); // backoff exponencial + jitter
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Full multipart upload flow for a single large file. */
async function multipartUpload(
  userId: string,
  safePath: string,
  remotePath: string,
  totalBytes: number,
  contentType: string,
  onProgress?: (pct: number) => void,
  expectedEtag?: string,
): Promise<string | null> {
  const partSize = computePartSize(totalBytes);
  const numParts = Math.ceil(totalBytes / partSize);

  const init = await multipartCall(userId, remotePath, 'initiate', { contentType, expectedEtag });
  const uploadId = init.uploadId as string;
  if (!uploadId) throw new Error('Multipart: servidor não retornou uploadId');

  const parts: PartRef[] = [];
  let uploadedBytes = 0;

  try {
    for (let i = 0; i < numParts; i++) {
      const partNumber = i + 1;
      const start = i * partSize;
      const end = Math.min(start + partSize, totalBytes) - 1; // inclusive
      const partLen = end - start + 1;

      const etag = await uploadPartWithRetry(
        userId, remotePath, uploadId, partNumber, safePath, start, end, partLen,
        (sent) => {
          if (onProgress && totalBytes > 0) {
            onProgress(Math.round(((uploadedBytes + sent) / totalBytes) * 100));
          }
        },
      );

      uploadedBytes += partLen;
      parts.push({ partNumber, etag });
      if (onProgress) onProgress(Math.round((uploadedBytes / totalBytes) * 100));
    }

    const completed = await multipartCall(userId, remotePath, 'complete', { uploadId, parts });
    const etag = (completed.etag as string | undefined) ?? null;
    return etag ? etag.replace(/^"|"$/g, '') : null;
  } catch (err) {
    // Best-effort cleanup so we don't leave dangling parts billing storage.
    try { await multipartCall(userId, remotePath, 'abort', { uploadId }); } catch { /* ignore */ }
    throw err;
  }
}

export interface UploadResult {
  /** The remote path the file actually ended up at — differs from the
   * requested path when a conflict copy was created (see `conflict`). */
  remotePath: string;
  /** ETag S3 assigned to the uploaded object, if known. Feed this back as
   * `expectedEtag` on the next upload of the same remotePath. */
  etag: string | null;
  /** True when another machine had changed the file first, so this upload
   * was redirected to a conflict-copy path instead of overwriting it. */
  conflict: boolean;
}

/**
 * Public API — upload a file from disk to the cloud.
 * No size limit. Small files use a single presigned PUT; files above
 * MULTIPART_THRESHOLD use S3 multipart (resilient, no 5 GB ceiling).
 *
 * `expectedEtag` — pass the ETag this machine last recorded for `remotePath`
 * (from sync-manifest) so the server can detect that another machine
 * uploaded a newer version in between. On conflict, the file is
 * automatically re-uploaded to a conflict-copy path instead of silently
 * overwriting the other machine's version — see UploadConflictError.
 */
export async function uploadFileFromDisk(
  userId: string,
  localPath: string,
  remotePath: string,
  onProgress?: (pct: number) => void,
  expectedEtag?: string,
): Promise<UploadResult> {
  const contentType = getMime(localPath);
  const safePath = toSafePath(localPath);

  let totalBytes: number;
  try {
    totalBytes = fs.statSync(safePath).size;
  } catch {
    throw new Error(`Arquivo não acessível: ${path.basename(localPath)}`);
  }

  const attempt = async (target: string, etagHint?: string): Promise<{ etag: string | null }> => {
    if (totalBytes > MULTIPART_THRESHOLD) {
      const etag = await multipartUpload(userId, safePath, target, totalBytes, contentType, onProgress, etagHint);
      return { etag };
    }
    const uploadUrl = await getPresignedPutUrl(userId, target, contentType, etagHint);
    const etag = await putDirectToS3(uploadUrl, localPath, contentType, onProgress);
    return { etag };
  };

  try {
    const { etag } = await attempt(remotePath, expectedEtag);
    return { remotePath, etag, conflict: false };
  } catch (err) {
    if (!(err instanceof UploadConflictError)) throw err;
    // Another machine's version is on the server — never overwrite it.
    // Save this machine's edit alongside it instead, as a conflict copy.
    const conflictPath = buildConflictPath(remotePath);
    const { etag } = await attempt(conflictPath);
    return { remotePath: conflictPath, etag, conflict: true };
  }
}

/**
 * Get a presigned download URL for a cloud file.
 */
export async function getDownloadUrl(userId: string, remotePath: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/download-file`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ANON_KEY}`,
      apikey: ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ userId, filePath: remotePath }),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); msg = j.error || msg; } catch { /* ignore */ }
    throw new Error(`Falha ao obter URL de download: ${msg}`);
  }
  const { url } = await res.json();
  return url as string;
}

/**
 * Download a cloud file to a local path.
 */
export async function downloadFileToLocal(
  userId: string,
  remotePath: string,
  localPath: string,
): Promise<void> {
  const url = await getDownloadUrl(userId, remotePath);

  // Ensure parent directory exists
  fs.mkdirSync(path.dirname(localPath), { recursive: true });

  const parsed = new URL(url);
  const isHttps = parsed.protocol === 'https:';
  const transport = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const options: https.RequestOptions = {
      method: 'GET',
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      timeout: 7200_000,
    };

    const req = transport.request(options, (res) => {
      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error(`Download falhou: HTTP ${res.statusCode}`));
        return;
      }
      const fileStream = fs.createWriteStream(localPath);
      res.pipe(fileStream);
      fileStream.on('finish', () => { fileStream.close(); resolve(); });
      fileStream.on('error', (err) => { fs.unlink(localPath, () => undefined); reject(err); });
    });

    req.on('timeout', () => { req.destroy(); reject(new Error('Download expirou')); });
    req.on('error', (err) => reject(new Error(`Erro de rede: ${err.message}`)));
    req.end();
  });
}

/**
 * Download a file shared with the user from another user's bucket.
 * Uses the download-shared-file edge function which verifies file_shares permission.
 */
export async function downloadSharedFileToLocal(
  userId: string,
  shareId: string,
  localPath: string,
): Promise<void> {
  const res = await fetch(`${BASE_URL}/download-shared-file`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ANON_KEY}`,
      apikey: ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ userId, shareId }),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); msg = j.error || msg; } catch { /* ignore */ }
    throw new Error(`Falha ao obter URL: ${msg}`);
  }
  const { url } = await res.json();

  fs.mkdirSync(path.dirname(localPath), { recursive: true });

  const parsed = new URL(url as string);
  const isHttps = parsed.protocol === 'https:';
  const transport = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const options: https.RequestOptions = {
      method: 'GET',
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      timeout: 7200_000,
    };

    const req = transport.request(options, (res) => {
      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error(`Download compartilhado falhou: HTTP ${res.statusCode}`));
        return;
      }
      const fileStream = fs.createWriteStream(localPath);
      res.pipe(fileStream);
      fileStream.on('finish', () => { fileStream.close(); resolve(); });
      fileStream.on('error', (err) => { fs.unlink(localPath, () => undefined); reject(err); });
    });

    req.on('timeout', () => { req.destroy(); reject(new Error('Download expirou')); });
    req.on('error', (err) => reject(new Error(`Erro de rede: ${err.message}`)));
    req.end();
  });
}

export interface CloudFileEntry {
  name: string;
  fullPath: string;
  size: number;
  lastModified: string;
  isFolder: boolean;
}

/**
 * List all files under a prefix (non-recursive by default).
 */
export async function listCloudFiles(
  userId: string,
  prefix = '',
  recursive = false,
): Promise<CloudFileEntry[]> {
  const res = await fetch(`${BASE_URL}/list-files`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ANON_KEY}`,
      apikey: ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ userId, prefix, recursive }),
  });
  if (!res.ok) return [];
  const json = await res.json();
  return (json.files ?? []) as CloudFileEntry[];
}

export interface SharedWithMeEntry {
  id: string;
  owner_user_id: string;
  file_path: string;
  is_folder: boolean;
  permission: string;
  created_at: string;
  owner_username: string;
  owner_display_name: string;
}

/**
 * List files/folders shared with the current user by colleagues.
 */
export async function listSharedWithMe(userId: string): Promise<SharedWithMeEntry[]> {
  const res = await fetch(`${BASE_URL}/manage-shares`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ANON_KEY}`,
      apikey: ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'list-shared-with-me', userId }),
  });
  if (!res.ok) return [];
  const json = await res.json();
  return (json.shares ?? []) as SharedWithMeEntry[];
}

/**
 * Generate a public shareable link for a file or folder.
 */
export async function generateShareLink(
  userId: string,
  filePath: string,
  isFolder = false,
): Promise<string> {
  const res = await fetch(`${BASE_URL}/share-file`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ANON_KEY}`,
      apikey: ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      userId,
      filePath,
      isFolder,
      baseUrl: 'https://drivego.app.br',
    }),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); msg = j.error || msg; } catch { /* ignore */ }
    throw new Error(`Falha ao gerar link: ${msg}`);
  }
  const json = await res.json();
  // Edge function now returns share.html?token=TOKEN directly.
  // Keep the fallback transform for any cached/old-format URLs.
  const url: string = json.shareUrl ?? '';
  if (url.includes('/share.html')) return url; // already correct format
  const shareMatch = url.match(/\/share\/([^/?#]+)/);
  if (shareMatch) return `https://drivego.app.br/share.html?token=${shareMatch[1]}`;
  if (url.startsWith('/')) return `https://drivego.app.br/share.html?token=${url.split('/share/')[1] ?? ''}`;
  return url;
}

/**
 * Walk a folder recursively, returning all file paths.
 * Skips hidden files/folders (starting with dot) and system files.
 */
export function walkFolder(folderPath: string): string[] {
  const results: string[] = [];

  // Use \\?\ prefix on Windows to bypass MAX_PATH (260 char) limit
  function safePath(p: string) {
    if (process.platform !== 'win32' || p.startsWith('\\\\')) return p;
    return `\\\\?\\${p}`;
  }

  function walk(dir: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(safePath(dir), { withFileTypes: true });
    } catch {
      return; // permission denied or path too long — skip
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue; // skip hidden
      // Skip symlinks and Windows junctions to avoid EPERM errors.
      // These are special OS-managed paths (e.g. "Minhas Músicas" inside Documents)
      // that point elsewhere and must not be followed.
      if (entry.isSymbolicLink()) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        results.push(fullPath); // store without \\?\ prefix — applied on use
      }
    }
  }

  walk(folderPath);
  return results;
}
