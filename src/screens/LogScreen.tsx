import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { LogEntry } from '../preload';

// ── Level config ─────────────────────────────────────────────────────────────
const LEVEL_CFG = {
  info:    { label: 'INFO',    color: '#5caeff', bg: 'rgba(92,174,255,.12)',  border: 'rgba(92,174,255,.25)' },
  success: { label: 'OK',      color: '#2dbe6c', bg: 'rgba(45,190,108,.12)',  border: 'rgba(45,190,108,.25)' },
  warn:    { label: 'AVISO',   color: '#fdc72e', bg: 'rgba(253,199,46,.12)',  border: 'rgba(253,199,46,.25)' },
  error:   { label: 'ERRO',    color: '#f25757', bg: 'rgba(242,87,87,.12)',   border: 'rgba(242,87,87,.25)' },
} as const;

const CAT_CFG: Record<LogEntry['category'], { label: string; icon: string }> = {
  sistema: { label: 'Sistema',    icon: '⚙️' },
  sync:    { label: 'Sync',       icon: '🔄' },
  upload:  { label: 'Upload',     icon: '☁️' },
  pasta:   { label: 'Pasta',      icon: '📁' },
  backup:  { label: 'Backup',     icon: '🗄️' },
};

type LevelFilter = 'all' | LogEntry['level'];
type CatFilter   = 'all' | LogEntry['category'];

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

