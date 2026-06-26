import { useState, useEffect, useRef } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faGripVertical, faXmark, faPlus, faBoxArchive, faChevronRight } from '@fortawesome/free-solid-svg-icons';
import { api } from '../services/api';
import ConfirmModal from './ConfirmModal';
import Checkbox from './ui/Checkbox';
import CollapsibleSection from './ui/CollapsibleSection';
import Toast from './ui/Toast';

const ACCOUNT_TYPES = ['Risk Investment', 'Guaranteed Investment', 'Current Account'];
const MONEY_CATEGORIES = ['idle', 'active', 'stocks'];
const MONEY_CATEGORY_LABELS = { idle: 'Idle', active: 'Active', stocks: 'Stocks' };

export default function AccountManager({ dossierId, onClose, inline = false }) {
  const [accounts, setAccounts] = useState([]);
  const [form, setForm] = useState({ group_name: '', name: '', type: ACCOUNT_TYPES[0], money_category: 'active', can_receive_transfers: true });
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(null);
  const dragSrc = useRef(null);
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [confirmState, setConfirmState] = useState(null);
  const [groupCollapsed, setGroupCollapsed] = useState({});
  const [archivedCollapsed, setArchivedCollapsed] = useState(true);
  const [toast, setToast] = useState({ msg: '', show: false });
  const toastTimer = useRef(null);
  function showToast(msg) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, show: true });
    toastTimer.current = setTimeout(() => setToast((t) => ({ ...t, show: false })), 2000);
  }

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
      setForm({ group_name: keepOpen ? form.group_name : '', name: '', type: ACCOUNT_TYPES[0], money_category: 'active', can_receive_transfers: true });
      if (!keepOpen) setShowForm(false);
      showToast('Account added');
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

  async function handleChangeCategory(account, newCategory) {
    const prevCategory = account.money_category;
    setAccounts((prev) =>
      prev.map((a) => (a.id === account.id ? { ...a, money_category: newCategory } : a))
    );
    try {
      await api.updateAccount(dossierId, account.id, { money_category: newCategory });
    } catch (err) {
      setError(err.message);
      setAccounts((prev) =>
        prev.map((a) => (a.id === account.id ? { ...a, money_category: prevCategory } : a))
      );
    }
  }

  async function handleToggleTransfers(account) {
    const newVal = !account.can_receive_transfers;
    setAccounts((prev) =>
      prev.map((a) => (a.id === account.id ? { ...a, can_receive_transfers: newVal ? 1 : 0 } : a))
    );
    try {
      await api.updateAccount(dossierId, account.id, { can_receive_transfers: newVal });
    } catch (err) {
      setError(err.message);
      setAccounts((prev) =>
        prev.map((a) => (a.id === account.id ? { ...a, can_receive_transfers: account.can_receive_transfers } : a))
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
          showToast('Account archived');
        } catch (err) {
          setError(err.message);
        }
      },
    });
  }

  const active = accounts.filter((a) => !a.archived);
  const archived = accounts.filter((a) => a.archived);

  // Group active accounts by group_name, preserving global index for drag-and-drop
  const groupedActive = active.reduce((acc, a, idx) => {
    if (!acc[a.group_name]) acc[a.group_name] = [];
    acc[a.group_name].push({ ...a, activeIndex: idx });
    return acc;
  }, {});

  const body = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
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
            <div className="form-group" style={{ minWidth: 130, marginBottom: 0 }}>
              <label>Category</label>
              <select
                value={form.money_category}
                onChange={(e) => setForm((f) => ({ ...f, money_category: e.target.value }))}
              >
                {MONEY_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{MONEY_CATEGORY_LABELS[c]}</option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="checkbox-label">
                <Checkbox
                  checked={form.can_receive_transfers}
                  onChange={() => setForm((f) => ({ ...f, can_receive_transfers: !f.can_receive_transfers }))}
                />
                Can receive transfers
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
        <p className="text-muted" style={{ fontSize: '0.875rem' }}>
          No active accounts.
        </p>
      )}

      {Object.entries(groupedActive).map(([groupName, groupAccounts]) => (
        <CollapsibleSection
          key={groupName}
          title={groupName}
          count={groupAccounts.length}
          accent="var(--color-brand)"
          collapsed={!!groupCollapsed[groupName]}
          onToggle={() => setGroupCollapsed((prev) => ({ ...prev, [groupName]: !prev[groupName] }))}
        >
          <div className="mobile-cards table-container" style={{ marginTop: 0, borderRadius: 0, border: 'none', borderTop: '1px solid var(--color-border)' }}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: '1rem' }}></th>
                  <th>Name</th>
                  <th>Type</th>
                  <th style={{ textAlign: 'center' }}>Category</th>
                  <th style={{ textAlign: 'center' }}>Transfers</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {groupAccounts.map((a) => (
                  <tr
                    key={a.id}
                    draggable
                    onDragStart={() => handleDragStart(a.activeIndex)}
                    onDragOver={(e) => handleDragOver(e, a.activeIndex)}
                    onDragLeave={() => setDragOver(null)}
                    onDrop={() => handleDrop(a.activeIndex)}
                    className={expandedRows.has(a.id) ? 'mobile-expanded' : ''}
                    style={{
                      cursor: 'grab',
                      outline: dragOver === a.activeIndex ? '2px solid var(--color-primary)' : undefined,
                    }}
                  >
                    <td className="mobile-drag-col text-muted" style={{ userSelect: 'none' }}><FontAwesomeIcon icon={faGripVertical} /></td>
                    <td className="mobile-card-title" onClick={() => toggleRow(a.id)}>
                      <span>{a.name}</span>
                      <button className="card-expand-btn" tabIndex={-1}><FontAwesomeIcon icon={faChevronRight} /></button>
                    </td>
                    <td data-label="Type" className="mobile-detail" style={{ fontSize: '0.8rem' }}>{a.type}</td>
                    <td data-label="Category" className="mobile-detail" style={{ textAlign: 'center' }}>
                      <select
                        value={a.money_category}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => handleChangeCategory(a, e.target.value)}
                        style={{ fontSize: '0.8rem', color: a.money_category === 'active' ? 'var(--color-text-muted)' : 'var(--color-primary)' }}
                      >
                        {MONEY_CATEGORIES.map((c) => (
                          <option key={c} value={c}>{MONEY_CATEGORY_LABELS[c]}</option>
                        ))}
                      </select>
                    </td>
                    <td data-label="Transfers" className="mobile-detail" style={{ textAlign: 'center' }}>
                      <button
                        className="btn-ghost"
                        style={{ fontSize: '0.8rem', color: a.can_receive_transfers ? 'var(--color-primary)' : 'var(--color-text-muted)' }}
                        onClick={() => handleToggleTransfers(a)}
                      >
                        {a.can_receive_transfers ? 'Yes' : 'No'}
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
        </CollapsibleSection>
      ))}

      {archived.length > 0 && (
        <CollapsibleSection
          title="Archived accounts"
          count={archived.length}
          accent="var(--color-text-muted)"
          collapsed={archivedCollapsed}
          onToggle={() => setArchivedCollapsed((v) => !v)}
        >
          <div className="mobile-cards table-container" style={{ borderRadius: 0, border: 'none', borderTop: '1px solid var(--color-border)' }}>
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
        </CollapsibleSection>
      )}
    </div>
  );

  if (inline) return (
    <div>
      {body}
      {confirmState && <ConfirmModal {...confirmState} onCancel={() => setConfirmState(null)} />}
      <Toast message={toast.msg} visible={toast.show} />
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
      <Toast message={toast.msg} visible={toast.show} />
    </div>
  );
}
