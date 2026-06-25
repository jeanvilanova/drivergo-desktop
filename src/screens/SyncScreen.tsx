import React, { useEffect, useState, useCallback } from 'react';
import type { FolderStatus, SyncFolderInfo, DefaultFolder } from '../preload';
import type { CloudUser } from '../lib/CloudClient';
import {
  IconSync, IconPlus, IconTrash, IconRefresh, IconCheck, IconInfo, IconAlert, IconPause, IconPlay,
} from '../components/Icons';

interface Props {
  user: CloudUser;
  onFoldersChange?: (folders: SyncFolderInfo[]) => void;
}

// ── Status badge ──────────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<FolderStatus['status'], { label: string; color: string; bg: string; dot: string }> = {
  idle:     { label: 'Aguardando',    color: 'var(--text-muted)',        bg: 'rgba(255,255,255,.06)',  dot: 'rgba(255,255,255,.25)' },
  watching: { label: 'Monitorando',   color: 'var(--accent-green)',      bg: 'rgba(34,211,160,.12)',   dot: 'var(--accent-green)' },
  syncing:  { label: 'Sincronizando', color: 'var(--accent)',            bg: 'rgba(59,154,255,.15)',   dot: 'var(--accent)' },
  error:    { label: 'Erro',          color: 'var(--accent-red)',        bg: 'rgba(242,87,87,.12)',    dot: 'var(--accent-red)' },
  paused:   { label: 'Pausado',       color: 'rgba(253,199,46,.9)',      bg: 'rgba(253,199,46,.10)',   dot: 'rgba(253,199,46,.8)' },
};

function StatusBadge({ status }: { status: FolderStatus['status'] }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.idle;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 10px', borderRadius: 20,
      background: cfg.bg, color: cfg.color,
      fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
      border: `1px solid ${cfg.dot}30`,
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%', background: cfg.dot, flexShrink: 0,
        animation: status === 'syncing' ? 'pulse-dot .9s ease-in-out infinite' : 'none',
      }} />
      {cfg.label}
    </span>
  );
}

// ── Progress bar ──────────────────────────────────────────────────────────────
function ProgressBar({ done, total, fileProgress = 0 }: { done: number; total: number; fileProgress?: number }) {
  // Inclui a fração do arquivo em andamento para a barra se mover mesmo
  // quando há um único arquivo grande (ex.: 43 GB) ainda em envio.
  const effectiveDone = done + Math.min(Math.max(fileProgress, 0), 100) / 100;
  const pct = total > 0 ? Math.min(100, Math.round((effectiveDone / total) * 100)) : 0;
  const showFilePct = fileProgress > 0 && fileProgress < 100 && done < total;
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {done.toLocaleString()} / {total.toLocaleString()} arquivos
          {showFilePct && ` · enviando ${Math.round(fileProgress)}%`}
        </span>
        <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 700 }}>{pct}%</span>
      </div>
      <div className="prog-bar-bg" style={{ margin: 0 }}>
        <div className="prog-bar-fill" style={{ width: `${pct}%`, background: 'var(--accent)' }} />
      </div>
    </div>
  );
}

// ── Default status ─────────────────────────────────────────────────────────────
const DEFAULT_STATUS: FolderStatus = {
  localPath: '', status: 'idle', pendingFiles: 0,
  syncedFiles: 0, totalFiles: 0, lastSynced: null, errorMessage: null,
};

