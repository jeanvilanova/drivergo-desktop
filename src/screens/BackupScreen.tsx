import React, { useEffect, useState, useCallback } from 'react';
import type { BackupConfig } from '../preload';

// ── Constants ─────────────────────────────────────────────────────────────────
type BackupType = BackupConfig['type'];

const TYPE_CFG: Record<BackupType, { label: string; color: string; bg: string }> = {
  files:      { label: 'Arquivo',    color: '#5caeff', bg: 'rgba(92,174,255,.15)' },
  firebird:   { label: 'Firebird',   color: '#f5a623', bg: 'rgba(245,166,35,.15)' },
  sqlserver:  { label: 'SQL Server', color: '#e87070', bg: 'rgba(232,112,112,.15)' },
  postgresql: { label: 'PostgreSQL', color: '#2dbe6c', bg: 'rgba(45,190,108,.15)' },
  db2:        { label: 'DB2',        color: '#a78bfa', bg: 'rgba(167,139,250,.15)' },
  oracle:     { label: 'Oracle',     color: '#fb923c', bg: 'rgba(251,146,60,.15)' },
};

const STATUS_CFG = {
  idle:    { label: 'Aguardando',   color: 'var(--text-disabled)' },
  running: { label: 'Executando…',  color: '#fdc72e' },
  success: { label: 'Concluído',    color: '#2dbe6c' },
  error:   { label: 'Erro',         color: '#f25757' },
};

const DOW_LABELS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

// ── Helpers ───────────────────────────────────────────────────────────────────
function newConfig(): BackupConfig {
  return {
    id: window.crypto.randomUUID(),
    name: '',
    type: 'files',
    enabled: true,
    createdAt: new Date().toISOString(),
    sourceFolders: [],
    dbHost: 'localhost', dbPort: '', dbName: '', dbUser: '', dbPassword: '',
    dbFile: '', dbToolPath: '',
    schedule: 'daily', scheduleTime: '02:00', scheduleDayOfWeek: 1,
    keepCount: 7,
    lastRun: null, lastStatus: 'idle', lastError: null,
  };
}

function formatDateTime(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatSchedule(cfg: BackupConfig) {
  const time = cfg.scheduleTime;
  if (cfg.schedule === 'daily') return `Diariamente às ${time}`;
  return `${DOW_LABELS[cfg.scheduleDayOfWeek ?? 1]} às ${time}`;
}

// ── Type badge ────────────────────────────────────────────────────────────────
function TypeBadge({ type }: { type: BackupType }) {
  const c = TYPE_CFG[type];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      fontSize: 10, fontWeight: 700, letterSpacing: '.4px',
      padding: '2px 8px', borderRadius: 10,
      background: c.bg, color: c.color,
      border: `1px solid ${c.color}40`,
    }}>
      {c.label}
    </span>
  );
}

// ── Backup card ───────────────────────────────────────────────────────────────
interface CardProps {
  cfg: BackupConfig;
  onEdit: () => void;
  onDelete: () => void;
  onRunNow: () => void;
  running: boolean;
}

