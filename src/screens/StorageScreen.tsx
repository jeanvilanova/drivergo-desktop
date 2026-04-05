import React, { useEffect, useState } from 'react';
import { getStorageUsage, formatBytes } from '../lib/CloudClient';
import type { StorageUsage, CloudUser } from '../lib/CloudClient';
import { IconStorage } from '../components/Icons';

interface Props { user: CloudUser }

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
  const [error, setError] = useState('');

  useEffect(() => {
    getStorageUsage(user.id)
      .then(setUsage)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Erro'))
      .finally(() => setLoading(false));
  }, [user.id]);

  if (loading) return <div className="empty-state"><div className="spinner" /></div>;
  if (error) return (
    <div className="empty-state">
      <div className="empty-icon-wrap"><IconStorage size={28} /></div>
      <div className="empty-title" style={{ color: 'var(--accent-red)' }}>Erro ao carregar</div>
      <div className="empty-hint">{error}</div>
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
          <div className="hero-sub">Consumo de espaço em nuvem · {user.display_name || user.username}</div>
        </div>
      </div>

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
            ['Usuário', user.display_name || user.username],
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
