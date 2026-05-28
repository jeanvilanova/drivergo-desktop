import React, { useState, useEffect, useCallback, useRef } from 'react';
import { listFiles, trashFile, getDownloadUrl, formatBytes, formatDate, createFolder, renameFile } from '../lib/CloudClient';
import type { CloudFile, CloudUser } from '../lib/CloudClient';
import {
  FileTypeIcon, IconFiles, IconSearch, IconUpload, IconRefresh,
  IconDownload, IconTrash, IconChevronRight, IconPlus,
} from '../components/Icons';

interface Props {
  user: CloudUser;
  prefix: string;
  onNavigate: (prefix: string) => void;
  onTitlePath: (p: string) => void;
}
interface CtxMenu { x: number; y: number; file: CloudFile }
interface UploadProg { [name: string]: number }

function Breadcrumbs({ prefix, onNavigate }: { prefix: string; onNavigate: (p: string) => void }) {
  const parts = prefix.replace(/\/$/, '').split('/').filter(Boolean);
  return (
    <div className="breadcrumb-bar">
      <span className="bc-item" onClick={() => onNavigate('')}>Início</span>
      {parts.map((part, i) => {
        const path = parts.slice(0, i + 1).join('/') + '/';
        const isLast = i === parts.length - 1;
        return (
          <React.Fragment key={path}>
            <span className="bc-sep"><IconChevronRight size={11} /></span>
            <span className={`bc-item${isLast ? ' active' : ''}`}
              onClick={() => !isLast && onNavigate(path)}>{part}</span>
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ── New folder modal ──────────────────────────────────────────────────────────
function NewFolderModal({ onConfirm, onCancel }: {
  onConfirm: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">Nova pasta</div>
        <div className="field">
          <label>Nome da pasta</label>
          <input
            autoFocus value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) onConfirm(name.trim()); }}
            placeholder="Ex: Contratos 2025"
          />
        </div>
        <div className="modal-actions">
          <button className="btn btn-primary" style={{ flex: 1 }}
            onClick={() => name.trim() && onConfirm(name.trim())} disabled={!name.trim()}>
            Criar pasta
          </button>
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onCancel}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

// ── Rename modal ──────────────────────────────────────────────────────────────
function RenameModal({ file, onConfirm, onCancel }: {
  file: CloudFile;
  onConfirm: (newName: string) => void;
  onCancel: () => void;
}) {
  const displayName = file.name.split('/').filter(Boolean).pop() || file.name;
  const [name, setName] = useState(displayName);
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">Renomear</div>
        <div className="field">
          <label>Novo nome</label>
          <input
            autoFocus value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) onConfirm(name.trim()); }}
          />
        </div>
        <div className="modal-actions">
          <button className="btn btn-primary" style={{ flex: 1 }}
            onClick={() => name.trim() && onConfirm(name.trim())} disabled={!name.trim()}>
            Renomear
          </button>
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onCancel}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

export default function FilesScreen({ user, prefix, onNavigate, onTitlePath }: Props) {
  const [files, setFiles] = useState<CloudFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [progress, setProgress] = useState<UploadProg>({});
  const [ctx, setCtx] = useState<CtxMenu | null>(null);
  const [dragging, setDragging] = useState(false);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [renaming, setRenaming] = useState<CloudFile | null>(null);
  const [actionError, setActionError] = useState('');
  const uploadingRef = useRef(false);
  const dragCounter = useRef(0);

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listFiles(user.id, prefix);
      setFiles(data);
      const parts = prefix.replace(/\/$/, '').split('/').filter(Boolean);
      onTitlePath(parts.length ? parts.join(' › ') : '');
    } finally {
      setLoading(false);
    }
  }, [user.id, prefix]);

  useEffect(() => { fetchFiles(); }, [fetchFiles]);

  // Register upload progress listener from main process
  useEffect(() => {
    const handler = window.electronAPI.onUploadProgress(({ name, pct }) => {
      setProgress((prev) => ({ ...prev, [name]: pct }));
    });
    return () => window.electronAPI.offUploadProgress(handler);
  }, []);

  useEffect(() => {
    if (!ctx) return;
    const close = () => setCtx(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [ctx]);

  const filtered = search.trim()
    ? files.filter((f) => {
        const name = f.name.split('/').filter(Boolean).pop() || f.name;
        return name.toLowerCase().includes(search.toLowerCase());
      })
    : files;

  const folders   = filtered.filter((f) => f.isFolder);
  const fileItems = filtered.filter((f) => !f.isFolder);

  // Upload using main process streaming (no memory limit for large files)
  async function doUpload(filePaths: string[]) {
    if (!filePaths.length || uploadingRef.current) return;
    uploadingRef.current = true;

    // Initialise progress at 0 for all files
    const initial: UploadProg = {};
    filePaths.forEach((fp) => { initial[fp.split('\\').pop() || fp] = 0; });
    setProgress({ ...initial });

    for (const fp of filePaths) {
      const name = fp.split('\\').pop() || fp;
      const remotePath = prefix + name;
      try {
        // Delegate to main process — streams directly to S3, no memory buffering
        await window.electronAPI.uploadFromDisk(fp, remotePath, name);
        setProgress((prev) => ({ ...prev, [name]: 100 }));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setActionError(`Falha no upload de "${name}": ${msg}`);
      }
    }

    setProgress({});
    uploadingRef.current = false;
    fetchFiles();
  }

  async function handlePickFiles() { doUpload(await window.electronAPI.openFiles()); }

  async function handleDownload(file: CloudFile) {
    try { await window.electronAPI.openExternal(await getDownloadUrl(user.id, file.fullPath)); }
    catch (e) { setActionError(e instanceof Error ? e.message : 'Erro ao abrir arquivo'); }
  }

  async function handleDelete(file: CloudFile) {
    const name = file.name.split('/').pop() || file.name;
    if (!confirm(`Mover "${name}" para a lixeira?`)) return;
    try {
      await trashFile(user.id, file.fullPath);
      setFiles((prev) => prev.filter((f) => f.fullPath !== file.fullPath));
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Erro ao mover para lixeira');
    }
  }

  async function handleCreateFolder(name: string) {
    setShowNewFolder(false);
    const folderPath = prefix + name + '/';
    try {
      await createFolder(user.id, folderPath);
      fetchFiles();
    } catch (e) {
      // Endpoint may not exist yet on the backend — show friendly message
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('404') || msg.includes('not found')) {
        setActionError('Criação de pasta ainda não suportada pelo servidor. Contate o suporte.');
      } else {
        setActionError(`Erro ao criar pasta: ${msg}`);
      }
    }
  }

  async function handleRename(file: CloudFile, newName: string) {
    setRenaming(null);
    const dir = file.fullPath.substring(0, file.fullPath.lastIndexOf('/') + 1);
    const newPath = dir + newName;
    try {
      await renameFile(user.id, file.fullPath, newPath);
      fetchFiles();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('404') || msg.includes('not found')) {
        setActionError('Renomeação ainda não suportada pelo servidor. Contate o suporte.');
      } else {
        setActionError(`Erro ao renomear: ${msg}`);
      }
    }
  }

  function onDragEnter(e: React.DragEvent) { e.preventDefault(); dragCounter.current++; setDragging(true); }
  function onDragLeave() { dragCounter.current--; if (dragCounter.current === 0) setDragging(false); }
  function onDragOver(e: React.DragEvent) { e.preventDefault(); }
  async function onDrop(e: React.DragEvent) {
    e.preventDefault(); dragCounter.current = 0; setDragging(false);
    const paths = Array.from(e.dataTransfer.files)
      .map((f) => (f as { path?: string }).path || '')
      .filter(Boolean);
    if (paths.length) doUpload(paths);
  }

  const isUploading = Object.keys(progress).length > 0;
  const folderLabel = prefix
    ? prefix.replace(/\/$/, '').split('/').pop() || 'Pasta'
    : user.display_name || user.username;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}
      onDragEnter={onDragEnter} onDragLeave={onDragLeave} onDragOver={onDragOver} onDrop={onDrop}>

      {dragging && (
        <div className="drop-overlay">
          <div className="drop-label">
            <span style={{ fontSize: 36 }}>☁️</span>
            Solte para enviar para a nuvem
          </div>
        </div>
      )}

      {/* Hero */}
      <div className="hero">
        <div className="hero-icon-wrap">
          {prefix ? '📁' : '☁️'}
        </div>
        <div>
          <div className="hero-title">{folderLabel}</div>
          <div className="hero-sub">
            {loading ? 'Carregando…' : `${files.length} ${files.length === 1 ? 'item' : 'itens'}${folders.length ? ` · ${folders.length} pasta${folders.length > 1 ? 's' : ''}` : ''}`}
          </div>
        </div>
        <div className="hero-actions">
          <div className="search-wrap">
            <span className="search-icon"><IconSearch size={13} /></span>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar arquivos…" />
          </div>
          <button className="btn btn-ghost btn-sm" onClick={fetchFiles} title="Atualizar">
            <IconRefresh size={14} />
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowNewFolder(true)} title="Nova pasta">
            <IconPlus size={14} /> Pasta
          </button>
          <button className="btn btn-accent btn-sm" onClick={handlePickFiles} disabled={isUploading}>
            <IconUpload size={14} />
            {isUploading ? 'Enviando…' : 'Enviar Arquivos'}
          </button>
        </div>
      </div>

      {/* Breadcrumb */}
      <Breadcrumbs prefix={prefix} onNavigate={onNavigate} />

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

      {/* Column labels */}
      {!loading && filtered.length > 0 && (
        <div className="files-col-header" style={{ marginTop: 6 }}>
          <div style={{ width: 34 }} />
          <div className="col-label" style={{ flex: 1 }}>Nome</div>
          <div className="col-label" style={{ minWidth: 64, textAlign: 'right' }}>Tamanho</div>
          <div className="col-label" style={{ minWidth: 80, textAlign: 'right', marginRight: 52 }}>Modificado</div>
        </div>
      )}

      {/* Files */}
      {loading ? (
        <div className="empty-state"><div className="spinner" /></div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon-wrap">☁️</div>
          <div className="empty-title">{search ? 'Nenhum resultado' : 'Pasta vazia'}</div>
          <div className="empty-hint">
            {search
              ? `Nenhum arquivo corresponde a "${search}"`
              : 'Arraste arquivos aqui ou clique em Enviar Arquivos'}
          </div>
          {!search && (
            <button className="btn btn-white" style={{ marginTop: 8 }} onClick={handlePickFiles}>
              <IconUpload size={14} /> Enviar arquivos
            </button>
          )}
        </div>
      ) : (
        <div className="files-area">
          {[...folders, ...fileItems].map((file) => {
            const displayName = file.name.split('/').filter(Boolean).pop() || file.name;
            return (
              <div
                key={file.fullPath}
                className="file-card"
                onClick={() => file.isFolder ? onNavigate(file.fullPath) : handleDownload(file)}
                onContextMenu={(e) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, file }); }}
              >
                <FileTypeIcon name={file.name} isFolder={file.isFolder} />
                <div className="file-card-info">
                  <div className="file-card-name">{displayName}</div>
                  {file.isFolder && <div className="file-card-meta">Pasta</div>}
                </div>
                <div className="file-card-size">{file.isFolder ? '—' : formatBytes(file.size)}</div>
                <div className="file-card-date">{file.lastModified ? formatDate(file.lastModified) : '—'}</div>
                <div className="file-card-actions">
                  {!file.isFolder && (
                    <button className="btn-icon" title="Baixar"
                      onClick={(e) => { e.stopPropagation(); handleDownload(file); }}>
                      <IconDownload size={14} />
                    </button>
                  )}
                  <button className="btn-icon danger" title="Excluir"
                    onClick={(e) => { e.stopPropagation(); handleDelete(file); }}>
                    <IconTrash size={14} />
                  </button>
                </div>
                {file.isFolder && (
                  <span style={{ color: 'rgba(255,255,255,.25)', marginLeft: 2 }}>
                    <IconChevronRight size={14} />
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Upload progress */}
      {isUploading && (
        <div className="upload-panel">
          <div className="upload-panel-title">Enviando para a nuvem</div>
          {Object.entries(progress).map(([name, pct]) => (
            <div className="upload-file-row" key={name}>
              <span className="upload-file-name">{name}</span>
              <div className="upload-prog-bg"><div className="upload-prog-fill" style={{ width: `${pct}%` }} /></div>
              <span className="upload-pct">{pct}%</span>
            </div>
          ))}
        </div>
      )}

      {/* Context menu */}
      {ctx && (
        <div className="ctx-menu" style={{ left: ctx.x, top: ctx.y }}>
          {!ctx.file.isFolder && (
            <div className="ctx-item" onClick={() => { handleDownload(ctx.file); setCtx(null); }}>
              <IconDownload size={14} /> Baixar / Abrir
            </div>
          )}
          <div className="ctx-item" onClick={() => { setRenaming(ctx.file); setCtx(null); }}>
            ✏️ Renomear
          </div>
          <div className="ctx-sep" />
          <div className="ctx-item danger" onClick={() => { handleDelete(ctx.file); setCtx(null); }}>
            <IconTrash size={14} /> Mover para lixeira
          </div>
        </div>
      )}

      {/* New folder modal */}
      {showNewFolder && (
        <NewFolderModal
          onConfirm={handleCreateFolder}
          onCancel={() => setShowNewFolder(false)}
        />
      )}

      {/* Rename modal */}
      {renaming && (
        <RenameModal
          file={renaming}
          onConfirm={(newName) => handleRename(renaming, newName)}
          onCancel={() => setRenaming(null)}
        />
      )}
    </div>
  );
}
