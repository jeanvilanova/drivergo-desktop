import React, { useState, useEffect, Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { loadSession } from './lib/session';
import { setSessionToken } from './lib/CloudClient';
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
import TrashScreen from './screens/TrashScreen';
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
type NavView = 'files' | 'sync' | 'storage' | 'drive' | 'backup' | 'log' | 'about' | 'trash';

// ── Startup splash ────────────────────────────────────────────────────────────
function StartupSplash({ status, version }: { status: string; version: string }) {
  return (
    <div className="splash" style={{ flexDirection: 'column', gap: 20 }}>
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <svg width="48" height="48" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
          {/* Nuvem traseira */}
          <path d="M22 65 Q22 50 35 50 Q36 40 46 40 Q54 33 63 38 Q72 35 76 44 Q84 44 84 54 Q84 65 72 65 Z" fill="#3a8ee0"/>
          {/* Nuvem frontal */}
          <path d="M18 68 Q18 53 32 53 Q33 42 44 42 Q53 35 63 41 Q73 38 77 48 Q86 48 86 59 Q86 70 73 70 H28 Q18 70 18 68 Z" fill="#5caeff"/>
          {/* Brilho */}
          <ellipse cx="52" cy="46" rx="14" ry="6" fill="white" opacity="0.2" transform="rotate(-10 52 46)"/>
          {/* WiFi */}
          <path d="M14 38 Q10 30 16 24" stroke="#34d3f5" strokeWidth="2.8" fill="none" strokeLinecap="round" opacity="0.75"/>
          <path d="M18 42 Q12 31 20 22" stroke="#34d3f5" strokeWidth="2.2" fill="none" strokeLinecap="round" opacity="0.9"/>
          <path d="M22 46 Q14 32 23 20" stroke="#34d3f5" strokeWidth="1.6" fill="none" strokeLinecap="round" opacity="0.55"/>
          {/* Cadeado argola */}
          <path d="M37 56 Q37 46 46 46 Q55 46 55 56" stroke="white" strokeWidth="4" fill="none" strokeLinecap="round"/>
          {/* Cadeado corpo */}
          <rect x="30" y="56" width="28" height="22" rx="4" fill="#fdc72e"/>
          {/* Buraco chave */}
          <circle cx="44" cy="65" r="4" fill="white" opacity="0.9"/>
          <rect x="42" y="65" width="4" height="7" rx="2" fill="white" opacity="0.9"/>
          {/* Escudo */}
          <path d="M60 58 Q60 54 64 53 L72 53 Q76 54 76 58 L76 66 Q76 72 68 75 Q60 72 60 66 Z" fill="#2dbe6c"/>
          {/* Checkmark */}
          <path d="M63 65 L66.5 68.5 L73 61" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
        </svg>
        <span style={{ fontSize: 28, fontWeight: 900, letterSpacing: '-1px', lineHeight: 1, fontFamily: "'Nunito', 'Segoe UI', sans-serif" }}>
          <span style={{ color: '#5caeff' }}>Drive</span>
          <span style={{ color: '#fdc72e' }}>GO</span>
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
        Versão {version} · SuporteGO
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
  const [appVersion, setAppVersion] = useState('...');

  useEffect(() => {
    window.electronAPI.getVersion().then(setAppVersion);

    // Subscribe to startup status messages from main process
    const statusHandler = window.electronAPI.onAppStatus((msg: string) => {
      setSplashStatus(msg);
    });

    const saved = loadSession();
    if (saved) {
      setSessionToken(saved.sessionToken);
      // Ativa o perfil antes de restaurar as configurações, garantindo que
      // os stores leiam os arquivos do diretório correto para este usuário.
      window.electronAPI.setActiveProfile(saved)
        .then(() => window.electronAPI.syncSetUser(saved.id, saved.sessionToken))
        .catch(console.error);
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
  if (user === undefined) return <StartupSplash status={splashStatus} version={appVersion} />;

  // Login
  if (user === null) return (
    <LoginScreen onLogin={(u) => {
      // Ativa o perfil do usuário antes de carregar qualquer configuração,
      // isolando os dados de cada usuário DriveGO em sua própria pasta.
      window.electronAPI.setActiveProfile(u)
        .then(() => window.electronAPI.syncSetUser(u.id, u.sessionToken))
        .catch(console.error);
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
      onLogout={() => {
        window.electronAPI.clearActiveProfile().catch(console.error);
        setUser(null);
      }}
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
        {view === 'trash' && <TrashScreen user={user} />}
        {view === 'log' && <LogScreen />}
        {view === 'about' && <AboutScreen />}
      </ErrorBoundary>
    </Layout>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
