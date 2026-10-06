import { useContext, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AuthContext } from '../App';
import { api } from '../services/api';
import ConfirmModal from './ConfirmModal';

const LINK_ERRORS = {
  taken: 'That SSO identity is already linked to another boodget account. An administrator must delete that account before it can be linked here.',
  already_linked: 'This account is already linked to a different SSO identity. Unlink it first.',
  sso_account: 'SSO accounts are already linked to their identity.',
  session: 'Your session changed while linking. Sign in again and retry.',
  oidc: 'SSO linking failed. Please try again.',
};

export default function SsoAccount() {
  const navigate = useNavigate();
  const { user, setAuthState } = useContext(AuthContext);
  const [searchParams, setSearchParams] = useSearchParams();
  const [providerName, setProviderName] = useState('SSO');
  const [enabled, setEnabled] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmState, setConfirmState] = useState(null);

  useEffect(() => {
    api.getOidcConfig()
      .then((cfg) => { setEnabled(cfg.enabled); setProviderName(cfg.providerName); })
      .catch(() => setEnabled(false));
    // Result of the round trip through the identity provider, then drop it from the URL.
    const code = searchParams.get('error');
    if (code) setError(LINK_ERRORS[code] || LINK_ERRORS.oidc);
    else if (searchParams.get('linked')) setSuccess('SSO linked. You can now sign in with SSO or with your password.');
    if (code || searchParams.get('linked')) setSearchParams({}, { replace: true });
  }, []);

  async function handleLink() {
    setError('');
    setSuccess('');
    setBusy(true);
    try {
      const { url } = await api.startOidcLink();
      window.location.href = url;
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function handleUnlink() {
    setConfirmState(null);
    setError('');
    setSuccess('');
    setBusy(true);
    try {
      await api.unlinkOidc();
      setAuthState((s) => ({ ...s, user: { ...s.user, oidc_linked: false } }));
      setSuccess('SSO unlinked. Sign in with your password from now on.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <button className="btn-ghost" onClick={() => navigate('/')}>
          &larr; Back
        </button>
        <h1>Single Sign-On</h1>
      </div>

      <div style={{ maxWidth: 440 }}>
        {error && <div className="alert alert-error">{error}</div>}
        {success && <div className="alert alert-success">{success}</div>}

        <div
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius)',
            padding: '1.5rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
          }}
        >
          {user?.is_oidc ? (
            <p style={{ margin: 0 }}>This account signs in with {providerName}. There is nothing to link.</p>
          ) : enabled === false ? (
            <p style={{ margin: 0 }}>Single sign-on is not configured on this server.</p>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
                <strong>{providerName}</strong>
                <span className={`badge ${user?.oidc_linked ? 'badge-success' : 'badge-neutral'}`}>
                  {user?.oidc_linked ? 'Linked' : 'Not linked'}
                </span>
              </div>
              <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 14 }}>
                {user?.oidc_linked
                  ? 'Signing in with SSO opens this account. Your password keeps working too.'
                  : 'Link your SSO identity to sign in to this account with SSO, even if your SSO username matches this one. Your password keeps working too.'}
              </p>
              <div className="form-actions" style={{ marginTop: 0 }}>
                {user?.oidc_linked ? (
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={busy}
                    onClick={() => setConfirmState({
                      title: 'Unlink SSO',
                      message: `Signing in with ${providerName} will no longer open this account. You can link it again at any time.`,
                      confirmLabel: 'Unlink',
                      danger: true,
                      onConfirm: handleUnlink,
                    })}
                  >
                    Unlink
                  </button>
                ) : (
                  <button type="button" className="btn-primary" disabled={busy || enabled === null} onClick={handleLink}>
                    {busy ? 'Redirecting...' : `Link ${providerName}`}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {confirmState && <ConfirmModal {...confirmState} onCancel={() => setConfirmState(null)} />}
    </div>
  );
}
