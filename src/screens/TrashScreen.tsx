import React, { useState, useEffect, useCallback } from 'react';
import { listTrashedFiles, restoreFile, permanentDeleteFile, emptyTrash, formatBytes, formatDate } from '../lib/CloudClient';
import type { TrashedFile, CloudUser } from '../lib/CloudClient';
import { FileTypeIcon, IconTrash, IconRefresh } from '../components/Icons';

interface Props { user: CloudUser }

const IconRestore = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
  </svg>
);

export default function TrashScreen({ user }: Props) {
  const [files, setFiles] = useState<TrashedFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyPaths, setBusyPaths] = useState<Set<string>>(new Set());

  const fetchTrash = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await listTrashedFiles(user.id);
      setFiles(data);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('404') || msg.includes('not found')) {
        setError('A lixeira ainda não está disponível no servidor. Contate o suporte.');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [user.id]);

  useEffect(() => { fetchTrash(); }, [fetchTrash]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === files.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(files.map((f) => f.id)));
    }
  }

  async function handleRestore(file: TrashedFile) {
    setBusyPaths((p) => new Set(p).add(file.id));
    try {
      await restoreFile(user.id, file.id);
      setFiles((prev) => prev.filter((f) => f.id !== file.id));
      setSelected((prev) => { const n = new Set(prev); n.delete(file.id); return n; });
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'Erro ao restaurar');
    } finally {
      setBusyPaths((p) => { const n = new Set(p); n.delete(file.id); return n; });
    }
  }

  async function handlePermanentDelete(file: TrashedFile) {
    const name = file.name.split('/').filter(Boolean).pop() || file.name;
    if (!confirm(`Excluir permanentemente "${name}"?\n\nEsta ação não pode ser desfeita.`)) return;
    setBusyPaths((p) => new Set(p).add(file.id));
    try {
      await permanentDeleteFile(user.id, file.id);
      setFiles((prev) => prev.filter((f) => f.id !== file.id));
      setSelected((prev) => { const n = new Set(prev); n.delete(file.id); return n; });
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'Erro ao excluir');
    } finally {
      setBusyPaths((p) => { const n = new Set(p); n.delete(file.id); return n; });
    }
  }

  async function handleRestoreSelected() {
    for (const id of selected) {
      const file = files.find((f) => f.id === id);
      if (file) await handleRestore(file);
    }
  }

  async function handleDeleteSelected() {
    if (!confirm(`Excluir permanentemente ${selected.size} item(ns)?\n\nEsta ação não pode ser desfeita.`)) return;
    const ids = [...selected];
    for (const id of ids) {
      const file = files.find((f) => f.id === id);
      if (!file) continue;
      setBusyPaths((p) => new Set(p).add(id));
      try {
        await permanentDeleteFile(user.id, id);
        setFiles((prev) => prev.filter((f) => f.id !== id));
        setSelected((prev) => { const n = new Set(prev); n.delete(id); return n; });
      } catch (e: unknown) {
        setActionError(e instanceof Error ? e.message : 'Erro ao excluir');
      } finally {
        setBusyPaths((p) => { const n = new Set(p); n.delete(id); return n; });
      }
    }
  }

  async function handleEmptyTrash() {
    if (!confirm(`Esvaziar a lixeira? Todos os ${files.length} item(ns) serão excluídos permanentemente.\n\nEsta ação não pode ser desfeita.`)) return;
    try {
      await emptyTrash(user.id);
      setFiles([]);
      setSelected(new Set());
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'Erro ao esvaziar lixeira');
    }
  }

  const hasSelected = selected.size > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Hero */}
      <div className="hero">
        <div className="hero-icon-wrap">🗑️</div>
        <div>
          <div className="hero-title">Lixeira</div>
          <div className="hero-sub">
            {loading ? 'Carregando…' : `${files.length} ${files.length === 1 ? 'item' : 'itens'} na lixeira`}
          </div>
        </div>
        <div className="hero-actions">
          <button className="btn btn-ghost btn-sm" onClick={fetchTrash} title="Atualizar">
            <IconRefresh size={14} /> Atualizar
          </button>
          {hasSelected && (
            <>
              <button className="btn btn-ghost btn-sm" onClick={handleRestoreSelected}
                style={{ color: 'var(--accent-green)' }}>
                <IconRestore size={14} /> Restaurar ({selected.size})
              </button>
              <button className="btn btn-danger btn-sm" onClick={handleDeleteSelected}>
                <IconTrash size={14} /> Excluir ({selected.size})
              </button>
            </>
          )}
          {files.length > 0 && !hasSelected && (
            <button className="btn btn-danger btn-sm" onClick={handleEmptyTrash}>
              <IconTrash size={14} /> Esvaziar lixeira
            </button>
          )}
        </div>
      </div>

      {/* Action error */}
      {actionError && (
        <div style={{
          margin: '6px 16px 0', padding: '8px 14px', borderRadius: 8,
          background: 'rgba(242,87,87,.12)', border: '1px solid rgba(242,87,87,.3)',
          color: '#f25757', fontSize: 12, display: 'flex', justifyContent: 'space-between',
        }}>
          <span>{actionError}</span>
          <button style={{ background: 'none', border: 'none', color: '#f25757', cursor: 'pointer', padding: 0 }}
            onClick={() => setActionError('')}>✕</button>
        </div>
      )}

      {/* Info banner */}
      <div style={{
        margin: '8px 16px 0', padding: '8px 14px', borderRadius: 8,
        background: 'rgba(92,174,255,.08)', border: '1px solid rgba(92,174,255,.15)',
        color: 'var(--text-muted)', fontSize: 11,
      }}>
        Itens na lixeira são excluídos automaticamente após 30 dias. Restaure os que deseja manter.
      </div>

      {loading ? (
        <div className="empty-state"><div className="spinner" /></div>
      ) : error ? (
        <div className="empty-state">
          <div className="empty-icon-wrap">🗑️</div>
          <div className="empty-title" style={{ color: 'var(--accent-red)' }}>Indisponível</div>
          <div className="empty-hint">{error}</div>
        </div>
      ) : files.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon-wrap">✅</div>
          <div className="empty-title">Lixeira vazia</div>
          <div className="empty-hint">Nenhum arquivo aguardando exclusão permanente.</div>
        </div>
      ) : (
        <>
          {/* Select all row */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,.06)',
          }}>
            <input
              type="checkbox"
              checked={selected.size === files.length && files.length > 0}
              onChange={toggleSelectAll}
              style={{ accentColor: 'var(--accent)', width: 15, height: 15, cursor: 'pointer' }}
            />
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {selected.size > 0 ? `${selected.size} selecionado(s)` : 'Selecionar todos'}
            </span>
          </div>

          <div className="files-area">
            {files.map((file) => {
              const displayName = file.name.split('/').filter(Boolean).pop() || file.name;
              const isBusy = busyPaths.has(file.id);
              const isChecked = selected.has(file.id);

              return (
                <div
                  key={file.fullPath}
                  className="file-card"
                  style={{ opacity: isBusy ? 0.5 : 1, cursor: 'default' }}
                  onClick={() => toggleSelect(file.id)}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleSelect(file.id)}
                    onClick={(e) => e.stopPropagation()}
                    style={{ accentColor: 'var(--accent)', width: 15, height: 15, cursor: 'pointer', flexShrink: 0 }}
                  />
                  <FileTypeIcon name={file.name} isFolder={file.isFolder} />
                  <div className="file-card-info">
                    <div className="file-card-name">{displayName}</div>
                    <div className="file-card-meta" style={{ color: 'var(--accent-red)', fontSize: 10 }}>
                      Excluído em {formatDate(file.deletedAt)}
                    </div>
                  </div>
                  <div className="file-card-size">{file.isFolder ? '—' : formatBytes(file.size)}</div>
                  <div className="file-card-actions">
                    {isBusy ? (
                      <div className="spinner" style={{ width: 14, height: 14 }} />
                    ) : (
                      <>
                        <button
                          className="btn-icon"
                          title="Restaurar"
                          style={{ color: 'var(--accent-green)' }}
                          onClick={(e) => { e.stopPropagation(); handleRestore(file); }}
                        >
                          <IconRestore size={14} />
                        </button>
                        <button
                          className="btn-icon danger"
                          title="Excluir permanentemente"
                          onClick={(e) => { e.stopPropagation(); handlePermanentDelete(file); }}
                        >
                          <IconTrash size={14} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
