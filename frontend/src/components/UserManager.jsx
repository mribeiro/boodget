import { useState, useEffect, useContext } from 'react';
import { api } from '../services/api';
import { AuthContext } from '../App';

export default function UserManager() {
  const { user: currentUser } = useContext(AuthContext);
  const [users, setUsers] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ username: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);

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

  async function handleDelete(user) {
    if (!confirm(`Delete user "${user.username}"? All their dossiers will also be deleted.`)) return;
    setError('');
    setSuccess('');
    try {
      await api.deleteUser(user.id);
      setUsers((prev) => prev.filter((u) => u.id !== user.id));
      setSuccess(`User "${user.username}" deleted`);
    } catch (err) {
      setError(err.message);
    }
  }

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <h1>Users</h1>
        <div className="page-header-actions">
          <button className="btn-primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : 'New user'}
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {showForm && (
        <div
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius)',
            padding: '1.25rem',
            marginBottom: '1.5rem',
            maxWidth: 480,
          }}
        >
          <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>Create user</h2>

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

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Username</th>
              <th>Auth</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  {u.username}
                  {u.id === currentUser.id && (
                    <span
                      className="badge"
                      style={{
                        marginLeft: '0.5rem',
                        background: '#dbeafe',
                        color: 'var(--color-primary)',
                        fontSize: '0.7rem',
                      }}
                    >
                      You
                    </span>
                  )}
                </td>
                <td style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                  {u.is_oidc ? 'SSO' : 'Local'}
                </td>
                <td style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                  {new Date(u.created_at).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}
                </td>
                <td>
                  {u.id !== currentUser.id && (
                    <button
                      className="btn-ghost"
                      style={{ color: 'var(--color-danger)', fontSize: '0.8rem' }}
                      onClick={() => handleDelete(u)}
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
