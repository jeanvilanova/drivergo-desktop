import React, { useState, FormEvent } from 'react';
import { login } from '../lib/CloudClient';
import { saveSession } from '../lib/session';
import type { CloudUser } from '../lib/CloudClient';
import { IconAlert } from '../components/Icons';

interface Props { onLogin: (user: CloudUser) => void }

export default function LoginScreen({ onLogin }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;
    setLoading(true);
    setError('');
    try {
      const user = await login(username.trim(), password);
      saveSession(user);
      onLogin(user);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro';
      setError(msg === 'Invalid credentials' ? 'Usuário ou senha incorretos.' : msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="titlebar" />
      <div className="login-body">

        {/* Left brand panel */}
        <div className="login-brand">
          <div>
            <div className="login-brand-logo">
              <div className="login-brand-logo-mark">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  {/* cloud back */}
                  <path d="M4 16.5 Q4 12 8 12 Q8 9 11 9 Q14 7.5 16.5 9.5 Q19 9 19 12 Q21.5 12 21.5 14.5 Q21.5 17 18.5 17 H6.5 Q4 17 4 16.5Z" fill="white" opacity="0.20"/>
                  {/* cloud front */}
                  <path d="M3 16 Q3 12 7 12 Q7.5 9 10 9 Q13 7 15.5 9 Q18 8.5 18.5 11.5 Q21 11.5 21 14 Q21 16.5 18 16.5 H6 Q3 16.5 3 16Z" fill="white" opacity="0.88"/>
                  {/* wifi arcs */}
                  <path d="M1.5 12 Q0.5 9.5 2 7.5" stroke="#29d4f5" strokeWidth="1.5" fill="none" strokeLinecap="round" opacity="0.9"/>
                  <path d="M3 13.5 Q1.5 10.5 3.5 8" stroke="#29d4f5" strokeWidth="1.2" fill="none" strokeLinecap="round" opacity="0.7"/>
                  {/* padlock body */}
                  <rect x="7" y="13.5" width="7" height="5.5" rx="1.5" fill="#fdc72e"/>
                  {/* padlock shackle */}
                  <path d="M8.5 13.5 Q8.5 11 10.5 11 Q12.5 11 12.5 13.5" stroke="white" strokeWidth="1.6" fill="none" strokeLinecap="round"/>
                  {/* shield */}
                  <path d="M16 13.5 Q16 12 17.5 11.5 L19.5 11.5 Q21 12 21 13.5 L21 16 Q21 18 18.5 19 Q16 18 16 16Z" fill="#2dbe6c"/>
                  {/* checkmark */}
                  <path d="M17.2 15.2 L18.4 16.5 L20.2 14.2" stroke="white" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                </svg>
              </div>
              <span className="login-brand-logo-text">
                <span style={{ color: '#5caeff' }}>Drive</span><span style={{ color: '#fdc72e' }}>GO</span>
              </span>
            </div>
            <div className="login-brand-tagline">
              Segurança e mobilidade para seus dados na nuvem.
            </div>
            <div className="login-brand-version">Versão 1.0 · Desktop</div>
          </div>
        </div>

        {/* Right form area */}
        <div className="login-form-area">
          <form className="login-card" onSubmit={handleSubmit}>
            <div className="login-title">Bem-vindo</div>
            <div className="login-sub">Entre com suas credenciais para continuar</div>

            {error && (
              <div className="login-error">
                <IconAlert size={14} />
                {error}
              </div>
            )}

            <div className="field">
              <label>Usuário</label>
              <input
                type="text" placeholder="seu.usuario"
                autoFocus autoComplete="username"
                value={username} onChange={(e) => setUsername(e.target.value)}
              />
            </div>

            <div className="field">
              <label>Senha</label>
              <input
                type="password" placeholder="••••••••"
                autoComplete="current-password"
                value={password} onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <button
              type="submit" className="btn btn-primary"
              style={{ width: '100%', marginTop: 8, padding: '11px 0', fontSize: 14 }}
              disabled={loading}
            >
              {loading ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                  Entrando…
                </span>
              ) : 'Entrar'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
