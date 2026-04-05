import React, { useState, useEffect, Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { loadSession } from './lib/session';
import type { CloudUser } from './lib/CloudClient';
import Layout from './components/Layout';
import LoginScreen from './screens/LoginScreen';
import FilesScreen from './screens/FilesScreen';
import StorageScreen from './screens/StorageScreen';
import SyncScreen from './screens/SyncScreen';
import LogScreen from './screens/LogScreen';
import BackupScreen from './screens/BackupScreen';
import DriveScreen from './screens/DriveScreen';
import AboutScreen from './screens/AboutScreen';
import type { SyncFolderInfo, LogEntry } from './preload';
import './index.css';

// ── Error Boundary ────────────────────────────────────────────────────────────
interface EBState { error: Error | null }
class ErrorBoundary extends Component<{ children: ReactNode; onReset: () => void }, EBState> {
  state: EBState = { error: null };
  static getDerivedStateFromError(e: Error): EBState { return { error: e }; }
  render() {
    if (this.state.error) return (
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: 12, padding: 40,
      }}>
        <div style={{ fontSize: 32 }}>⚠️</div>
        <div style={{ color: 'var(--danger)', fontWeight: 700 }}>Erro na interface</div>
        <div style={{ color: 'var(--text-muted)', fontSize: 12, fontFamily: 'monospace', maxWidth: 420, textAlign: 'center' }}>
          {this.state.error.message}
        </div>
        <button className="btn btn-primary"
          onClick={() => { this.setState({ error: null }); this.props.onReset(); }}>
          Voltar ao início
        </button>
      </div>
    );
    return this.props.children;
  }
}

// ── App ───────────────────────────────────────────────────────────────────────
type NavView = 'files' | 'sync' | 'storage' | 'drive' | 'backup' | 'log' | 'about';

// ── Startup splash ────────────────────────────────────────────────────────────
function StartupSplash({ status }: { status: string }) {
  return (
    <div className="splash" style={{ flexDirection: 'column', gap: 20 }}>
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <svg width="36" height="36" viewBox="0 0 14 14" fill="none">
          <path d="M7 1C4.2 1 2 3.2 2 6c0 .5.1 1 .3 1.4A2.5 2.5 0 0 0 2.5 12h9a2 2 0 0 0 .2-4A4 4 0 0 0 7 1z" fill="#5caeff" opacity="0.95"/>
        </svg>
        <span style={{ fontSize: 28, fontWeight: 900, letterSpacing: '-1px', lineHeight: 1 }}>
          <span style={{ color: '#fff' }}>Drive</span>
          <span style={{ color: '#5caeff' }}>GO</span>
        </span>
      </div>

      {/* Spinner */}
      <div className="spinner" />

      {/* Status text */}
      <div style={{
        fontSize: 12, color: '#8899b4', minHeight: 18,
        transition: 'opacity .3s', textAlign: 'center',
        maxWidth: 240,
      }}>
        {status || 'Iniciando…'}
      </div>

      {/* Version */}
      <div style={{ fontSize: 10, color: '#3a4a5a', position: 'absolute', bottom: 20 }}>
        Versão 1.0.0 · SuporteGO
      </div>
    </div>
  );
}

function App() {
  const [user, setUser] = useState<CloudUser | null | undefined>(undefined);
  const [view, setView] = useState<NavView>('files');
  const [prefix, setPrefix] = useState('');
  const [titlePath, setTitlePath] = useState('');
  const [syncFolders, setSyncFolders] = useState<SyncFolderInfo[]>([]);
  const [errorBadge, setErrorBadge] = useState(0);
  const [splashStatus, setSplashStatus] = useState('Inicializando DriveGO…');

  useEffect(() => {
    // Subscribe to startup status messages from main process
    const statusHandler = window.electronAPI.onAppStatus((msg: string) => {
      setSplashStatus(msg);
    });

    const saved = loadSession();
    if (saved) {
      window.electronAPI.syncSetUser(saved.id).catch(console.error);
      setUser(saved);
    } else {
      setUser(null);
    }

    // Track error badge for log screen
    const logHandler = window.electronAPI.onLogEntry((entry: LogEntry) => {
      if (entry.level === 'error') {
        setErrorBadge((n) => n + 1);
      }
    });
    return () => {
      window.electronAPI.offAppStatus(statusHandler);
      window.electronAPI.offLogEntry(logHandler);
    };
  }, []);

  // Loading splash
  if (user === undefined) return <StartupSplash status={splashStatus} />;

  // Login
  if (user === null) return (
    <LoginScreen onLogin={(u) => {
      window.electronAPI.syncSetUser(u.id).catch(console.error);
      setUser(u);
    }} />
  );

  const syncBadge = syncFolders.filter((f) => f.status?.status === 'syncing').length;

  function handleNav(v: NavView) {
    setView(v);
    if (v === 'files') setPrefix('');
    if (v === 'log') setErrorBadge(0); // clear badge when user opens the log
  }

  return (
    <Layout
      user={user}
      view={view}
      onNav={handleNav}
      onLogout={() => setUser(null)}
      titlePath={titlePath}
      syncBadge={syncBadge}
      errorBadge={errorBadge}
    >
      <ErrorBoundary onReset={() => { setView('files'); setPrefix(''); }}>
        {view === 'files' && (
          <FilesScreen
            user={user}
            prefix={prefix}
            onNavigate={(p) => setPrefix(p)}
            onTitlePath={setTitlePath}
          />
        )}
        {view === 'storage' && <StorageScreen user={user} />}
        {view === 'sync' && (
          <SyncScreen user={user} onFoldersChange={setSyncFolders} />
        )}
        {view === 'drive' && <DriveScreen />}
        {view === 'backup' && <BackupScreen />}
        {view === 'log' && <LogScreen />}
        {view === 'about' && <AboutScreen />}
      </ErrorBoundary>
    </Layout>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
