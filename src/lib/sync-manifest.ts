import fs from 'node:fs';

const MANIFEST_VERSION = 1;

export interface ManifestEntry {
  size: number;
  mtimeMs: number;
  remotePath: string;
  syncedAt: string;
  // ETag the server had for `remotePath` the last time *this* machine wrote or
  // confirmed it. Sent back as `expectedEtag` on the next upload so the server
  // can detect that another machine overwrote the file in between (optimistic
  // concurrency) — see uploader-main.ts uploadFileFromDisk().
  remoteEtag?: string;
}

export interface SyncManifest {
  version: number;
  entries: Record<string, ManifestEntry>;
}

function key(localPath: string): string {
  return localPath.toLowerCase().replace(/\\/g, '/');
}

export function loadManifest(manifestPath: string): SyncManifest {
  try {
    const raw = fs.readFileSync(manifestPath, 'utf-8');
    const parsed = JSON.parse(raw) as SyncManifest;
    if (parsed.version !== MANIFEST_VERSION) return empty();
    return parsed;
  } catch {
    return empty();
  }
}

function empty(): SyncManifest {
  return { version: MANIFEST_VERSION, entries: {} };
}

export function saveManifest(manifestPath: string, manifest: SyncManifest): void {
  try {
    fs.writeFileSync(manifestPath, JSON.stringify(manifest), 'utf-8');
  } catch { /* non-critical */ }
}

// Returns true when the local file is already synced and unchanged.
// Uses size + mtime with a 2-second tolerance for FAT/network drives.
export function isUpToDate(manifest: SyncManifest, localPath: string, stats: fs.Stats): boolean {
  const entry = manifest.entries[key(localPath)];
  if (!entry) return false;
  return entry.size === stats.size && Math.abs(entry.mtimeMs - stats.mtimeMs) < 2000;
}

export function markSynced(
  manifest: SyncManifest,
  localPath: string,
  stats: fs.Stats,
  remotePath: string,
  remoteEtag?: string,
): SyncManifest {
  return {
    ...manifest,
    entries: {
      ...manifest.entries,
      [key(localPath)]: {
        size: stats.size,
        mtimeMs: stats.mtimeMs,
        remotePath,
        syncedAt: new Date().toISOString(),
        remoteEtag,
      },
    },
  };
}

/** Looks up the manifest entry for a local file, if any (e.g. to read its last known remoteEtag). */
export function getManifestEntry(manifest: SyncManifest, localPath: string): ManifestEntry | undefined {
  return manifest.entries[key(localPath)];
}

export function removeEntry(manifest: SyncManifest, localPath: string): SyncManifest {
  const k = key(localPath);
  const { [k]: _removed, ...rest } = manifest.entries;
  return { ...manifest, entries: rest };
}

// Removes all entries whose local path starts with the given folder prefix.
export function purgeFolderEntries(manifest: SyncManifest, folderPath: string): SyncManifest {
  const prefix = key(folderPath.endsWith('\\') || folderPath.endsWith('/') ? folderPath : folderPath + '/');
  const entries = Object.fromEntries(
    Object.entries(manifest.entries).filter(([k]) => !k.startsWith(prefix)),
  );
  return { ...manifest, entries };
}