// ── Folder icon with status overlay ──────────────────────────────────────────
function FolderIconWithStatus({ status }: { status: FolderStatus['status'] }) {
  return (
    <div style={{ position: 'relative', flexShrink: 0, width: 46, height: 46 }}>
      {/* Folder base */}
      <div style={{
        width: 46, height: 46, borderRadius: 12,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 24,
        background: status === 'error'
          ? 'rgba(242,87,87,.12)'
          : status === 'watching'
          ? 'rgba(45,190,108,.10)'
          : status === 'syncing'
          ? 'rgba(92,174,255,.12)'
          : 'rgba(253,199,46,.10)',
        border: `1px solid ${
          status === 'error'   ? 'rgba(242,87,87,.25)'  :
          status === 'watching'? 'rgba(45,190,108,.25)' :
          status === 'syncing' ? 'rgba(92,174,255,.25)' :
                                 'rgba(253,199,46,.20)'
        }`,
        transition: 'background .3s, border-color .3s',
      }}>
        📁
      </div>

      {/* Status overlay badge — bottom-right corner */}
      <div style={{
        position: 'absolute', bottom: -3, right: -3,
        width: 18, height: 18, borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: '2px solid var(--surface-0)',
        background:
          status === 'watching' ? '#2dbe6c' :
          status === 'syncing'  ? '#5caeff' :
          status === 'error'    ? '#f25757' :
          'rgba(255,255,255,.2)',
        boxShadow: '0 1px 4px rgba(0,0,0,.4)',
        transition: 'background .3s',
      }}>
        {status === 'watching' && (
          // Checkmark SVG
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
            <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
        {status === 'syncing' && (
          // Spinning sync arrows SVG
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
            stroke="white" strokeWidth="2.5" strokeLinecap="round"
            style={{ animation: 'spin .9s linear infinite' }}>
            <path d="M21 2v6h-6"/>
            <path d="M3 12a9 9 0 0 1 15-6.7L21 8"/>
            <path d="M3 22v-6h6"/>
            <path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
          </svg>
        )}
        {status === 'error' && (
          // Exclamation mark
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
            <path d="M6 3v4" stroke="white" strokeWidth="2" strokeLinecap="round"/>
            <circle cx="6" cy="9.5" r="1" fill="white"/>
          </svg>
        )}
        {status === 'idle' && (
          <svg width="8" height="8" viewBox="0 0 12 12" fill="none">
            <path d="M3 6h6" stroke="white" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        )}
        {status === 'paused' && (
          <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
            <rect x="2" y="2" width="3" height="8" rx="1" fill="white"/>
            <rect x="7" y="2" width="3" height="8" rx="1" fill="white"/>
          </svg>
        )}
      </div>
    </div>
  );
}

// ── Folder card ───────────────────────────────────────────────────────────────
function FolderCard({ folder, onRemove, onResync, onPause, onResume }: {
  folder: SyncFolderInfo;
  onRemove: () => void;
  onResync: () => void;
  onPause: () => void;
  onResume: () => void;
}) {
  const status: FolderStatus = folder.status ?? DEFAULT_STATUS;
  const isSyncing = status.status === 'syncing';
  const isPaused  = status.status === 'paused';
  const isActive  = isSyncing || status.status === 'watching';

  return (
    <div className="folder-card">
      <FolderIconWithStatus status={status.status} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-hero)' }}>{folder.name}</span>
          <StatusBadge status={status.status} />
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {folder.localPath}
        </div>
        {status.errorMessage && (
          <div style={{
            marginTop: 7, fontSize: 11, color: 'var(--accent-red)',
            background: 'rgba(242,87,87,.1)', borderRadius: 7, padding: '5px 10px',
            display: 'flex', alignItems: 'center', gap: 6,
            border: '1px solid rgba(242,87,87,.2)',
          }}>
            <IconAlert size={12} /> {status.errorMessage}
          </div>
        )}
        {isSyncing && status.totalFiles > 0 && (
          <ProgressBar done={status.syncedFiles} total={status.totalFiles} fileProgress={status.uploadProgress ?? 0} />
        )}
        {isPaused && status.lastSynced && (
          <div style={{ marginTop: 5, fontSize: 11, color: 'rgba(253,199,46,.7)' }}>
            Pausado · última sync: {new Date(status.lastSynced).toLocaleString('pt-BR')}
          </div>
        )}
        {status.lastSynced && !isSyncing && !isPaused && (
          <div style={{ marginTop: 5, fontSize: 11, color: 'var(--text-muted)' }}>
            Última sync: {new Date(status.lastSynced).toLocaleString('pt-BR')}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'flex-start' }}>
        {/* Pause / Resume — visível apenas em estados ativos ou pausado */}
        {isActive && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={onPause}
            title="Pausar sincronização"
            style={{ color: 'rgba(253,199,46,.85)' }}
          >
            <IconPause size={13} />
          </button>
        )}
        {isPaused && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={onResume}
            title="Retomar sincronização"
            style={{ color: 'var(--accent-green)' }}
          >
            <IconPlay size={13} />
          </button>
        )}
        <button className="btn btn-ghost btn-sm" onClick={onResync} disabled={isSyncing || isPaused} title="Sincronizar agora">
          <IconRefresh size={13} />
        </button>
        <button className="btn btn-danger btn-sm" onClick={onRemove} title="Remover pasta">
          <IconTrash size={13} />
        </button>
      </div>
    </div>
  );
}

