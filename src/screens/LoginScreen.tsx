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
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                  <path d="M11 2C7.7 2 5 4.7 5 8c0 .5.1 1 .3 1.5A3.5 3.5 0 0 0 5.5 16h11a3 3 0 0 0 .3-6A5 5 0 0 0 11 2z" fill="white" opacity="0.95"/>
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
