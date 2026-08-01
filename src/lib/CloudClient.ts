const BASE_URL = 'https://sotduhwtkbswokzrorpf.supabase.co/functions/v1';
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNvdGR1aHd0a2Jzd29renJvcnBmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyMTkwNTcsImV4cCI6MjA5MDc5NTA1N30.cXfR1DaHRQ2XwsXppbTn7W1FYEnKtlZVkSh9sMN2ikk';

export interface CloudUser {
  id: string;
  username: string;
  email: string;
  minio_bucket_name: string;
  sessionToken: string;
}

export interface CloudFile {
  name: string;
  fullPath: string;
  size: number;
  lastModified: string;
  isFolder: boolean;
}

export interface StorageUsage {
  usedBytes: number;
  usedGb: number;
  capacityGb: number | null;
  capacityBytes: number | null;
  percentage: number | null;
}

const headers = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${ANON_KEY}`,
  apikey: ANON_KEY,
};

// Set once after login/session-restore (see renderer.tsx) and injected into
// every call below — every other user-facing edge function now requires a
// real session token matching the userId, not just a client-supplied id.
let currentSessionToken = '';
export function setSessionToken(token: string): void {
  currentSessionToken = token;
}

async function call<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BASE_URL}/${fn}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...body, sessionToken: currentSessionToken }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json as T;
}

export async function login(email: string, password: string): Promise<CloudUser> {
  const data = await call<{ user: Omit<CloudUser, 'sessionToken'>; sessionToken: string }>('user-login', { email, password });
  const user = { ...data.user, sessionToken: data.sessionToken };
  setSessionToken(data.sessionToken);
  return user;
}

export async function listFiles(userId: string, prefix?: string): Promise<CloudFile[]> {
  const data = await call<{ files: CloudFile[] }>('list-files', { userId, prefix: prefix || '' });
  return data.files;
}

export async function getDownloadUrl(userId: string, filePath: string): Promise<string> {
  const data = await call<{ url: string }>('download-file', { userId, filePath });
  return data.url;
}

export async function trashFile(userId: string, filePath: string): Promise<void> {
  await call('trash-file', { userId, filePath });
}

export interface TrashedFile {
  id: string;
  name: string;
  fullPath: string;
  originalPath: string;
  size: number;
  deletedAt: string;
  isFolder: boolean;
}

export async function listTrashedFiles(userId: string): Promise<TrashedFile[]> {
  const data = await call<{ files: TrashedFile[] }>('list-trash', { userId });
  return data.files;
}

// restore-file espera trashId (id do registro na tabela trashed_files)
export async function restoreFile(userId: string, trashId: string): Promise<void> {
  await call('restore-file', { userId, trashId });
}

// permanent-delete espera trashId
export async function permanentDeleteFile(userId: string, trashId: string): Promise<void> {
  await call('permanent-delete', { userId, trashId });
}

export async function emptyTrash(userId: string): Promise<void> {
  await call('empty-trash', { userId });
}

export async function createFolder(userId: string, folderPath: string): Promise<void> {
  await call('create-folder', { userId, folderPath });
}

// rename usa move-file do backend (suporta sourcePath + newPath)
export async function renameFile(
  userId: string,
  oldPath: string,
  newPath: string,
): Promise<void> {
  await call('move-file', { userId, sourcePath: oldPath, newPath });
}

export async function getStorageUsage(userId: string): Promise<StorageUsage> {
  return call<StorageUsage>('storage-usage', { userId });
}

export async function uploadFile(
  userId: string,
  filePath: string,
  fileOrPath: File | string,
  mimeType: string,
  onProgress?: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE_URL}/upload-file`, true);
    xhr.setRequestHeader('Authorization', `Bearer ${ANON_KEY}`);
    xhr.setRequestHeader('apikey', ANON_KEY);
    xhr.setRequestHeader('Content-Type', mimeType || 'application/octet-stream');
    xhr.setRequestHeader('x-user-id', userId);
    xhr.setRequestHeader('x-file-path', encodeURIComponent(filePath));
    xhr.setRequestHeader('x-session-token', currentSessionToken);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload falhou: ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('Erro de rede no upload'));
    xhr.ontimeout = () => reject(new Error('Upload expirou'));

    xhr.send(fileOrPath as File);
  });
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function formatDate(iso: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('pt-BR', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
  } catch {
    return '';
  }
}
