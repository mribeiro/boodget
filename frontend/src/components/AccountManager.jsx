import { useState, useEffect, useRef } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faGripVertical, faXmark, faPlus, faBoxArchive } from '@fortawesome/free-solid-svg-icons';
import { api } from '../services/api';
import ConfirmModal from './ConfirmModal';
import Checkbox from './ui/Checkbox';

const ACCOUNT_TYPES = ['Risk Investment', 'Guaranteed Investment', 'Current Account'];

export default function AccountManager({ dossierId, onClose, inline = false }) {
  const [accounts, setAccounts] = useState([]);
  const [form, setForm] = useState({ group_name: '', name: '', type: ACCOUNT_TYPES[0], is_idle_money: false });
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(null);
  const dragSrc = useRef(null);
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
      .getAccounts(dossierId, true)
      .then(setAccounts)
      .catch(() => setError('Failed to load accounts'));
  }, [dossierId]);

  async function handleCreate(e, keepOpen = false) {
    e.preventDefault();
    setError('');
    try {
      const a = await api.createAccount(dossierId, form);
      setAccounts((prev) => [...prev, a]);
      setForm({ group_name: keepOpen ? form.group_name : '', name: '', type: ACCOUNT_TYPES[0], is_idle_money: false });
      if (!keepOpen) setShowForm(false);
    } catch (err) {
      setError(err.message);
    }
  }

  function handleDragStart(index) {
    dragSrc.current = index;
  }

  function handleDragOver(e, index) {
    e.preventDefault();
    setDragOver(index);
  }

  async function handleDrop(targetIndex) {
    setDragOver(null);
    const src = dragSrc.current;
    if (src === null || src === targetIndex) return;
    dragSrc.current = null;
    const active = accounts.filter((a) => !a.archived);
    const archived = accounts.filter((a) => a.archived);
    const reordered = [...active];
    const [moved] = reordered.splice(src, 1);
    reordered.splice(targetIndex, 0, moved);
    setAccounts([...reordered, ...archived]);
    try {
      await api.reorderAccounts(dossierId, reordered.map((a) => a.id));
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleToggleIdle(account) {
    const newVal = !account.is_idle_money;
    setAccounts((prev) =>
      prev.map((a) => (a.id === account.id ? { ...a, is_idle_money: newVal ? 1 : 0 } : a))
    );
    try {
      await api.updateAccount(dossierId, account.id, { is_idle_money: newVal });
    } catch (err) {
      setError(err.message);
      setAccounts((prev) =>
        prev.map((a) => (a.id === account.id ? { ...a, is_idle_money: account.is_idle_money } : a))
      );
    }
  }

  function handleArchive(account) {
    setConfirmState({
      title: 'Archive account',
      message: `Archive account "${account.name}"? It will no longer appear in new months.`,
      confirmLabel: 'Archive',
      danger: true,
      onConfirm: async () => {
        try {
          await api.deleteAccount(dossierId, account.id);
          setAccounts((prev) =>
            prev.map((a) => (a.id === account.id ? { ...a, archived: 1 } : a))
          );
        } catch (err) {
          setError(err.message);
        }
      },
    });
  }

  const active = accounts.filter((a) => !a.archived);
  const archived = accounts.filter((a) => a.archived);

  const body = (
    <>
      {error && <div className="alert alert-error">{error}</div>}

          <div className="section-header">
            <h3 style={{ fontWeight: 600, fontSize: '0.875rem' }}>Active accounts</h3>
            <button className="btn-primary" style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem' }} onClick={() => setShowForm((v) => !v)}>
              {showForm
                ? <><FontAwesomeIcon icon={faXmark} style={{ marginRight: '0.4rem' }} />Cancel</>
                : <><FontAwesomeIcon icon={faPlus} style={{ marginRight: '0.4rem' }} />Add account</>}
            </button>
          </div>

          {showForm && (
            <form
              onSubmit={handleCreate}
              style={{
                background: 'var(--color-bg)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius)',
                padding: '1rem',
                marginBottom: '1rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem',
              }}
            >
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <div className="form-group" style={{ flex: 1, minWidth: 130, marginBottom: 0 }}>
                  <label>Group</label>
                  <input
                    type="text"
                    list="group-options"
                    value={form.group_name}
                    onChange={(e) => setForm((f) => ({ ...f, group_name: e.target.value }))}
                    placeholder="e.g. My Bank"
                    required
                  />
                  <datalist id="group-options">
                    {[...new Set(accounts.map((a) => a.group_name))].map((g) => (
                      <option key={g} value={g} />
                    ))}
                  </datalist>
                </div>
                <div className="form-group" style={{ flex: 1, minWidth: 130, marginBottom: 0 }}>
                  <label>Account name</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Savings"
                    required
                  />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div className="form-group" style={{ flex: 1, minWidth: 180, marginBottom: 0 }}>
                  <label>Type</label>
                  <select
                    value={form.type}
                    onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                  >
                    {ACCOUNT_TYPES.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="checkbox-label">
                    <Checkbox
                      checked={form.is_idle_money}
                      onChange={() => setForm((f) => ({ ...f, is_idle_money: !f.is_idle_money }))}
                    />
                    Idle money
                  </label>
                </div>
                <button type="submit" className="btn-secondary" onClick={(e) => handleCreate(e, true)}>
                  Add &amp; another
                </button>
                <button type="submit" className="btn-primary">
                  Add
                </button>
              </div>
            </form>
          )}

          {active.length === 0 && !showForm && (
            <p className="text-muted" style={{ fontSize: '0.875rem', marginBottom: '1rem' }}>
              No active accounts.
            </p>
          )}

          {active.length > 0 && (
            <div className="mobile-cards table-container" style={{ marginBottom: '1.5rem' }}>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: '1rem' }}></th>
                    <th>Group</th>
                    <th>Name</th>
                    <th>Type</th>
                    <th style={{ textAlign: 'center' }}>Idle</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {active.map((a, index) => (
                    <tr
                      key={a.id}
                      draggable
                      onDragStart={() => handleDragStart(index)}
                      onDragOver={(e) => handleDragOver(e, index)}
                      onDragLeave={() => setDragOver(null)}
                      onDrop={() => handleDrop(index)}
                      className={expandedRows.has(a.id) ? 'mobile-expanded' : ''}
                      style={{
                        cursor: 'grab',
                        outline: dragOver === index ? '2px solid var(--color-primary)' : undefined,
                      }}
                    >
                      <td className="mobile-drag-col text-muted" style={{ userSelect: 'none' }}><FontAwesomeIcon icon={faGripVertical} /></td>
                      <td className="mobile-card-title" onClick={() => toggleRow(a.id)}>
                        <span>
                          <span>{a.name}</span>
                          <span className="text-muted" style={{ fontSize: '0.8rem', marginLeft: '0.4rem' }}>{a.group_name}</span>
                        </span>
                        <button className="card-expand-btn" tabIndex={-1}>›</button>
                      </td>
                      <td data-label="Group" className="mobile-detail text-muted">{a.group_name}</td>
                      <td data-label="Type" className="mobile-detail" style={{ fontSize: '0.8rem' }}>{a.type}</td>
                      <td data-label="Idle" className="mobile-detail" style={{ textAlign: 'center' }}>
                        <button
                          className="btn-ghost"
                          style={{ fontSize: '0.8rem', color: a.is_idle_money ? 'var(--color-primary)' : 'var(--color-text-muted)' }}
                          onClick={() => handleToggleIdle(a)}
                        >
                          {a.is_idle_money ? 'Yes' : 'No'}
                        </button>
                      </td>
                      <td data-label="" className="mobile-detail">
                        <button
                          className="btn-ghost"
                          style={{ color: 'var(--color-danger)', fontSize: '0.8rem' }}
                          onClick={() => handleArchive(a)}
                        >
                          <FontAwesomeIcon icon={faBoxArchive} style={{ marginRight: '0.35rem' }} />Archive
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {archived.length > 0 && (
            <>
              <h3 style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.75rem', color: 'var(--color-text-muted)' }}>
                Archived accounts
              </h3>
              <div className="mobile-cards table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Group</th>
                      <th>Name</th>
                      <th>Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {archived.map((a) => (
                      <tr key={a.id} style={{ opacity: 0.6 }}>
                        <td className="mobile-card-title" style={{ cursor: 'default' }}>{a.name}</td>
                        <td data-label="Group" className="text-muted">{a.group_name}</td>
                        <td data-label="Type" style={{ fontSize: '0.8rem' }}>{a.type}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
    </>
  );

  if (inline) return (
    <div>
      {body}
      {confirmState && <ConfirmModal {...confirmState} onCancel={() => setConfirmState(null)} />}
    </div>
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 700 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Manage Accounts</h2>
          <button className="close-btn" onClick={onClose}>
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>
        <div className="modal-body">{body}</div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
      {confirmState && <ConfirmModal {...confirmState} onCancel={() => setConfirmState(null)} />}
    </div>
  );
}