function BackupCard({ cfg, onEdit, onDelete, onRunNow, running }: CardProps) {
  const st = STATUS_CFG[cfg.lastStatus];
  const isRunning = running || cfg.lastStatus === 'running';

  return (
    <div style={{
      background: 'var(--surface-2)', borderRadius: 12,
      border: '1px solid var(--border-dim)',
      padding: '14px 16px',
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {/* Type icon */}
        <div style={{
          width: 38, height: 38, borderRadius: 9, flexShrink: 0,
          background: TYPE_CFG[cfg.type].bg,
          border: `1px solid ${TYPE_CFG[cfg.type].color}40`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 18,
        }}>
          {cfg.type === 'files' ? '📁' : '🗄️'}
        </div>

        {/* Name + type */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
              {cfg.name}
            </span>
            <TypeBadge type={cfg.type} />
            {!cfg.enabled && (
              <span style={{ fontSize: 10, color: 'var(--text-disabled)', fontWeight: 600 }}>
                DESATIVADO
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {formatSchedule(cfg)} · Reter {cfg.keepCount} backup{cfg.keepCount > 1 ? 's' : ''}
          </div>
        </div>

        {/* Enable toggle */}
        <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
          <span style={{ color: st.color, fontWeight: 600 }}>
            {isRunning ? '⟳ Executando…' : st.label}
          </span>
        </div>
      </div>

      {/* Last run / error info */}
      {cfg.lastError && (
        <div style={{
          fontSize: 11, color: '#f25757', background: 'rgba(242,87,87,.08)',
          border: '1px solid rgba(242,87,87,.2)', borderRadius: 6, padding: '5px 9px',
          fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {cfg.lastError}
        </div>
      )}

      {/* Footer row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--text-disabled)', flex: 1 }}>
          Último: {formatDateTime(cfg.lastRun)}
        </span>
        <button className="btn btn-ghost btn-sm" onClick={onRunNow} disabled={isRunning}
          style={{ fontSize: 11 }}>
          ▶ Executar agora
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onEdit} style={{ fontSize: 11 }}>
          Editar
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onDelete}
          style={{ fontSize: 11, color: '#f87171' }}>
          Excluir
        </button>
      </div>
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────
interface ModalProps {
  draft: BackupConfig;
  onChange: (patch: Partial<BackupConfig>) => void;
  onSave: () => void;
  onClose: () => void;
  isNew: boolean;
}

function BackupModal({ draft, onChange, onSave, onClose, isNew }: ModalProps) {
  const isDb = draft.type !== 'files';
  const defaultPorts: Record<BackupType, string> = {
    files: '', firebird: '3050', sqlserver: '1433', postgresql: '5432', db2: '50000', oracle: '1521',
  };

  async function addSourceFolder() {
    const picked = await window.electronAPI.syncPickFolder();
    if (picked && !draft.sourceFolders.includes(picked)) {
      onChange({ sourceFolders: [...draft.sourceFolders, picked] });
    }
  }

  function removeFolder(fp: string) {
    onChange({ sourceFolders: draft.sourceFolders.filter((f) => f !== fp) });
  }

  function handleTypeChange(type: BackupType) {
    onChange({
      type,
      dbPort: defaultPorts[type],
    });
  }

  const fieldStyle: React.CSSProperties = {
    width: '100%', padding: '7px 10px', borderRadius: 7,
    border: '1px solid var(--border-mid)', background: 'var(--surface-1)',
    color: 'var(--text-primary)', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 600, color: 'var(--text-disabled)',
    letterSpacing: '.4px', marginBottom: 4, display: 'block',
  };

  const sectionStyle: React.CSSProperties = {
    borderTop: '1px solid var(--border-dim)', paddingTop: 14, marginTop: 4,
  };

  const canSave = draft.name.trim() &&
    (draft.type === 'files' ? draft.sourceFolders.length > 0
      : draft.dbName.trim() && draft.dbUser.trim());

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,.7)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{
        width: 520, maxHeight: '88vh',
        background: 'var(--surface-1)', borderRadius: 14,
        border: '1px solid var(--border-mid)',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 80px rgba(0,0,0,.6)',
      }}>
        {/* Modal header */}
        <div style={{
          display: 'flex', alignItems: 'center', padding: '14px 18px',
          borderBottom: '1px solid var(--border-dim)',
        }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', flex: 1 }}>
            {isNew ? 'Novo Backup' : 'Editar Backup'}
          </span>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', fontSize: 18, lineHeight: 1, padding: 4,
          }}>×</button>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Name */}
          <div>
            <label style={labelStyle}>NOME</label>
            <input style={fieldStyle} placeholder="Ex: Backup Diário de Documentos"
              value={draft.name} onChange={(e) => onChange({ name: e.target.value })} />
          </div>

          {/* Type selector */}
          <div>
            <label style={labelStyle}>TIPO DE BACKUP</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
              {(Object.keys(TYPE_CFG) as BackupType[]).map((t) => {
                const active = draft.type === t;
                const c = TYPE_CFG[t];
                return (
                  <button key={t} onClick={() => handleTypeChange(t)} style={{
                    padding: '8px 6px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
                    border: `1px solid ${active ? c.color : 'var(--border-dim)'}`,
                    background: active ? c.bg : 'var(--surface-2)',
                    color: active ? c.color : 'var(--text-muted)',
                    fontWeight: active ? 700 : 400, fontSize: 12, textAlign: 'center',
                    transition: 'all .15s',
                  }}>
                    {t === 'files' ? '📁 ' : '🗄️ '}{c.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* File backup — folder list */}
          {draft.type === 'files' && (
            <div style={sectionStyle}>
              <label style={labelStyle}>PASTAS PARA BACKUP</label>
              {draft.sourceFolders.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--text-disabled)', marginBottom: 8 }}>
                  Nenhuma pasta selecionada
                </div>
              )}
              {draft.sourceFolders.map((fp) => (
                <div key={fp} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '5px 8px', borderRadius: 6, marginBottom: 4,
                  background: 'var(--surface-2)', border: '1px solid var(--border-dim)',
                }}>
                  <span style={{ flex: 1, fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                    📁 {fp}
                  </span>
                  <button onClick={() => removeFolder(fp)} style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: '#f87171', fontSize: 14, flexShrink: 0, padding: '0 2px',
                  }}>×</button>
                </div>
              ))}
              <button className="btn btn-ghost btn-sm" onClick={addSourceFolder} style={{ fontSize: 12, marginTop: 4 }}>
                + Adicionar pasta
              </button>
            </div>
          )}

          {/* DB connection fields */}
          {isDb && (
            <div style={sectionStyle}>
              <label style={labelStyle}>CONEXÃO COM BANCO DE DADOS</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: 8, marginBottom: 8 }}>
                <div>
                  <label style={{ ...labelStyle, marginBottom: 3 }}>HOST</label>
                  <input style={fieldStyle} placeholder="localhost"
                    value={draft.dbHost} onChange={(e) => onChange({ dbHost: e.target.value })} />
                </div>
                <div>
                  <label style={{ ...labelStyle, marginBottom: 3 }}>PORTA</label>
                  <input style={fieldStyle} placeholder={defaultPorts[draft.type]}
                    value={draft.dbPort} onChange={(e) => onChange({ dbPort: e.target.value })} />
                </div>
              </div>
              <div style={{ marginBottom: 8 }}>
                <label style={{ ...labelStyle, marginBottom: 3 }}>BANCO / DATABASE</label>
                <input style={fieldStyle} placeholder="nome_do_banco"
                  value={draft.dbName} onChange={(e) => onChange({ dbName: e.target.value })} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                <div>
                  <label style={{ ...labelStyle, marginBottom: 3 }}>USUÁRIO</label>
                  <input style={fieldStyle} placeholder="usuario"
                    value={draft.dbUser} onChange={(e) => onChange({ dbUser: e.target.value })} />
                </div>
                <div>
                  <label style={{ ...labelStyle, marginBottom: 3 }}>SENHA</label>
                  <input style={fieldStyle} type="password" placeholder="••••••••"
                    value={draft.dbPassword} onChange={(e) => onChange({ dbPassword: e.target.value })} />
                </div>
              </div>

              {/* Firebird-specific: path to .fdb file */}
              {draft.type === 'firebird' && (
                <div style={{ marginBottom: 8 }}>
                  <label style={{ ...labelStyle, marginBottom: 3 }}>CAMINHO DO ARQUIVO .FDB (opcional)</label>
                  <input style={fieldStyle} placeholder="C:\dados\empresa.fdb"
                    value={draft.dbFile} onChange={(e) => onChange({ dbFile: e.target.value })} />
                </div>
              )}

              <div>
                <label style={{ ...labelStyle, marginBottom: 3 }}>CAMINHO DA FERRAMENTA (opcional)</label>
                <input style={fieldStyle}
                  placeholder={draft.type === 'firebird' ? 'gbak' : draft.type === 'postgresql' ? 'pg_dump' : draft.type === 'sqlserver' ? 'sqlcmd' : 'ferramenta'}
                  value={draft.dbToolPath} onChange={(e) => onChange({ dbToolPath: e.target.value })} />
                <span style={{ fontSize: 10, color: 'var(--text-disabled)', marginTop: 3, display: 'block' }}>
                  Deixe em branco para usar o executável padrão do PATH do sistema
                </span>
              </div>
            </div>
          )}

          {/* Schedule */}
          <div style={sectionStyle}>
            <label style={labelStyle}>AGENDAMENTO</label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              {(['daily', 'weekly'] as const).map((s) => (
                <button key={s} onClick={() => onChange({ schedule: s })} style={{
                  padding: '6px 14px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
                  border: `1px solid ${draft.schedule === s ? 'var(--dg-blue)' : 'var(--border-dim)'}`,
                  background: draft.schedule === s ? 'rgba(92,174,255,.15)' : 'var(--surface-2)',
                  color: draft.schedule === s ? 'var(--dg-blue)' : 'var(--text-muted)',
                  fontWeight: draft.schedule === s ? 700 : 400, fontSize: 12,
                }}>
                  {s === 'daily' ? 'Diariamente' : 'Semanalmente'}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
              <div>
                <label style={{ ...labelStyle, marginBottom: 3 }}>HORÁRIO</label>
                <input style={{ ...fieldStyle, width: 100 }} type="time"
                  value={draft.scheduleTime} onChange={(e) => onChange({ scheduleTime: e.target.value })} />
              </div>
              {draft.schedule === 'weekly' && (
                <div style={{ flex: 1 }}>
                  <label style={{ ...labelStyle, marginBottom: 3 }}>DIA DA SEMANA</label>
                  <select style={fieldStyle}
                    value={draft.scheduleDayOfWeek}
                    onChange={(e) => onChange({ scheduleDayOfWeek: Number(e.target.value) })}>
                    {DOW_LABELS.map((d, i) => <option key={i} value={i}>{d}</option>)}
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* Retention */}
          <div style={sectionStyle}>
            <label style={labelStyle}>RETENÇÃO</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Manter os últimos</span>
              <input style={{ ...fieldStyle, width: 60, textAlign: 'center' }} type="number" min={1} max={99}
                value={draft.keepCount} onChange={(e) => onChange({ keepCount: Math.max(1, Number(e.target.value)) })} />
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                backup{draft.keepCount > 1 ? 's' : ''} locais
              </span>
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-disabled)', marginTop: 4, display: 'block' }}>
              Arquivos mais antigos são removidos do disco após o envio para a nuvem
            </span>
          </div>

          {/* Enable */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input type="checkbox" id="enabled-chk" checked={draft.enabled}
              onChange={(e) => onChange({ enabled: e.target.checked })}
              style={{ width: 15, height: 15, cursor: 'pointer' }} />
            <label htmlFor="enabled-chk" style={{ fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}>
              Backup ativo (executar conforme agendamento)
            </label>
          </div>
        </div>

        {/* Modal footer */}
        <div style={{
          display: 'flex', justifyContent: 'flex-end', gap: 8,
          padding: '12px 18px', borderTop: '1px solid var(--border-dim)',
        }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={onSave} disabled={!canSave}>
            {isNew ? 'Adicionar' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function BackupScreen() {
  const [configs, setConfigs]   = useState<BackupConfig[]>([]);
  const [draft, setDraft]       = useState<BackupConfig | null>(null);
  const [isNew, setIsNew]       = useState(false);
  const [running, setRunning]   = useState<Set<string>>(new Set());
  const [error, setError]       = useState<string | null>(null);

  const reload = useCallback(() => {
    window.electronAPI.backupGetConfigs().then(setConfigs);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  function openAdd() {
    setDraft(newConfig());
    setIsNew(true);
    setError(null);
  }

  function openEdit(cfg: BackupConfig) {
    setDraft({ ...cfg });
    setIsNew(false);
    setError(null);
  }

  function closeModal() {
    setDraft(null);
  }

  function patchDraft(patch: Partial<BackupConfig>) {
    setDraft((prev) => prev ? { ...prev, ...patch } : prev);
  }

  async function saveConfig() {
    if (!draft) return;
    await window.electronAPI.backupSaveConfig(draft);
    reload();
    closeModal();
  }

  async function deleteConfig(id: string) {
    const cfg = configs.find((c) => c.id === id);
    if (!confirm(`Excluir backup "${cfg?.name ?? id}"?`)) return;
    await window.electronAPI.backupRemoveConfig(id);
    reload();
  }

  async function runNow(id: string) {
    setRunning((prev) => new Set([...prev, id]));
    setError(null);
    try {
      await window.electronAPI.backupRunNow(id);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning((prev) => { const s = new Set(prev); s.delete(id); return s; });
      reload();
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Hero */}
      <div className="hero">
        <div className="hero-icon-wrap" style={{ fontSize: 22 }}>🗄️</div>
        <div>
          <div className="hero-title">Backup Programado</div>
          <div className="hero-sub">
            {configs.length === 0
              ? 'Nenhum backup configurado'
              : `${configs.length} backup${configs.length > 1 ? 's' : ''} configurado${configs.length > 1 ? 's' : ''}`}
          </div>
        </div>
        <div className="hero-actions">
          <button className="btn btn-primary btn-sm" onClick={openAdd}>
            + Adicionar Backup
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div style={{
          margin: '0 16px', padding: '9px 12px', borderRadius: 8, fontSize: 12,
          background: 'rgba(242,87,87,.1)', border: '1px solid rgba(242,87,87,.3)',
          color: '#f25757', display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontWeight: 700 }}>Erro:</span>
          <span style={{ fontFamily: 'monospace' }}>{error}</span>
          <button onClick={() => setError(null)} style={{
            marginLeft: 'auto', background: 'none', border: 'none',
            cursor: 'pointer', color: '#f25757', fontSize: 16,
          }}>×</button>
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {configs.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon-wrap" style={{ fontSize: 32 }}>🗄️</div>
            <div className="empty-title">Sem backups configurados</div>
            <div className="empty-hint">
              Configure backups de arquivos ou bancos de dados com agendamento automático
            </div>
            <button className="btn btn-primary" onClick={openAdd} style={{ marginTop: 8 }}>
              + Adicionar Backup
            </button>
          </div>
        ) : (
          configs.map((cfg) => (
            <BackupCard
              key={cfg.id}
              cfg={cfg}
              onEdit={() => openEdit(cfg)}
              onDelete={() => deleteConfig(cfg.id)}
              onRunNow={() => runNow(cfg.id)}
              running={running.has(cfg.id)}
            />
          ))
        )}
      </div>

      {/* Add/Edit modal */}
      {draft && (
        <BackupModal
          draft={draft}
          onChange={patchDraft}
          onSave={saveConfig}
          onClose={closeModal}
          isNew={isNew}
        />
      )}
    </div>
  );
}
