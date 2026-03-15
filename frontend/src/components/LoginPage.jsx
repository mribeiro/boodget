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
          <div style={{
            width: 36, height: 36, borderRadius: '50%',
            background: 'linear-gradient(135deg, #38bdf8, #6366f1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: 18, fontWeight: 700, flexShrink: 0,
          }}>
            C
          </div>
          <div>
            <h1 style={{ fontSize: 18, marginBottom: 0 }}>Capital Tracker</h1>
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
