import React, { type ReactNode } from 'react';
import { clearSession } from '../lib/session';
import type { CloudUser } from '../lib/CloudClient';
import { IconFiles, IconSync, IconStorage, IconLogout, IconActivity, IconBackup, IconInfo, IconDrive, IconTrash } from './Icons';
import type { SyncFolderInfo } from '../preload';

type NavView = 'files' | 'sync' | 'storage' | 'drive' | 'backup' | 'log' | 'about' | 'trash';

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
  { id: 'trash',   label: 'Lixeira',        icon: (s) => <IconTrash size={s} /> },
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
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              {/* cloud */}
              <path d="M2.5 11 Q2.5 8 5 8 Q5 6 7 6 Q9 5 10.5 6.5 Q12 6 12 8 Q13.5 8 13.5 9.5 Q13.5 11 11.5 11 H4 Q2.5 11 2.5 11Z" fill="white" opacity="0.92"/>
              {/* padlock body */}
              <rect x="4.5" y="9" width="5" height="4" rx="1" fill="#fdc72e"/>
              {/* padlock shackle */}
              <path d="M5.5 9 Q5.5 7 7 7 Q8.5 7 8.5 9" stroke="white" strokeWidth="1" fill="none" strokeLinecap="round"/>
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
