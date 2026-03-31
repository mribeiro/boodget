import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../services/api';

export default function LoginPage({ onLogin }) {
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [oidcConfig, setOidcConfig] = useState({ enabled: false, providerName: 'SSO Login' });
  const [searchParams] = useSearchParams();

  useEffect(() => {
    api.getOidcConfig().then((cfg) => {
      setOidcConfig(cfg);
      if (cfg.prefill) {
        setForm({ username: cfg.prefill.username, password: cfg.prefill.password });
      }
    }).catch(() => {});
    if (searchParams.get('error') === 'oidc') {
      setError('SSO login failed. Please try again.');
    }
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await api.login({ username: form.username, password: form.password });
      onLogin(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleOidc() {
    window.location.href = '/api/auth/oidc/start';
  }

  return (
    <div className="form-centered page-fade-in">
      <div className="form-card">
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
          <svg width="36" height="36" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
            <defs>
              <linearGradient id="lg-login" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#8b5cf6"/>
                <stop offset="100%" stopColor="#38bdf8"/>
              </linearGradient>
            </defs>
            <rect width="512" height="512" rx="120" fill="url(#lg-login)"/>
            <path d="M136,400 L136,280 A120,120 0 0,1 376,280 L376,400 Q346,368 316,400 Q286,432 256,400 Q226,368 196,400 Q166,432 136,400 Z" fill="white"/>
            <circle cx="210" cy="250" r="26" fill="#1e1b4b"/>
            <circle cx="302" cy="250" r="26" fill="#1e1b4b"/>
            <circle cx="220" cy="240" r="9" fill="white"/>
            <circle cx="312" cy="240" r="9" fill="white"/>
            <path d="M220,295 Q256,318 292,295" fill="none" stroke="#1e1b4b" strokeWidth="8" strokeLinecap="round"/>
            <circle cx="256" cy="348" r="34" fill="#f59e0b"/>
            <circle cx="256" cy="348" r="25" fill="#fbbf24"/>
            <circle cx="256" cy="348" r="15" fill="#f59e0b"/>
          </svg>
          <div>
            <h1 style={{ fontSize: 18, marginBottom: 0 }}>boodget</h1>
          </div>
        </div>

        <p className="subtitle">Sign in to your account</p>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              type="text"
              value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
              autoComplete="username"
              autoFocus
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              autoComplete="current-password"
              required
            />
          </div>
          <div className="form-actions">
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </div>
        </form>

        {oidcConfig.enabled && (
          <div style={{ marginTop: 'var(--space-5)', textAlign: 'center' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 'var(--space-3)' }}>
              or
            </div>
            <button
              type="button"
              className="btn-secondary"
              style={{ width: '100%' }}
              onClick={handleOidc}
            >
              Sign in with {oidcConfig.providerName}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
