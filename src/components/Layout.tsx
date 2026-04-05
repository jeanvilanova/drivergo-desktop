import React, { type ReactNode } from 'react';
import { clearSession } from '../lib/session';
import type { CloudUser } from '../lib/CloudClient';
import { IconFiles, IconSync, IconStorage, IconLogout, IconActivity, IconBackup, IconInfo, IconDrive } from './Icons';
import type { SyncFolderInfo } from '../preload';

type NavView = 'files' | 'sync' | 'storage' | 'drive' | 'backup' | 'log' | 'about';

interface Props {
  user: CloudUser;
  view: NavView;
  onNav: (v: NavView) => void;
  onLogout: () => void;
  titlePath?: string;
  syncBadge?: number;
  errorBadge?: number;
  children: ReactNode;
}

const NAV_ITEMS: { id: NavView; label: string; icon: (s: number) => React.ReactNode }[] = [
  { id: 'files',   label: 'Meus Arquivos',  icon: (s) => <IconFiles size={s} /> },
  { id: 'sync',    label: 'Sincronização',  icon: (s) => <IconSync size={s} /> },
  { id: 'storage', label: 'Armazenamento',  icon: (s) => <IconStorage size={s} /> },
  { id: 'drive',   label: 'Unidade',        icon: (s) => <IconDrive size={s} /> },
  { id: 'backup',  label: 'Backup',         icon: (s) => <IconBackup size={s} /> },
  { id: 'log',     label: 'Atividade',      icon: (s) => <IconActivity size={s} /> },
  { id: 'about',   label: 'Sobre',          icon: (s) => <IconInfo size={s} /> },
];

export default function Layout({ user, view, onNav, onLogout, titlePath, syncBadge, errorBadge, children }: Props) {
  const initial = (user.display_name || user.username).charAt(0).toUpperCase();

  function handleLogout() {
    if (!confirm('Encerrar sessão?')) return;
    clearSession();
    onLogout();
  }

  return (
    <div className="shell">
      {/* Titlebar */}
      <div className="titlebar">
        <div className="titlebar-app-name">
          <div className="titlebar-logo-mark">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 1C4.2 1 2 3.2 2 6c0 .5.1 1 .3 1.4A2.5 2.5 0 0 0 2.5 12h9a2 2 0 0 0 .2-4A4 4 0 0 0 7 1z" fill="white" opacity="0.95"/>
            </svg>
          </div>
          <span className="titlebar-logo-text">
            <span className="titlebar-logo-drive">Drive</span><span className="titlebar-logo-go">GO</span>
          </span>
        </div>
        {titlePath && <span className="titlebar-path">{titlePath}</span>}
      </div>

      <div className="shell-body">
        {/* Sidebar */}
        <nav className="sidebar">
          <div className="sidebar-section-label">Navegação</div>

          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`nav-item${view === item.id ? ' active' : ''}`}
              onClick={() => onNav(item.id)}
            >
              <span className="nav-icon">{item.icon(15)}</span>
              <span>{item.label}</span>
              {item.id === 'sync' && typeof syncBadge === 'number' && syncBadge > 0 && (
                <span className="nav-badge">{syncBadge}</span>
              )}
              {item.id === 'log' && typeof errorBadge === 'number' && errorBadge > 0 && (
                <span className="nav-badge" style={{ background: '#f25757' }}>{errorBadge}</span>
              )}
            </button>
          ))}

          <div className="sidebar-spacer" />
          <div className="sidebar-divider" />

          <div className="user-card">
            <div className="user-avatar">{initial}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="user-name">{user.display_name || user.username}</div>
              <div className="user-role">{user.minio_bucket_name}</div>
            </div>
            <button className="logout-btn" onClick={handleLogout} title="Sair">
              <IconLogout size={14} />
            </button>
          </div>
        </nav>

        {/* Main content */}
        <div className="content">{children}</div>
      </div>
    </div>
  );
}

export function useSyncBadge(folders: SyncFolderInfo[]): number {
  return folders.filter((f) => f.status?.status === 'syncing').length;
}
