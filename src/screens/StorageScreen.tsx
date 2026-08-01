import React, { useEffect, useState, useCallback } from 'react';
import { getStorageUsage, formatBytes } from '../lib/CloudClient';
import type { StorageUsage, CloudUser } from '../lib/CloudClient';
import { IconStorage, IconRefresh } from '../components/Icons';

interface Props { user: CloudUser }

const POLL_INTERVAL_MS = 30_000;

function DonutRing({ pct, size = 140 }: { pct: number; size?: number }) {
  const r = (size / 2) - 12;
  const circ = 2 * Math.PI * r;
  const filled = (Math.min(pct, 100) / 100) * circ;
  const color = pct > 90 ? '#f25757' : pct > 70 ? '#fdc72e' : '#5caeff';

  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
      <circle cx={size/2} cy={size/2} r={r}
        fill="none" stroke="rgba(255,255,255,.1)" strokeWidth={11} />
      <circle cx={size/2} cy={size/2} r={r}
        fill="none" stroke={color} strokeWidth={11}
        strokeDasharray={`${filled} ${circ - filled}`}
        strokeLinecap="round"
        style={{ transition: 'stroke-dasharray .9s cubic-bezier(.4,0,.2,1)', filter: `drop-shadow(0 0 6px ${color}80)` }}
      />
    </svg>
  );
}

export default function StorageScreen({ user }: Props) {
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchUsage = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError('');
    try {
      const data = await getStorageUsage(user.id);
      setUsage(data);
      setLastUpdated(new Date());
    } catch (e: unknown) {
      if (!silent) setError(e instanceof Error ? e.message : 'Erro');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user.id]);

  // Initial load
  useEffect(() => { fetchUsage(); }, [fetchUsage]);

  // Auto-refresh every 30 s (picks up changes from file deletions / uploads)
  useEffect(() => {
    const id = setInterval(() => fetchUsage(true), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchUsage]);

  if (loading) return <div className="empty-state"><div className="spinner" /></div>;
  if (error) return (
    <div className="empty-state">
      <div className="empty-icon-wrap"><IconStorage size={28} /></div>
      <div className="empty-title" style={{ color: 'var(--accent-red)' }}>Erro ao carregar</div>
      <div className="empty-hint">
        {error.includes('404') || error.includes('NoSuchBucket')
          ? 'Armazenamento ainda não configurado para esta conta. Entre em contato com o suporte.'
          : error}
      </div>
      <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => fetchUsage()}>
        <IconRefresh size={14} /> Tentar novamente
      </button>
    </div>
  );
  if (!usage) return null;

  const pct = usage.percentage ?? 0;
  const available = usage.capacityGb
    ? (usage.capacityGb * 1024 * 1024 * 1024) - usage.usedBytes
    : null;
  const barColor = pct > 90 ? '#f25757' : pct > 70 ? '#fdc72e' : '#5caeff';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Hero */}
      <div className="hero">
        <div className="hero-icon-wrap">
          <IconStorage size={28} />
        </div>
        <div>
          <div className="hero-title">Armazenamento</div>
          <div className="hero-sub">Consumo de espaço em nuvem · {user.username}</div>
        </div>
        <div className="hero-actions">
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => fetchUsage(true)}
            disabled={refreshing}
            title="Atualizar agora"
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <span style={{ display: 'inline-flex', animation: refreshing ? 'spin .8s linear infinite' : 'none' }}>
              <IconRefresh size={14} />
            </span>
            {refreshing ? 'Atualizando…' : 'Atualizar'}
          </button>
        </div>
      </div>

      {lastUpdated && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '0 20px 4px', textAlign: 'right' }}>
          Atualizado em {lastUpdated.toLocaleTimeString('pt-BR')} · atualiza automaticamente a cada 30s
        </div>
      )}

      <div className="storage-layout">

        {/* Main usage card — donut + bar */}
        <div className="glass-card" style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <DonutRing pct={pct} size={140} />
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ fontSize: 22, fontWeight: 800, color: '#fff', letterSpacing: '-1px' }}>
                {usage.percentage !== null ? `${pct}%` : '∞'}
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>usado</span>
            </div>
          </div>

          <div style={{ flex: 1 }}>
            <div className="glass-card-label">Uso atual</div>
            <div className="stat-big">{formatBytes(usage.usedBytes)}</div>
            {usage.capacityGb && (
              <div className="stat-sub">de {usage.capacityGb} GB disponíveis</div>
            )}
            {!usage.capacityGb && (
              <div className="stat-sub">Sem limite configurado</div>
            )}
            {usage.percentage !== null && (
              <>
                <div className="prog-bar-bg" style={{ marginTop: 16 }}>
                  <div className="prog-bar-fill" style={{
                    width: `${Math.min(pct, 100)}%`,
                    background: barColor,
                  }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                  <span className="prog-pct" style={{ textAlign: 'left' }}>{formatBytes(usage.usedBytes)} utilizado</span>
                  <span className="prog-pct">{pct}%</span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Stats row */}
        <div className="storage-grid">
          <div className="glass-card">
            <div className="glass-card-label">Espaço usado</div>
            <div className="stat-big" style={{ fontSize: 26 }}>{formatBytes(usage.usedBytes)}</div>
            <div className="stat-sub">armazenado na nuvem</div>
          </div>

          <div className="glass-card">
            <div className="glass-card-label">Disponível</div>
            <div className="stat-big" style={{
              fontSize: 26,
              color: available !== null && available < 0 ? 'var(--accent-red)' : 'var(--accent-green)',
            }}>
              {available !== null ? formatBytes(Math.max(0, available)) : 'Ilimitado'}
            </div>
            <div className="stat-sub">
              {available !== null && available < 0 ? 'limite excedido' : 'espaço restante'}
            </div>
          </div>
        </div>

        {/* Account details */}
        <div className="glass-card">
          <div className="glass-card-label">Detalhes da conta</div>
          {([
            ['Usuário', user.username],
            ['Bucket', user.minio_bucket_name],
            ['Capacidade total', usage.capacityGb ? `${usage.capacityGb} GB` : 'Ilimitado'],
            ['Espaço usado', formatBytes(usage.usedBytes)],
            ...(available !== null ? [['Espaço disponível', formatBytes(Math.max(0, available))]] : []),
          ] as [string, string][]).map(([label, value]) => (
            <div className="detail-row" key={label}>
              <span className="detail-label">{label}</span>
              <span className="detail-value">{value}</span>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}
