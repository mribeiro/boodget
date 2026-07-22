import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../../services/api';

export default function BankCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [state, setState] = useState({ status: 'loading', message: '' });

  useEffect(() => {
    const error = searchParams.get('error');
    if (error) {
      setState({ status: 'error', message: 'Connection cancelled — you did not complete the consent at your bank.' });
      return;
    }

    const code = searchParams.get('code');
    const oauthState = searchParams.get('state');
    if (!code || !oauthState) {
      setState({ status: 'error', message: 'This link is missing required parameters.' });
      return;
    }

    api
      .completeBankConnection({ code, state: oauthState })
      .then(({ dossier_id, connection_id }) => {
        navigate(`/dossiers/${dossier_id}`, {
          replace: true,
          state: { tab: 'settings', bankConnectionId: connection_id },
        });
      })
      .catch((err) => {
        setState({ status: 'error', message: err.message });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state.status === 'loading') {
    return <div className="loading">Connecting your bank…</div>;
  }

  return (
    <div className="server-error-screen">
      <div className="server-error-card">
        <h2 className="server-error-title">Could not connect your bank</h2>
        <p className="server-error-message">{state.message}</p>
        <Link className="btn-primary" to="/">Back to dossiers</Link>
      </div>
    </div>
  );
}
