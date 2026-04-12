import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { BackupConfig } from './backup-store';
import { updateBackupConfig } from './backup-store';
import { uploadFileFromDisk } from './uploader-main';
import { logInfo, logSuccess, logError } from './logger';

const execFileAsync = promisify(execFile);

// ── 7-Zip binary resolution ───────────────────────────────────────────────────
// In packaged app, 7zip-bin is unpacked from asar into app.asar.unpacked.
// We build the path directly from process.resourcesPath to avoid issues with
// how Vite bundles require() calls that return stale asar-internal paths.
function get7zaPath(): string {
  if (app.isPackaged) {
    // 7za.exe is copied via extraResource into the resources/ folder alongside app.asar
    return path.join(process.resourcesPath, '7za.exe');
  }
  // In dev: resolve from node_modules (project root is two levels up from .vite/build/)
  return path.join(__dirname, '..', '..', 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getBackupDir(configId: string): string {
  const dir = path.join(app.getPath('userData'), 'backups', configId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makeTempDir(configId: string): string {
  const dir = path.join(app.getPath('userData'), 'backups', `.tmp_${configId}_${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makeTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function applyLocalRetention(dir: string, keepCount: number) {
  try {
    const files = fs.readdirSync(dir)
      .filter((f) => !f.startsWith('.') && !f.startsWith('.tmp'))
      .map((f) => ({ fp: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime); // newest first

    for (const { fp } of files.slice(keepCount)) {
      fs.unlinkSync(fp);
      logInfo('backup', `Backup antigo removido: ${path.basename(fp)}`);
    }
  } catch (err) {
    logError('backup', 'Erro ao aplicar retenção local', String(err));
  }
}

// ── 7-Zip compression (ultra) ─────────────────────────────────────────────────
// Uses LZMA2 ultra compression (-mx=9) with solid archive and multithreading.
// Produces .7z files which are 30-70% smaller than ZIP.
async function compressWith7z(
  sources: string[],
  outFile: string,
  format: '7z' | 'zip' = '7z',
  compress = true,
): Promise<void> {
  const sevenZa = get7zaPath();
  // compress=true  → -mx=9 ultra (LZMA2), multi-thread, solid
  // compress=false → -mx=0 store mode (no compression, just archive)
  const args = [
    'a',
    `-t${format}`,
    compress ? '-mx=9' : '-mx=0',
    '-mmt=on',
    ...(compress && format === '7z' ? ['-ms=on'] : []),
    outFile,
    ...sources,
  ];
  await execFileAsync(sevenZa, args, { maxBuffer: 1024 * 1024 * 10 });
}

// ── File backup ───────────────────────────────────────────────────────────────
async function compressFiles(sourceFolders: string[], outFile: string, compress: boolean): Promise<void> {
  await compressWith7z(sourceFolders, outFile, '7z', compress);
}

// ── Firebird ──────────────────────────────────────────────────────────────────
async function runFirebirdBackup(cfg: BackupConfig, outFile: string): Promise<string> {
  const gbak = cfg.dbToolPath || 'gbak';
  const host  = cfg.dbHost || 'localhost';
  const source = cfg.dbFile
    ? `${host}:${cfg.dbFile}`
    : `${host}/${cfg.dbPort || '3050'}:${cfg.dbName}`;

  const tmpFile = outFile.replace(/\.7z$/, '.fbk');
  try {
    await execFileAsync(gbak, [
      '-backup', '-user', cfg.dbUser, '-password', cfg.dbPassword, source, tmpFile,
    ]);
    await compressWith7z([tmpFile], outFile, '7z', cfg.compress ?? true);
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
  return outFile;
}

// ── SQL Server ────────────────────────────────────────────────────────────────
async function runSqlServerBackup(cfg: BackupConfig, outFile: string): Promise<string> {
  const sqlcmd = cfg.dbToolPath || 'sqlcmd';
  const server = cfg.dbPort ? `${cfg.dbHost},${cfg.dbPort}` : cfg.dbHost;
  const tmpFile = outFile.replace(/\.7z$/, '.bak');
  const query = `BACKUP DATABASE [${cfg.dbName}] TO DISK = N'${tmpFile.replace(/'/g, "''")}' WITH INIT, NO_COMPRESSION;`;

  try {
    await execFileAsync(sqlcmd, ['-S', server, '-U', cfg.dbUser, '-P', cfg.dbPassword, '-Q', query]);
    await compressWith7z([tmpFile], outFile, '7z', cfg.compress ?? true);
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
  return outFile;
}

// ── PostgreSQL ────────────────────────────────────────────────────────────────
async function runPostgresBackup(cfg: BackupConfig, outFile: string): Promise<string> {
  const pgDump = cfg.dbToolPath || 'pg_dump';
  const tmpFile = outFile.replace(/\.7z$/, '.dump');
  try {
    await execFileAsync(
      pgDump,
      ['-h', cfg.dbHost, '-p', cfg.dbPort || '5432', '-U', cfg.dbUser, '-F', 'p', '-f', tmpFile, cfg.dbName],
      { env: { ...process.env, PGPASSWORD: cfg.dbPassword } },
    );
    await compressWith7z([tmpFile], outFile, '7z', cfg.compress ?? true);
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
  return outFile;
}

// ── DB2 ───────────────────────────────────────────────────────────────────────
async function runDb2Backup(cfg: BackupConfig, outDir: string, outFile: string): Promise<string> {
  const db2Tool = cfg.dbToolPath || 'db2';
  const tmpDir  = makeTempDir(cfg.id);
  await execFileAsync(db2Tool, ['backup', 'database', cfg.dbName, 'to', tmpDir]);

  const files = fs.readdirSync(tmpDir).filter((f) => !f.startsWith('.'));
  if (files.length === 0) throw new Error('DB2 backup não gerou arquivo');

  const tmpFiles = files.map((f) => path.join(tmpDir, f));
  await compressWith7z(tmpFiles, outFile, '7z', cfg.compress ?? true);
  for (const f of tmpFiles) fs.unlinkSync(f);
  fs.rmdirSync(tmpDir);
  return outFile;
}

// ── Oracle ────────────────────────────────────────────────────────────────────
async function runOracleBackup(cfg: BackupConfig, outFile: string): Promise<string> {
  const exp        = cfg.dbToolPath || 'exp';
  const connectStr = `${cfg.dbUser}/${cfg.dbPassword}@${cfg.dbHost}:${cfg.dbPort || '1521'}/${cfg.dbName}`;
  const tmpFile    = outFile.replace(/\.7z$/, '.dmp');
  try {
    await execFileAsync(exp, [`userid=${connectStr}`, `file=${tmpFile}`, 'full=y', 'compress=n']);
    await compressWith7z([tmpFile], outFile, '7z', cfg.compress ?? true);
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
  return outFile;
}

// ── Main entry point ──────────────────────────────────────────────────────────
export async function runBackup(cfg: BackupConfig, userId: string): Promise<void> {
  updateBackupConfig(cfg.id, { lastStatus: 'running', lastError: null });
  logInfo('backup', `Iniciando backup: ${cfg.name}`, cfg.type);

  try {
    const dir    = getBackupDir(cfg.id);
    const ts     = makeTimestamp();
    // All output files are .7z regardless of source type
    const outFile = path.join(dir, `backup_${ts}.7z`);

    if (cfg.type === 'files') {
      if (cfg.sourceFolders.length === 0) throw new Error('Nenhuma pasta selecionada');
      const compressLabel = (cfg.compress ?? true) ? '7-Zip ultra' : 'store (sem compressão)';
      logInfo('backup', `Arquivando ${cfg.sourceFolders.length} pasta(s) com ${compressLabel}: ${cfg.name}`);
      await compressFiles(cfg.sourceFolders, outFile, cfg.compress ?? true);

    } else if (cfg.type === 'db2') {
      logInfo('backup', `Executando backup DB2 + compressão: ${cfg.name}`);
      await runDb2Backup(cfg, dir, outFile);

    } else {
      logInfo('backup', `Executando backup ${cfg.type} + compressão ultra: ${cfg.name}`);
      switch (cfg.type) {
        case 'firebird':   await runFirebirdBackup(cfg, outFile);  break;
        case 'sqlserver':  await runSqlServerBackup(cfg, outFile); break;
        case 'postgresql': await runPostgresBackup(cfg, outFile);  break;
        case 'oracle':     await runOracleBackup(cfg, outFile);    break;
      }
    }

    // Verify file was created
    if (!fs.existsSync(outFile)) throw new Error('Arquivo de backup não foi gerado');

    const sizeMB = (fs.statSync(outFile).size / 1024 / 1024).toFixed(1);
    logInfo('backup', `Arquivo gerado: ${path.basename(outFile)} (${sizeMB} MB)`);

    // Upload to cloud storage
    const remotePath = `backups/${cfg.id}/${path.basename(outFile)}`;
    logInfo('backup', `Enviando para nuvem: ${cfg.name}`, remotePath);
    await uploadFileFromDisk(userId, outFile, remotePath);

    // Apply retention (keep only last N files)
    applyLocalRetention(dir, cfg.keepCount);

    updateBackupConfig(cfg.id, {
      lastStatus: 'success',
      lastRun: new Date().toISOString(),
      lastError: null,
    });
    logSuccess('backup', `Backup concluído: ${cfg.name}`, `${sizeMB} MB → ${remotePath}`);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    updateBackupConfig(cfg.id, { lastStatus: 'error', lastError: msg });
    logError('backup', `Falha no backup: ${cfg.name}`, msg);
    throw err;
  }
}
