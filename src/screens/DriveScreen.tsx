import React, { useEffect, useState, useCallback, useRef } from 'react';
import type { CloudFileEntry, SharedWithMeEntry, DriveSyncProgress } from '../preload';
import { FileTypeIcon } from '../components/Icons';

// ── Constants ─────────────────────────────────────────────────────────────────
const LETTERS = 'DEFGHIJKLMNOPQRSTUVWXYZ'.split('');

function formatBytes(b: number) {
  if (b === 0) return '0 B';
  const k = 1024, s = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return `${(b / Math.pow(k, i)).toFixed(1)} ${s[i]}`;
}

function formatDate(iso: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ProgressBar({ value, total, color = '#5caeff' }: { value: number; total: number; color?: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div style={{ height: 4, borderRadius: 4, background: 'var(--surface-3)', overflow: 'hidden', marginTop: 4 }}>
      <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 4, transition: 'width .3s' }} />
    </div>
  );
}

function SyncBadge({ syncing, done, total }: { syncing: boolean; done: number; total: number }) {
  if (!syncing && total === 0) return null;
  if (!syncing) return (
    <span style={{ fontSize: 10, color: '#2dbe6c', fontWeight: 700 }}>✓ Sincronizado</span>
  );
  return (
    <span style={{ fontSize: 10, color: '#fdc72e', fontWeight: 700 }}>
      Sincronizando… {done}/{total}
    </span>
  );
}

interface FileRowProps {
  entry: CloudFileEntry;
  prefix: string;
  onNavigate: (p: string) => void;
  onShare: (path: string, isFolder: boolean) => void;
  sharing: boolean;
}

function FileRow({ entry, prefix, onNavigate, onShare, sharing }: FileRowProps) {
  const fullPath = prefix ? `${prefix}${entry.name}` : entry.fullPath;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '7px 10px', borderRadius: 8,
      background: 'var(--surface-2)', border: '1px solid var(--border-dim)',
    }}>
      <div style={{ flexShrink: 0 }}>
        <FileTypeIcon name={entry.isFolder ? '/' : entry.name} isFolder={entry.isFolder} size={32} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13, fontWeight: 500, color: 'var(--text-primary)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            cursor: entry.isFolder ? 'pointer' : 'default',
          }}
          onClick={() => entry.isFolder && onNavigate(fullPath.endsWith('/') ? fullPath : fullPath + '/')}
        >
          {entry.name.replace(/\/$/, '')}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-disabled)', marginTop: 1 }}>
          {entry.isFolder ? 'Pasta' : `${formatBytes(entry.size)} · ${formatDate(entry.lastModified)}`}
        </div>
      </div>

      <button
        className="btn btn-ghost btn-sm"
        disabled={sharing}
        onClick={() => onShare(fullPath, entry.isFolder)}
        style={{ fontSize: 11, flexShrink: 0, whiteSpace: 'nowrap' }}
        title="Gerar link compartilhável"
      >
        {sharing ? '…' : '🔗 Gerar Link'}
      </button>
    </div>
  );
}

interface SharedRowProps {
  share: SharedWithMeEntry;
  onShare: (shareId: string) => void;
  sharing: boolean;
}

function SharedRow({ share, onShare, sharing }: SharedRowProps) {
  const fileName = share.file_path.split('/').filter(Boolean).pop() || share.file_path;
  const owner = share.owner_display_name || share.owner_username || '—';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '7px 10px', borderRadius: 8,
      background: 'var(--surface-2)', border: '1px solid var(--border-dim)',
    }}>
      <div style={{ flexShrink: 0 }}>
        <FileTypeIcon name={share.is_folder ? '/' : fileName} isFolder={share.is_folder} size={32} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {fileName}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-disabled)', marginTop: 1 }}>
          Compartilhado por {owner} ·
          <span style={{
            marginLeft: 5, padding: '1px 5px', borderRadius: 4,
            fontSize: 9, fontWeight: 700, background: 'rgba(92,174,255,.1)', color: '#5caeff',
          }}>
            {share.permission === 'editor' ? 'Editor' : 'Leitor'}
          </span>
        </div>
      </div>

      <button
        className="btn btn-ghost btn-sm"
        disabled={sharing}
        onClick={() => onShare(share.id)}
        style={{ fontSize: 11, flexShrink: 0, whiteSpace: 'nowrap' }}
        title="Gerar link compartilhável deste arquivo"
      >
        {sharing ? '…' : '🔗 Gerar Link'}
      </button>
    </div>
  );
}

