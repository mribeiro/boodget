import { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUserMinus } from '@fortawesome/free-solid-svg-icons';
import { api } from '../services/api';
import ConfirmModal from './ConfirmModal';

export default function ShareManager({ dossierId, showToast }) {
  const [sharedUsers, setSharedUsers] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [error, setError] = useState('');
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    Promise.all([api.getDossierAccess(dossierId), api.getUsers()])
      .then(([access, users]) => {
        setSharedUsers(access);
        setAllUsers(users);
      })
      .catch(() => setError('Failed to load sharing info'));
  }, [dossierId]);

  const [confirmState, setConfirmState] = useState(null);

  const sharedIds = new Set(sharedUsers.map((u) => u.id));
  const availableUsers = allUsers.filter((u) => !sharedIds.has(u.id));

  async function handleShare(e) {
    e.preventDefault();
    if (!selectedUserId || sharing) return;
    setError('');
    setSharing(true);
    try {
      await api.shareDossier(dossierId, { userId: selectedUserId });
      const user = allUsers.find((u) => u.id === selectedUserId);
      setSharedUsers((prev) => [...prev, user]);
      setSelectedUserId('');
      showToast?.(`Shared with ${user.username}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSharing(false);
    }
  }

  async function handleRevoke(userId) {
    const user = sharedUsers.find((u) => u.id === userId);
    setConfirmState({
      title: 'Revoke access',
      message: `Revoke access for "${user?.username}"?`,
      confirmLabel: 'Revoke',
      danger: true,
      onConfirm: async () => {
        setError('');
        try {
          await api.revokeAccess(dossierId, userId);
          setSharedUsers((prev) => prev.filter((u) => u.id !== userId));
          showToast?.(`Access revoked for ${user?.username ?? 'user'}`);
        } catch (err) {
          setError(err.message);
        }
      },
    });
  }

  return (
    <div>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="section-header">
        <h2>Shared with</h2>
      </div>

      {availableUsers.length > 0 && (
        <form onSubmit={handleShare} style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
          <select value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)} style={{ flex: 1 }}>
            <option value="">Select a user...</option>
            {availableUsers.map((u) => (
              <option key={u.id} value={u.id}>{u.username}</option>
            ))}
          </select>
          <button type="submit" className="btn-primary" disabled={!selectedUserId || sharing}>
            {sharing ? 'Sharing\u2026' : 'Share'}
          </button>
        </form>
      )}

      {sharedUsers.length === 0 ? (
        <div className="empty-state"><p>This dossier is not shared with anyone.</p></div>
      ) : (
        <div className="mobile-cards table-container">
          <table>
            <thead>
              <tr>
                <th>Username</th>
                <th style={{ width: 150 }}></th>
              </tr>
            </thead>
            <tbody>
              {sharedUsers.map((u) => (
                <tr key={u.id}>
                  <td className="mobile-card-title" style={{ cursor: 'default' }}>{u.username}</td>
                  <td data-label="" className="mobile-detail-actions" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <span className="met-actions">
                      <button className="btn-danger btn-sm" onClick={() => handleRevoke(u.id)}>
                        <FontAwesomeIcon icon={faUserMinus} />Revoke
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {confirmState && <ConfirmModal {...confirmState} onCancel={() => setConfirmState(null)} />}
    </div>
  );
}