// ── Entry row ─────────────────────────────────────────────────────────────────
function EntryRow({ entry, prev }: { entry: LogEntry; prev?: LogEntry }) {
  const lvl = LEVEL_CFG[entry.level];
  const cat = CAT_CFG[entry.category];

  // Show date separator when day changes
  const showDate = !prev || formatDate(prev.time) !== formatDate(entry.time);

  return (
    <>
      {showDate && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 0 4px', color: 'var(--text-disabled)', fontSize: 11,
        }}>
          <div style={{ flex: 1, height: 1, background: 'var(--border-dim)' }} />
          {formatDate(entry.time)}
          <div style={{ flex: 1, height: 1, background: 'var(--border-dim)' }} />
        </div>
      )}
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 10,
        padding: '7px 10px', borderRadius: 8,
        borderLeft: `3px solid ${lvl.color}`,
        background: 'var(--surface-2)',
        transition: 'background .1s',
      }}>
        {/* Time */}
        <span style={{ fontSize: 11, color: 'var(--text-disabled)', whiteSpace: 'nowrap', marginTop: 1, minWidth: 60 }}>
          {formatTime(entry.time)}
        </span>

        {/* Category icon */}
        <span style={{ fontSize: 14, flexShrink: 0, marginTop: 0 }} title={cat.label}>{cat.icon}</span>

        {/* Level badge */}
        <span style={{
          display: 'inline-flex', alignItems: 'center',
          fontSize: 9, fontWeight: 700, letterSpacing: '.5px',
          padding: '2px 7px', borderRadius: 10,
          background: lvl.bg, color: lvl.color,
          border: `1px solid ${lvl.border}`,
          whiteSpace: 'nowrap', flexShrink: 0, marginTop: 1,
        }}>
          {lvl.label}
        </span>

        {/* Message + detail */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
            {entry.message}
          </div>
          {entry.detail && (
            <div style={{
              fontSize: 11, color: 'var(--text-muted)', marginTop: 2,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              fontFamily: 'monospace',
            }}>
              {entry.detail}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function LogScreen() {
  const [entries, setEntries]     = useState<LogEntry[]>([]);
  const [levelFilter, setLevel]   = useState<LevelFilter>('all');
  const [catFilter, setCat]       = useState<CatFilter>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef   = useRef<HTMLDivElement>(null);

  // Load existing entries
  useEffect(() => {
    window.electronAPI.logGetEntries().then(setEntries);
  }, []);

  // Subscribe to new entries — save handler ref to remove only this listener on unmount
  useEffect(() => {
    const handler = window.electronAPI.onLogEntry((entry) => {
      setEntries((prev) => [...prev, entry]);
    });
    return () => window.electronAPI.offLogEntry(handler);
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries, autoScroll]);

  function handleScroll() {
    const el = listRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
  }

  const handleClear = useCallback(async () => {
    await window.electronAPI.logClear();
    setEntries([]);
  }, []);

  const filtered = entries.filter((e) =>
    (levelFilter === 'all' || e.level === levelFilter) &&
    (catFilter   === 'all' || e.category === catFilter),
  );

  const counts = {
    error:   entries.filter((e) => e.level === 'error').length,
    warn:    entries.filter((e) => e.level === 'warn').length,
    success: entries.filter((e) => e.level === 'success').length,
    info:    entries.filter((e) => e.level === 'info').length,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Hero */}
      <div className="hero">
        <div className="hero-icon-wrap" style={{ fontSize: 22 }}>🗒️</div>
        <div>
          <div className="hero-title">Atividade</div>
          <div className="hero-sub">
            {entries.length === 0 ? 'Nenhum evento registrado'
              : `${entries.length} evento${entries.length > 1 ? 's' : ''} registrado${entries.length > 1 ? 's' : ''}`}
            {counts.error > 0 && (
              <span style={{ color: '#f25757', marginLeft: 8 }}>· {counts.error} erro{counts.error > 1 ? 's' : ''}</span>
            )}
          </div>
        </div>
        <div className="hero-actions">
          {!autoScroll && (
            <button className="btn btn-ghost btn-sm"
              onClick={() => { setAutoScroll(true); bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }}>
              ↓ Ir ao final
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={handleClear}
            style={{ color: '#f87171' }} disabled={entries.length === 0}>
            Limpar log
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{
        display: 'flex', gap: 6, padding: '8px 16px',
        borderBottom: '1px solid var(--border-dim)',
        background: 'var(--surface-1)', flexWrap: 'wrap', alignItems: 'center',
        flexShrink: 0,
      }}>
        {/* Level filters */}
        <span style={{ fontSize: 10, color: 'var(--text-disabled)', fontWeight: 600, marginRight: 2 }}>NÍVEL</span>
        {(['all', 'error', 'warn', 'success', 'info'] as const).map((l) => {
          const active = levelFilter === l;
          const cfg = l !== 'all' ? LEVEL_CFG[l] : null;
          return (
            <button key={l} onClick={() => setLevel(l)} style={{
              padding: '3px 10px', borderRadius: 12, border: 'none', cursor: 'pointer',
              fontSize: 11, fontWeight: 600,
              background: active ? (cfg?.bg ?? 'rgba(255,255,255,.12)') : 'var(--surface-2)',
              color: active ? (cfg?.color ?? '#fff') : 'var(--text-muted)',
              fontFamily: 'inherit',
            }}>
              {l === 'all' ? 'Todos' : LEVEL_CFG[l].label}
              {l !== 'all' && counts[l] > 0 && (
                <span style={{ marginLeft: 5, opacity: .75 }}>({counts[l]})</span>
              )}
            </button>
          );
        })}

        <div style={{ width: 1, height: 16, background: 'var(--border-dim)', margin: '0 4px' }} />

        {/* Category filters */}
        <span style={{ fontSize: 10, color: 'var(--text-disabled)', fontWeight: 600, marginRight: 2 }}>CATEGORIA</span>
        {(['all', 'sistema', 'sync', 'upload', 'pasta', 'backup'] as const).map((c) => {
          const active = catFilter === c;
          const icon = c !== 'all' ? CAT_CFG[c].icon : null;
          return (
            <button key={c} onClick={() => setCat(c)} style={{
              padding: '3px 10px', borderRadius: 12, border: 'none', cursor: 'pointer',
              fontSize: 11, fontWeight: 600,
              background: active ? 'rgba(92,174,255,.15)' : 'var(--surface-2)',
              color: active ? '#5caeff' : 'var(--text-muted)',
              fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4,
            }}>
              {icon && <span style={{ fontSize: 12 }}>{icon}</span>}
              {c === 'all' ? 'Todas' : CAT_CFG[c as LogEntry['category']].label}
            </button>
          );
        })}
      </div>

      {/* Log list */}
      <div
        ref={listRef}
        onScroll={handleScroll}
        style={{ flex: 1, overflowY: 'auto', padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 3 }}
      >
        {filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon-wrap" style={{ fontSize: 28 }}>🗒️</div>
            <div className="empty-title">Sem eventos</div>
            <div className="empty-hint">
              {entries.length > 0
                ? 'Nenhum evento corresponde aos filtros aplicados'
                : 'O log de atividades aparece aqui em tempo real'}
            </div>
          </div>
        ) : (
          filtered.map((e, i) => (
            <EntryRow key={e.id} entry={e} prev={filtered[i - 1]} />
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