// ── Name modal ────────────────────────────────────────────────────────────────
function NameModal({ localPath, onConfirm, onCancel }: {
  localPath: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}) {
  const defaultName = localPath.split('\\').pop() || localPath;
  const [name, setName] = useState(defaultName);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">Nome da pasta</div>
        <div className="modal-sub">{localPath}</div>
        <div className="field">
          <label>Nome de exibição</label>
          <input
            autoFocus value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) onConfirm(name.trim()); }}
            placeholder="Ex: Documentos de Trabalho"
          />
        </div>
        <div className="modal-actions">
          <button className="btn btn-primary" style={{ flex: 1 }}
            onClick={() => name.trim() && onConfirm(name.trim())} disabled={!name.trim()}>
            Adicionar e sincronizar
          </button>
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onCancel}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

// ── Default folder emojis ─────────────────────────────────────────────────────
const DEFAULT_FOLDER_EMOJIS: Record<string, string> = {
  'Documentos': '📄', 'Imagens': '🖼️', 'Área de Trabalho': '🖥️',
  'Downloads': '⬇️', 'Vídeos': '🎬', 'Músicas': '🎵',
};

// ── Main screen ───────────────────────────────────────────────────────────────
export default function SyncScreen({ user, onFoldersChange }: Props) {
  const [folders, setFolders] = useState<SyncFolderInfo[]>([]);
  const [defaults, setDefaults] = useState<DefaultFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingPath, setPendingPath] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    const [f, d] = await Promise.all([
      window.electronAPI.syncGetFolders(),
      window.electronAPI.syncGetDefaultFolders(),
    ]);
    setFolders(f);
    setDefaults(d);
    setLoading(false);
    onFoldersChange?.(f);
  }, []);

  useEffect(() => {
    loadData();
    window.electronAPI.onSyncStatus((status) => {
      setFolders((prev) => {
        const next = prev.map((f) => f.localPath === status.localPath ? { ...f, status } : f);
        onFoldersChange?.(next);
        return next;
      });
    });
    return () => window.electronAPI.offSyncStatus();
  }, [loadData]);

  async function handleAdd(localPath: string, name: string) {
    setPendingPath(null);
    const folder = await window.electronAPI.syncAddFolder(localPath, name);
    setFolders((prev) => {
      const idx = prev.findIndex((f) => f.localPath === folder.localPath);
      const next = idx >= 0
        ? prev.map((f, i) => i === idx ? folder : f)
        : [...prev, folder];
      onFoldersChange?.(next);
      return next;
    });
  }

  async function handleRemove(localPath: string) {
    const folder = folders.find((f) => f.localPath === localPath);
    const name = folder?.name ?? localPath.split('\\').pop() ?? localPath;

    // Two-step confirmation: first confirm removal, then ask about cloud files
    const confirmRemove = confirm(
      `Remover "${name}" do monitoramento?\n\n` +
      `A pasta local NÃO será excluída do seu computador.\n\n` +
      `Clique OK para continuar.`
    );
    if (!confirmRemove) return;

    await window.electronAPI.syncRemoveFolder(localPath);
    setFolders((prev) => {
      const next = prev.filter((f) => f.localPath !== localPath);
      onFoldersChange?.(next);
      return next;
    });
  }

  async function handlePickFolder() {
    const picked = await window.electronAPI.syncPickFolder();
    if (picked) setPendingPath(picked);
  }

  const addedPaths = new Set(folders.map((f) => f.localPath));
  const syncingCount = folders.filter((f) => f.status?.status === 'syncing').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <style>{`
        @keyframes pulse-dot { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: .4; transform: scale(.75); } }
      `}</style>

      {/* Hero */}
      <div className="hero">
        <div className="hero-icon-wrap">
          <IconSync size={28} />
        </div>
        <div>
          <div className="hero-title">Sincronização</div>
          <div className="hero-sub">
            {loading ? 'Carregando…'
              : folders.length === 0 ? 'Nenhuma pasta monitorada'
              : `${folders.length} ${folders.length === 1 ? 'pasta' : 'pastas'} monitorada${folders.length > 1 ? 's' : ''}${syncingCount > 0 ? ` · ${syncingCount} sincronizando` : ''}`}
          </div>
        </div>
        <div className="hero-actions">
          <button className="btn btn-primary btn-sm" onClick={handlePickFolder}>
            <IconPlus size={14} /> Adicionar pasta…
          </button>
        </div>
      </div>

      <div className="sync-layout">

        {/* Monitored folders */}
        <div>
          <div className="sync-section-title">Pastas monitoradas</div>
          {loading ? (
            <div style={{ padding: 40, display: 'flex', justifyContent: 'center' }}>
              <div className="spinner" />
            </div>
          ) : folders.length === 0 ? (
            <div style={{
              background: 'rgba(255,255,255,.05)',
              border: '2px dashed rgba(255,255,255,.12)',
              borderRadius: 'var(--radius-lg)', padding: '40px 20px', textAlign: 'center',
            }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>🔄</div>
              <div style={{ fontWeight: 700, color: 'var(--text-main)', marginBottom: 6 }}>
                Nenhuma pasta monitorada
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Selecione as pastas padrão abaixo ou adicione uma pasta personalizada
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {folders.map((f) => (
                <FolderCard
                  key={f.localPath} folder={f}
                  onRemove={() => handleRemove(f.localPath)}
                  onResync={() => window.electronAPI.syncResync(f.localPath)}
                  onPause={() => window.electronAPI.syncPause(f.localPath)}
                  onResume={() => window.electronAPI.syncResume(f.localPath)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Default Windows folders */}
        <div>
          <div className="sync-section-title">Pastas padrão do Windows</div>
          <div className="defaults-grid">
            {defaults.map((d) => {
              const added = addedPaths.has(d.path);
              return (
                <button
                  key={d.path}
                  className="default-btn"
                  onClick={() => !added && handleAdd(d.path, d.name)}
                  disabled={added}
                >
                  <span style={{ position: 'relative', flexShrink: 0, display: 'inline-flex' }}>
                    <span className="default-btn-icon">{DEFAULT_FOLDER_EMOJIS[d.name] ?? '📁'}</span>
                    {added && (
                      <span style={{
                        position: 'absolute', bottom: -2, right: -4,
                        width: 14, height: 14, borderRadius: '50%',
                        background: '#2dbe6c', border: '2px solid var(--surface-1)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <svg width="8" height="8" viewBox="0 0 12 12" fill="none">
                          <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2.2"
                            strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </span>
                    )}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="default-btn-name" style={{ color: added ? 'var(--text-muted)' : 'rgba(255,255,255,.9)' }}>
                      {d.name}
                    </div>
                    <div className="default-btn-path">{d.path}</div>
                  </div>
                  {added && <span className="default-btn-check"><IconCheck size={14} /></span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Info */}
        <div className="info-box">
          <strong style={{ color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <IconInfo size={13} /> Como funciona
          </strong>
          <ul>
            <li>Ao adicionar, todos os arquivos existentes são enviados para a nuvem.</li>
            <li>Novos arquivos e alterações são detectados e enviados automaticamente em ~3 segundos.</li>
            <li>Arquivos ocultos (iniciando com ponto) são ignorados.</li>
            <li>Excluir arquivos localmente <strong style={{ color: 'var(--text-main)' }}>não exclui</strong> da nuvem.</li>
          </ul>
        </div>

      </div>

      {/* Name modal */}
      {pendingPath && (
        <NameModal
          localPath={pendingPath}
          onConfirm={(name) => handleAdd(pendingPath, name)}
          onCancel={() => setPendingPath(null)}
        />
      )}
    </div>
  );
}
