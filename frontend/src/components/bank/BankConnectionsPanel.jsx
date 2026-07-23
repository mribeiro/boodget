import { useState, useEffect, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faTrash, faChevronDown, faChevronUp, faArrowsRotate } from '@fortawesome/free-solid-svg-icons';
import { api } from '../../services/api';
import Modal from '../ui/Modal';
import Badge from '../ui/Badge';
import ConfirmModal from '../ConfirmModal';

export default function BankConnectionsPanel({ dossierId, autoExpandConnectionId }) {
  const [settings, setSettings] = useState(null);
  const [connections, setConnections] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [expanded, setExpanded] = useState(() => new Set(autoExpandConnectionId ? [autoExpandConnectionId] : []));
  const [connectModal, setConnectModal] = useState(null); // { country, aspsps, selectedAspsp, loadingAspsps, starting, error }
  const [confirmState, setConfirmState] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.getDossierSettings(dossierId).then(setSettings).catch(() => {});
    api.getBankConnections(dossierId).then(setConnections).catch((err) => setError(err.message));
    api.getAccounts(dossierId).then(setAccounts).catch(() => {});
  }, [dossierId]);

  useEffect(() => { load(); }, [load]);

  const configured = !!settings?.enablebanking_application_id && !!settings?.enablebanking_private_key_set;

  function toggleExpanded(id) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function openConnectModal() {
    setConnectModal({ country: '', aspsps: [], selectedAspsp: '', loadingAspsps: false, starting: false, error: '' });
  }

  async function loadAspsps(country) {
    setConnectModal((m) => ({ ...m, country, aspsps: [], selectedAspsp: '', loadingAspsps: true, error: '' }));
    try {
      const result = await api.listAspsps(dossierId, country);
      setConnectModal((m) => ({ ...m, aspsps: result.aspsps || [], loadingAspsps: false }));
    } catch (err) {
      setConnectModal((m) => ({ ...m, loadingAspsps: false, error: err.message }));
    }
  }

  async function startConnection(aspspName, aspspCountry) {
    setConnectModal((m) => ({ ...m, starting: true, error: '' }));
    try {
      const { url } = await api.startBankConnection(dossierId, { aspsp_name: aspspName, aspsp_country: aspspCountry });
      window.location.href = url;
    } catch (err) {
      setConnectModal((m) => ({ ...m, starting: false, error: err.message }));
    }
  }

  async function setMapping(connectionId, bankAccountId, accountId) {
    setError('');
    try {
      await api.setBankAccountMapping(dossierId, connectionId, bankAccountId, accountId || null);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  function confirmDisconnect(connection) {
    setConfirmState({
      title: 'Disconnect bank',
      message: `Disconnect "${connection.aspsp_name}"? Your account mappings are kept — reconnecting later will restore them.`,
      confirmLabel: 'Disconnect',
      danger: true,
      onConfirm: async () => {
        try {
          await api.disconnectBankConnection(dossierId, connection.id);
          load();
        } catch (err) {
          setError(err.message);
        }
      },
    });
  }

  const mappedAccountIds = new Set(
    connections.flatMap((c) => c.accounts.filter((a) => a.account_id).map((a) => a.account_id))
  );

  return (
    <div>
      {!configured && (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          Set the Enable Banking application ID and private key above to connect a bank.
        </p>
      )}

      {error && <div className="alert alert-error" style={{ marginBottom: '0.75rem' }}>{error}</div>}

      {configured && (
        <button className="btn-primary" onClick={openConnectModal} style={{ marginBottom: '1rem' }}>
          <FontAwesomeIcon icon={faPlus} style={{ marginRight: '0.4rem' }} />
          Connect a bank
        </button>
      )}

      {connections.length === 0 ? (
        configured && <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No bank connections yet.</p>
      ) : (
        <div>
          {connections.map((conn) => (
            <div key={conn.id} className="card card--flat" style={{ marginBottom: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <strong>{conn.aspsp_name}</strong>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{conn.aspsp_country}</span>
                  {conn.status === 'revoked' ? (
                    <Badge variant="neutral">Disconnected</Badge>
                  ) : conn.is_expired ? (
                    <Badge variant="warning">Expired</Badge>
                  ) : (
                    <Badge variant="success">Active</Badge>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  {conn.status !== 'active' || conn.is_expired ? (
                    <button className="btn-secondary" onClick={() => startConnection(conn.aspsp_name, conn.aspsp_country)}>
                      <FontAwesomeIcon icon={faArrowsRotate} style={{ marginRight: '0.4rem' }} />
                      Reconnect
                    </button>
                  ) : (
                    <button className="btn-secondary" onClick={() => confirmDisconnect(conn)}>
                      <FontAwesomeIcon icon={faTrash} style={{ marginRight: '0.4rem' }} />
                      Disconnect
                    </button>
                  )}
                  <button
                    className="btn-secondary"
                    onClick={() => toggleExpanded(conn.id)}
                    style={{ padding: '0.5rem 0.6rem' }}
                    aria-label="Toggle bank account mappings"
                  >
                    <FontAwesomeIcon icon={expanded.has(conn.id) ? faChevronUp : faChevronDown} />
                  </button>
                </div>
              </div>

              {expanded.has(conn.id) && (
                <div style={{ marginTop: '0.75rem', borderTop: '1px solid var(--border-default)', paddingTop: '0.75rem' }}>
                  {conn.accounts.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>No bank accounts returned by this connection.</p>
                  ) : (
                    conn.accounts.map((bankAccount) => (
                      <div key={bankAccount.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                        <span style={{ flex: 1, fontSize: '0.85rem' }}>
                          {bankAccount.display_name || bankAccount.iban || bankAccount.external_account_uid}
                          {bankAccount.iban && <span style={{ color: 'var(--text-muted)' }}> · {bankAccount.iban}</span>}
                        </span>
                        <select
                          value={bankAccount.account_id || ''}
                          onChange={(e) => setMapping(conn.id, bankAccount.id, e.target.value || null)}
                          style={{ minWidth: '12rem' }}
                        >
                          <option value="">Not mapped</option>
                          {accounts
                            .filter((a) => a.id === bankAccount.account_id || !mappedAccountIds.has(a.id))
                            .map((a) => (
                              <option key={a.id} value={a.id}>{a.group_name} / {a.name}</option>
                            ))}
                        </select>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {connectModal && (
        <Modal
          title="Connect a bank"
          onClose={() => setConnectModal(null)}
        >
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
              Country
            </label>
            <input
              type="text"
              placeholder="ISO country code, e.g. FI"
              value={connectModal.country}
              onChange={(e) => setConnectModal((m) => ({ ...m, country: e.target.value.toUpperCase() }))}
              onKeyDown={(e) => { if (e.key === 'Enter' && connectModal.country) loadAspsps(connectModal.country); }}
              style={{ width: '10rem', textTransform: 'uppercase' }}
              maxLength={2}
            />
            <button
              className="btn-secondary"
              onClick={() => loadAspsps(connectModal.country)}
              disabled={!connectModal.country || connectModal.loadingAspsps}
              style={{ marginLeft: '0.5rem' }}
            >
              {connectModal.loadingAspsps ? 'Loading…' : 'Search'}
            </button>
          </div>

          {connectModal.aspsps.length > 0 && (
            <div style={{ marginBottom: '0.75rem' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                Bank
              </label>
              <select
                value={connectModal.selectedAspsp}
                onChange={(e) => setConnectModal((m) => ({ ...m, selectedAspsp: e.target.value }))}
                style={{ width: '100%' }}
              >
                <option value="">Select a bank…</option>
                {connectModal.aspsps.map((a) => (
                  <option key={a.name} value={a.name}>{a.name}</option>
                ))}
              </select>
            </div>
          )}

          {connectModal.error && <div className="alert alert-error" style={{ marginBottom: '0.75rem' }}>{connectModal.error}</div>}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
            <button className="btn-secondary" onClick={() => setConnectModal(null)}>Cancel</button>
            <button
              className="btn-primary"
              disabled={!connectModal.selectedAspsp || connectModal.starting}
              onClick={() => startConnection(connectModal.selectedAspsp, connectModal.country)}
            >
              {connectModal.starting ? 'Redirecting…' : 'Continue to bank'}
            </button>
          </div>
        </Modal>
      )}

      {confirmState && <ConfirmModal {...confirmState} onCancel={() => setConfirmState(null)} />}
    </div>
  );
}
