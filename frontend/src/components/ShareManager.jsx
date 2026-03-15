import { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark, faUserMinus } from '@fortawesome/free-solid-svg-icons';
import { api } from '../services/api';

export default function ShareManager({ dossierId, onClose }) {
  const [sharedUsers, setSharedUsers] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.getDossierAccess(dossierId), api.getUsers()])
      .then(([access, users]) => {
        setSharedUsers(access);
        setAllUsers(users);
      })
      .catch(() => setError('Failed to load sharing info'));
  }, [dossierId]);

  const sharedIds = new Set(sharedUsers.map((u) => u.id));
  const availableUsers = allUsers.filter((u) => !sharedIds.has(u.id));

  async function handleShare(e) {
    e.preventDefault();
    if (!selectedUserId) return;
    setError('');
    try {
      await api.shareDossier(dossierId, { userId: selectedUserId });
      const user = allUsers.find((u) => u.id === selectedUserId);
      setSharedUsers((prev) => [...prev, user]);
      setSelectedUserId('');
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleRevoke(userId) {
    const user = sharedUsers.find((u) => u.id === userId);
    if (!confirm(`Revoke access for "${user?.username}"?`)) return;
    setError('');
    try {
      await api.revokeAccess(dossierId, userId);
      setSharedUsers((prev) => prev.filter((u) => u.id !== userId));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Share Dossier</h2>
          <button className="close-btn" onClick={onClose}>
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>
        <div className="modal-body">
          {error && <div className="alert alert-error">{error}</div>}

          {availableUsers.length > 0 && (
            <form onSubmit={handleShare} style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                style={{ flex: 1 }}
              >
                <option value="">Select a user...</option>
                {availableUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.username}
                  </option>
                ))}
              </select>
              <button type="submit" className="btn-primary" disabled={!selectedUserId}>
                Share
              </button>
            </form>
          )}

          {sharedUsers.length === 0 ? (
            <p className="text-muted" style={{ fontSize: '0.875rem' }}>
              This dossier is not shared with anyone.
            </p>
          ) : (
            <div className="mobile-cards table-container">
              <table>
                <thead>
                  <tr>
                    <th>Username</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {sharedUsers.map((u) => (
                    <tr key={u.id}>
                      <td className="mobile-card-title" style={{ cursor: 'default' }}>{u.username}</td>
                      <td data-label="">
                        <button
                          className="btn-ghost"
                          style={{ color: 'var(--color-danger)', fontSize: '0.8rem' }}
                          onClick={() => handleRevoke(u.id)}
                        >
                          <FontAwesomeIcon icon={faUserMinus} style={{ marginRight: '0.35rem' }} />Revoke
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
