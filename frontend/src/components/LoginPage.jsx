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
              <linearGradient id="lg-login-bg" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#7FD7DD"/>
                <stop offset="100%" stopColor="#1F7A8C"/>
              </linearGradient>
              <linearGradient id="lg-login-body" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#FFFFFF"/>
                <stop offset="100%" stopColor="#EAF6F8"/>
              </linearGradient>
              <radialGradient id="lg-login-coin" cx="35%" cy="30%" r="80%">
                <stop offset="0%" stopColor="#FFE9A8"/>
                <stop offset="55%" stopColor="#F4BE3E"/>
                <stop offset="100%" stopColor="#D98E04"/>
              </radialGradient>
            </defs>
            <rect x="0" y="0" width="512" height="512" rx="120" ry="120" fill="url(#lg-login-bg)"/>
            <g transform="translate(110.5,96) scale(1.4545)">
              <path d="M16,102 A84,84 0 0 1 184,102 L184,178 Q176,206 160,178 Q152,206 136,178 Q128,206 112,178 Q104,206 88,178 Q80,206 64,178 Q56,206 40,178 Q32,206 16,178 Z" fill="url(#lg-login-body)" stroke="#123A46" strokeWidth="4.5" strokeLinejoin="round"/>
              <path d="M52,100 Q60,88 68,100" fill="none" stroke="#123A46" strokeWidth="5" strokeLinecap="round"/>
              <path d="M112,100 Q120,88 128,100" fill="none" stroke="#123A46" strokeWidth="5" strokeLinecap="round"/>
              <path d="M78,116 Q90,126 102,116" fill="none" stroke="#123A46" strokeWidth="4.5" strokeLinecap="round"/>
              <circle cx="128" cy="164" r="25" fill="url(#lg-login-coin)" stroke="#123A46" strokeWidth="4"/>
              <circle cx="128" cy="164" r="17" fill="none" stroke="#D98E04" strokeWidth="2.5" opacity="0.6"/>
            </g>
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