// ── Share modal ───────────────────────────────────────────────────────────────
function ShareModal({ url, onClose }: { url: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,.7)',
      backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{
        width: 480, background: 'var(--surface-1)', borderRadius: 14,
        border: '1px solid var(--border-mid)', padding: 24,
        boxShadow: '0 24px 80px rgba(0,0,0,.6)',
      }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 16 }}>
          🔗 Link Compartilhável Gerado
        </div>

        <div style={{
          display: 'flex', gap: 8, alignItems: 'stretch',
        }}>
          <div style={{
            flex: 1, padding: '9px 12px', borderRadius: 8, fontSize: 12,
            background: 'var(--surface-2)', border: '1px solid var(--border-mid)',
            color: '#5caeff', fontFamily: 'monospace',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {url}
          </div>
          <button className="btn btn-primary" onClick={copy} style={{ flexShrink: 0 }}>
            {copied ? '✓ Copiado!' : 'Copiar'}
          </button>
        </div>

        <div style={{ fontSize: 11, color: 'var(--text-disabled)', marginTop: 10 }}>
          Qualquer pessoa com este link pode acessar o arquivo em drivego.app.br
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
          <button className="btn btn-ghost" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
type Tab = 'mine' | 'shared';

export default function DriveScreen() {
  const [config, setConfig]       = useState<{ letter: string; enabled: boolean }>({ letter: 'G', enabled: false });
  const [progress, setProgress]   = useState<DriveSyncProgress | null>(null);
  const [tab, setTab]             = useState<Tab>('mine');
  const [prefix, setPrefix]       = useState('');
  const [myFiles, setMyFiles]     = useState<CloudFileEntry[]>([]);
  const [sharedFiles, setShared]  = useState<SharedWithMeEntry[]>([]);
  const [loadingFiles, setLoading]= useState(false);
  const [sharingPath, setSharingPath] = useState<string | null>(null);
  const [shareModal, setShareModal]   = useState<string | null>(null);
  const [mapError, setMapError]       = useState<string | null>(null);
  const [mapping, setMapping]         = useState(false);

  const handlerRef = useRef<((e: Electron.IpcRendererEvent, p: DriveSyncProgress) => void) | null>(null);

  // Load config and status
  const loadConfig = useCallback(async () => {
    const cfg = await window.electronAPI.driveGetConfig();
    setConfig(cfg);
    const st = await window.electronAPI.driveGetStatus();
    setProgress(st);
  }, []);

  useEffect(() => {
    loadConfig();
    // Subscribe to live progress updates
    handlerRef.current = window.electronAPI.onDriveProgress((p) => setProgress(p));
    return () => {
      if (handlerRef.current) window.electronAPI.offDriveProgress(handlerRef.current);
    };
  }, [loadConfig]);

  // Load file list when tab changes or prefix changes
  useEffect(() => {
    if (tab === 'mine') {
      setLoading(true);
      window.electronAPI.driveListMyFiles(prefix)
        .then(setMyFiles)
        .finally(() => setLoading(false));
    } else {
      setLoading(true);
      window.electronAPI.driveListSharedWithMe()
        .then(setShared)
        .finally(() => setLoading(false));
    }
  }, [tab, prefix]);

  async function handleMap() {
    setMapping(true);
    setMapError(null);
    try {
      await window.electronAPI.driveMap(config.letter);
      setConfig((c) => ({ ...c, enabled: true }));
      const st = await window.electronAPI.driveGetStatus();
      setProgress(st);
    } catch (err) {
      setMapError(err instanceof Error ? err.message : String(err));
    } finally {
      setMapping(false);
    }
  }

  async function handleUnmap() {
    setMapping(true);
    setMapError(null);
    try {
      await window.electronAPI.driveUnmap(config.letter);
      setConfig((c) => ({ ...c, enabled: false }));
      const st = await window.electronAPI.driveGetStatus();
      setProgress(st);
    } catch (err) {
      setMapError(err instanceof Error ? err.message : String(err));
    } finally {
      setMapping(false);
    }
  }

  async function handleShareMyFile(filePath: string, isFolder: boolean) {
    setSharingPath(filePath);
    try {
      const url = await window.electronAPI.driveGenerateShareLink(filePath, isFolder);
      setShareModal(url);
    } catch (err) {
      alert(`Erro ao gerar link: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSharingPath(null);
    }
  }

  async function handleShareSharedFile(shareId: string) {
    setSharingPath(shareId);
    try {
      // For shared files, use the file_path of the share to generate a link via the owner
      const share = sharedFiles.find((s) => s.id === shareId);
      if (!share) throw new Error('Compartilhamento não encontrado');
      const url = await window.electronAPI.driveGenerateShareLink(share.file_path, share.is_folder);
      setShareModal(url);
    } catch (err) {
      alert(`Erro ao gerar link: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSharingPath(null);
    }
  }

  function navigateUp() {
    const parts = prefix.replace(/\/$/, '').split('/');
    parts.pop();
    setPrefix(parts.length > 0 ? parts.join('/') + '/' : '');
  }

  const isMapped   = progress?.status === 'mapped';
  const isSyncing  = progress?.syncingMyFiles || progress?.syncingShared;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Hero */}
      <div className="hero">
        <div className="hero-icon-wrap" style={{ fontSize: 22 }}>💽</div>
        <div>
          <div className="hero-title">Unidade Mapeada</div>
          <div className="hero-sub">
            {isMapped
              ? `Unidade ${config.letter}: mapeada — seus arquivos disponíveis no Explorer`
              : 'Configure uma letra de unidade para acessar seus arquivos'}
          </div>
        </div>
        <div className="hero-actions">
          {isMapped && (
            <button className="btn btn-ghost btn-sm" onClick={() => window.electronAPI.driveOpenFolder('mine')}>
              Abrir no Explorer
            </button>
          )}
          {isMapped && (
            <button className="btn btn-ghost btn-sm" disabled={isSyncing}
              onClick={() => window.electronAPI.driveSyncNow()}>
              {isSyncing ? '⟳ Sincronizando…' : '↺ Sincronizar agora'}
            </button>
          )}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* Drive config card */}
        <div style={{
          background: 'var(--surface-2)', borderRadius: 12,
          border: `1px solid ${isMapped ? 'rgba(45,190,108,.3)' : 'var(--border-dim)'}`,
          padding: '16px 18px',
          display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>

            {/* Status indicator */}
            <div style={{
              width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
              background: isMapped ? '#2dbe6c' : '#888',
              boxShadow: isMapped ? '0 0 8px rgba(45,190,108,.6)' : 'none',
            }} />

            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                {isMapped ? `Unidade ${config.letter}: — Mapeada` : 'Unidade não mapeada'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                {isMapped
                  ? 'Acesse seus arquivos em nuvem diretamente pelo Windows Explorer'
                  : 'Escolha uma letra e mapeie para acessar seus arquivos localmente'}
              </div>
            </div>

            {/* Letter picker */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Letra:</span>
              <select
                value={config.letter}
                disabled={isMapped}
                onChange={(e) => setConfig((c) => ({ ...c, letter: e.target.value }))}
                style={{
                  padding: '5px 8px', borderRadius: 7, fontSize: 13, fontWeight: 700,
                  border: '1px solid var(--border-mid)', background: 'var(--surface-1)',
                  color: 'var(--text-primary)', fontFamily: 'inherit', cursor: isMapped ? 'not-allowed' : 'pointer',
                }}
              >
                {LETTERS.map((l) => <option key={l} value={l}>{l}:</option>)}
              </select>

              {isMapped ? (
                <button className="btn btn-ghost btn-sm" onClick={handleUnmap} disabled={mapping}
                  style={{ color: '#f87171' }}>
                  {mapping ? '…' : 'Desconectar'}
                </button>
              ) : (
                <button className="btn btn-primary btn-sm" onClick={handleMap} disabled={mapping}>
                  {mapping ? '…' : `Mapear Unidade ${config.letter}:`}
                </button>
              )}
            </div>
          </div>

          {/* Error */}
          {mapError && (
            <div style={{
              fontSize: 12, color: '#f25757', background: 'rgba(242,87,87,.08)',
              border: '1px solid rgba(242,87,87,.2)', borderRadius: 6, padding: '6px 10px',
            }}>
              {mapError}
            </div>
          )}

          {/* Sync progress */}
          {isMapped && progress && (
            <div style={{ display: 'flex', gap: 20 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-disabled)' }}>Meus Arquivos</span>
                  <SyncBadge syncing={progress.syncingMyFiles} done={progress.myFilesDone} total={progress.myFilesTotal} />
                </div>
                {progress.syncingMyFiles && (
                  <ProgressBar value={progress.myFilesDone} total={progress.myFilesTotal} />
                )}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-disabled)' }}>Compartilhado comigo</span>
                  <SyncBadge syncing={progress.syncingShared} done={progress.sharedDone} total={progress.sharedTotal} />
                </div>
                {progress.syncingShared && (
                  <ProgressBar value={progress.sharedDone} total={progress.sharedTotal} color="#fdc72e" />
                )}
              </div>
            </div>
          )}
        </div>

        {/* File browser — only show when mapped */}
        {isMapped && (
          <>
            {/* Tabs */}
            <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border-dim)', paddingBottom: 8 }}>
              {(['mine', 'shared'] as Tab[]).map((t) => (
                <button key={t} onClick={() => { setTab(t); setPrefix(''); }} style={{
                  padding: '5px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
                  fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
                  background: tab === t ? 'rgba(92,174,255,.15)' : 'var(--surface-2)',
                  color: tab === t ? '#5caeff' : 'var(--text-muted)',
                }}>
                  {t === 'mine' ? '📁 Meus Arquivos' : '🤝 Compartilhado comigo'}
                </button>
              ))}

              {tab === 'mine' && (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                  {prefix && (
                    <button className="btn btn-ghost btn-sm" onClick={navigateUp} style={{ fontSize: 11 }}>
                      ← Voltar
                    </button>
                  )}
                  {prefix && (
                    <span style={{ fontSize: 11, color: 'var(--text-disabled)', fontFamily: 'monospace' }}>
                      /{prefix}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* File list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {loadingFiles ? (
                <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-disabled)', fontSize: 13 }}>
                  Carregando…
                </div>
              ) : tab === 'mine' ? (
                myFiles.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-icon-wrap" style={{ fontSize: 28 }}>📁</div>
                    <div className="empty-title">Sem arquivos</div>
                    <div className="empty-hint">Nenhum arquivo encontrado nesta pasta</div>
                  </div>
                ) : (
                  myFiles.map((f) => (
                    <FileRow
                      key={f.fullPath}
                      entry={f}
                      prefix={prefix}
                      onNavigate={setPrefix}
                      onShare={handleShareMyFile}
                      sharing={sharingPath === f.fullPath}
                    />
                  ))
                )
              ) : (
                sharedFiles.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-icon-wrap" style={{ fontSize: 28 }}>🤝</div>
                    <div className="empty-title">Nenhum arquivo compartilhado</div>
                    <div className="empty-hint">Arquivos compartilhados por colegas aparecem aqui</div>
                  </div>
                ) : (
                  sharedFiles.map((s) => (
                    <SharedRow
                      key={s.id}
                      share={s}
                      onShare={handleShareSharedFile}
                      sharing={sharingPath === s.id}
                    />
                  ))
                )
              )}
            </div>
          </>
        )}
      </div>

      {/* Share modal */}
      {shareModal && <ShareModal url={shareModal} onClose={() => setShareModal(null)} />}
    </div>
  );
}
