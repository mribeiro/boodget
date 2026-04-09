import { useState, useEffect, useContext } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUserPlus, faTrash, faXmark, faChevronRight } from '@fortawesome/free-solid-svg-icons';
import { api } from '../services/api';
import { AuthContext } from '../App';
import ConfirmModal from './ConfirmModal';

export default function UserManager() {
  const { user: currentUser } = useContext(AuthContext);
  const [users, setUsers] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ username: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [confirmState, setConfirmState] = useState(null);

  function toggleRow(id) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  useEffect(() => {
    api
      .getUsers()
      .then(setUsers)
      .catch(() => setError('Failed to load users'))
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (form.password !== form.confirm) {
      setError('Passwords do not match');
      return;
    }
    try {
      const u = await api.createUser({ username: form.username, password: form.password });
      setUsers((prev) => [...prev, u].sort((a, b) => a.username.localeCompare(b.username)));
      setForm({ username: '', password: '', confirm: '' });
      setShowForm(false);
      setSuccess(`User "${u.username}" created successfully`);
    } catch (err) {
      setError(err.message);
    }
  }

  function handleDelete(user) {
    setConfirmState({
      title: 'Delete user',
      message: `Delete user "${user.username}"? All their dossiers will also be deleted.`,
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: async () => {
        setError('');
        setSuccess('');
        try {
          await api.deleteUser(user.id);
          setUsers((prev) => prev.filter((u) => u.id !== user.id));
          setSuccess(`User "${user.username}" deleted`);
        } catch (err) {
          setError(err.message);
        }
      },
    });
  }

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <h1>Users</h1>
        <div className="page-header-actions">
          <button className="btn-primary btn-sm" onClick={() => setShowForm((v) => !v)}>
            {showForm
              ? <><FontAwesomeIcon icon={faXmark} style={{ marginRight: '0.4rem' }} />Cancel</>
              : <><FontAwesomeIcon icon={faUserPlus} style={{ marginRight: '0.4rem' }} />Add user</>}
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {showForm && (
        <div className="card card--flat" style={{ marginBottom: 'var(--space-5)', maxWidth: 480 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 'var(--space-4)', paddingBottom: 'var(--space-3)', borderBottom: '1px solid var(--border-default)' }}>
            Create user
          </h2>

          <div className="password-rules">
            <strong>Password requirements:</strong>
            <ul>
              <li>At least 16 characters</li>
              <li>Uppercase, lowercase, numbers, and symbols</li>
            </ul>
          </div>

          <form onSubmit={handleCreate}>
            <div className="form-group">
              <label>Username</label>
              <input
                type="text"
                value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                required
              />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                required
              />
            </div>
            <div className="form-group">
              <label>Confirm password</label>
              <input
                type="password"
                value={form.confirm}
                onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))}
                required
              />
            </div>
            <div className="form-actions">
              <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>
                Cancel
              </button>
              <button type="submit" className="btn-primary">
                Create user
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="mobile-cards table-container">
        <table>
          <thead>
            <tr>
              <th>Username</th>
              <th>Type</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={expandedRows.has(u.id) ? 'mobile-expanded' : ''}>
                <td className="mobile-card-title" onClick={() => toggleRow(u.id)}>
                  <span>
                    <span style={{ fontWeight: 500 }}>{u.username}</span>
                    {u.id === currentUser.id && (
                      <span className="badge badge-brand" style={{ marginLeft: 8 }}>You</span>
                    )}
                  </span>
                  <span className="mobile-card-inline-value">
                    <span className="badge badge-neutral">{u.is_oidc ? 'SSO' : 'Local'}</span>
                  </span>
                  <button className="card-expand-btn" tabIndex={-1}><FontAwesomeIcon icon={faChevronRight} /></button>
                </td>
                <td data-label="Type" className="mobile-summary-in-title">
                  <span className="badge badge-neutral">
                    {u.is_oidc ? 'SSO' : 'Local'}
                  </span>
                </td>
                <td data-label="Created" className="mobile-detail text-sm" style={{ color: 'var(--text-muted)' }}>
                  {new Date(u.created_at).toLocaleDateString('en-US', {
                    year: 'numeric', month: 'short', day: 'numeric',
                  })}
                </td>
                <td data-label="" className="mobile-detail">
                  {u.id !== currentUser.id && (
                    <button
                      className="btn-ghost btn-sm"
                      style={{ color: 'var(--color-danger)' }}
                      onClick={() => handleDelete(u)}
                    >
                      <FontAwesomeIcon icon={faTrash} style={{ marginRight: '0.35rem' }} />Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {confirmState && <ConfirmModal {...confirmState} onCancel={() => setConfirmState(null)} />}
    </div>
  );
}
