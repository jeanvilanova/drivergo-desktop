import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';

const BASE_URL = 'https://sotduhwtkbswokzrorpf.supabase.co/functions/v1';
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNvdGR1aHd0a2Jzd29renJvcnBmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDM3MTMzMjUsImV4cCI6MjA1OTI4OTMyNX0.bE7fVBcNNUFWBsDxW3-qDWVrCL2PBzw_4j3xhvt9AWI';

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
): Promise<string> {
  const res = await fetch(`${BASE_URL}/get-upload-url`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ANON_KEY}`,
      apikey: ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ userId, filePath: remotePath, contentType }),
  });

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
): Promise<void> {
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
          resolve();
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
 * Public API — upload a file from disk to the cloud.
 * No size limit. Uses presigned URL → direct S3 PUT.
 */
export async function uploadFileFromDisk(
  userId: string,
  localPath: string,
  remotePath: string,
  onProgress?: (pct: number) => void,
): Promise<void> {
  const contentType = getMime(localPath);

  // 1. Get presigned URL (fast, tiny request)
  const uploadUrl = await getPresignedPutUrl(userId, remotePath, contentType);

  // 2. Stream the file directly to S3
  await putDirectToS3(uploadUrl, localPath, contentType, onProgress);
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
      fileStream.on('error', (err) => { fs.unlink(localPath, () => {}); reject(err); });
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
      fileStream.on('error', (err) => { fs.unlink(localPath, () => {}); reject(err); });
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
  // If edge function returned a relative URL (/share/token), make it absolute
  const url: string = json.shareUrl ?? '';
  if (url.startsWith('/')) return `https://drivego.app.br${url}`;
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
