import { useState, useEffect, useRef } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPencil, faTrash, faPlus, faXmark, faChevronRight, faReceipt, faWallet } from '@fortawesome/free-solid-svg-icons';
import { api } from '../../services/api';
import ConfirmModal from '../ConfirmModal';
import CollapsibleSection from '../ui/CollapsibleSection';
import Toast from '../ui/Toast';

function formatValue(v) {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v) + ' €';
}

function ClassificationPills({ value, onChange }) {
  const options = [
    { value: 'must', label: 'Must', bg: '#fef3c7', color: '#92400e', border: '#f59e0b' },
    { value: 'want', label: 'Want', bg: '#dbeafe', color: '#1e40af', border: '#3b82f6' },
  ];
  return (
    <div style={{ display: 'flex', gap: '0.25rem' }}>
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(active ? null : opt.value)}
            style={{
              fontSize: '0.7rem',
              padding: '0.15rem 0.5rem',
              borderRadius: '999px',
              border: active ? `1px solid ${opt.border}` : '1px solid var(--color-border)',
              background: active ? opt.bg : 'transparent',
              color: active ? opt.color : 'var(--color-text-muted)',
              cursor: 'pointer',
              fontWeight: active ? 600 : 400,
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function sortTemplateExpenses(expenses, cycleStartDay) {
  const start = cycleStartDay ?? 25;
  const firstHalf = expenses
    .filter((e) => e.type === 'Fixed' && e.day_of_payment >= start)
    .sort((a, b) => a.day_of_payment - b.day_of_payment);
  const secondHalf = expenses
    .filter((e) => e.type === 'Fixed' && e.day_of_payment < start)
    .sort((a, b) => a.day_of_payment - b.day_of_payment);
  const budget = expenses.filter((e) => e.type === 'Budget');
  return [...firstHalf, ...secondHalf, ...budget];
}

export default function ExpenseTemplate({ dossierId }) {
  const [items, setItems] = useState([]);
  const [cycleStartDay, setCycleStartDay] = useState(25);
  const [paperlessActive, setPaperlessActive] = useState(false);
  const [activeSection, setActiveSection] = useState('expense'); // tracks which modal to open
  const [expenseCollapsed, setExpenseCollapsed] = useState(false);
  const [distCollapsed, setDistCollapsed] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [error, setError] = useState('');
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [confirmState, setConfirmState] = useState(null);
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
    load();
  }, [dossierId]);

  async function load() {
    try {
      const [data, settings] = await Promise.all([
        api.getExpenseTemplate(dossierId),
        api.getDossierSettings(dossierId),
      ]);
      setItems(data);
      setCycleStartDay(settings.cycle_start_day ?? 25);
      setPaperlessActive(
        !!(settings.paperless_url && settings.paperless_token_set && settings.paperless_date_field_id && settings.paperless_amount_field_id)
      );
    } catch (err) {
      setError(err.message);
    }
  }

  function handleDelete(item) {
    setConfirmState({
      title: 'Delete template item',
      message: `Delete "${item.name}" from the template?`,
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: async () => {
        try {
          await api.deleteTemplateItem(dossierId, item.id);
          setItems((prev) => prev.filter((i) => i.id !== item.id));
          showToast('Item deleted');
        } catch (err) {
          setError(err.message);
        }
      },
    });
  }

  async function handleClassificationChange(item, classification) {
    try {
      const updated = await api.updateTemplateItem(dossierId, item.id, { classification: classification || null });
      setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)));
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDecompositionChange(item, field, rawVal) {
    const val = rawVal === '' ? null : Number(rawVal);
    try {
      const updated = await api.updateTemplateItem(dossierId, item.id, { [field]: val });
      setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)));
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSaveItem(data, itemId) {
    try {
      if (itemId) {
        const updated = await api.updateTemplateItem(dossierId, itemId, data);
        setItems((prev) => prev.map((i) => (i.id === itemId ? updated : i)));
        showToast('Item updated');
      } else {
        const created = await api.createTemplateItem(dossierId, { ...data, section: activeSection });
        setItems((prev) => [...prev, created]);
        showToast('Item added');
      }
      setShowAddModal(false);
      setEditingItem(null);
    } catch (err) {
      throw err;
    }
  }

  const expenseItems = sortTemplateExpenses(items.filter((i) => i.section === 'expense'), cycleStartDay);
  const distItems = items.filter((i) => i.section === 'distribution');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {error && <div className="alert alert-error">{error}</div>}

      <CollapsibleSection
        title="Expenses"
        icon={faReceipt}
        accent="var(--color-brand)"
        count={expenseItems.length}
        collapsed={expenseCollapsed}
        onToggle={() => setExpenseCollapsed((v) => !v)}
        noPad
      >
        {expenseItems.length === 0 ? (
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', padding: '12px 16px 0' }}>
            No expenses in template yet.
          </p>
        ) : (
          <div className="mobile-cards table-container" style={{ borderRadius: 0, border: 'none', borderTop: '1px solid var(--color-border)', marginTop: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ color: 'var(--color-text-muted)', textAlign: 'left' }}>
                  <th style={{ padding: '0.3rem 0.5rem', fontWeight: 500 }}>Name</th>
                  <th style={{ padding: '0.3rem 0.5rem', fontWeight: 500 }}>Type</th>
                  <th style={{ padding: '0.3rem 0.5rem', fontWeight: 500, textAlign: 'right' }}>Value / Max</th>
                  <th style={{ padding: '0.3rem 0.5rem', fontWeight: 500 }}>Day</th>
                  <th style={{ padding: '0.3rem 0.5rem', fontWeight: 500 }}>Classification</th>
                  {paperlessActive && <th style={{ padding: '0.3rem 0.5rem', fontWeight: 500 }}>Paperless Tag ID</th>}
                  <th style={{ padding: '0.3rem 0.5rem', fontWeight: 500 }}></th>
                </tr>
              </thead>
              <tbody>
                {expenseItems.map((item) => (
                  <tr key={item.id} style={{ borderTop: '1px solid var(--color-border)' }} className={expandedRows.has(item.id) ? 'mobile-expanded' : ''}>
                    <td className="mobile-card-title" style={{ padding: '0.4rem 0.5rem' }} onClick={() => toggleRow(item.id)}>
                      <span>{item.name}</span>
                      <span className="mobile-card-inline-value">{formatValue(item.value)}</span>
                      <button className="card-expand-btn" tabIndex={-1}><FontAwesomeIcon icon={faChevronRight} /></button>
                    </td>
                    <td data-label="Value" className="mobile-summary-in-title" style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>{formatValue(item.value)}</td>
                    <td data-label="Type" className="mobile-detail" style={{ padding: '0.4rem 0.5rem', color: 'var(--color-text-muted)' }}>{item.type}</td>
                    <td data-label="Day" className="mobile-detail" style={{ padding: '0.4rem 0.5rem', color: 'var(--color-text-muted)' }}>
                      {item.type === 'Fixed' ? item.day_of_payment : '—'}
                    </td>
                    <td data-label="Class" className="mobile-detail" style={{ padding: '0.3rem 0.5rem' }}>
                      <ClassificationPills
                        value={item.classification}
                        onChange={(v) => handleClassificationChange(item, v)}
                      />
                    </td>
                    {paperlessActive && (
                      <td data-label="Paperless Tag ID" className="mobile-detail" style={{ padding: '0.4rem 0.5rem', color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>
                        {item.type === 'Fixed' ? (item.paperless_tag_id != null ? item.paperless_tag_id : '—') : ''}
                      </td>
                    )}
                    <td data-label="" className="mobile-detail" style={{ padding: '0.4rem 0.5rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        className="btn-secondary"
                        onClick={() => { setActiveSection('expense'); setEditingItem(item); setShowAddModal(true); }}
                        style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', marginRight: '0.25rem' }}
                      >
                        <FontAwesomeIcon icon={faPencil} style={{ marginRight: '0.35rem' }} />Edit
                      </button>
                      <button
                        className="btn-danger"
                        onClick={() => handleDelete(item)}
                        style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                      >
                        <FontAwesomeIcon icon={faTrash} style={{ marginRight: '0.35rem' }} />Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ padding: '10px 16px 14px' }}>
          <button
            className="btn-primary"
            onClick={() => { setActiveSection('expense'); setEditingItem(null); setShowAddModal(true); }}
            style={{ fontSize: '0.875rem' }}
          >
            <FontAwesomeIcon icon={faPlus} style={{ marginRight: '0.4rem' }} />Add expense
          </button>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Distributions"
        icon={faWallet}
        accent="var(--color-brand)"
        count={distItems.length}
        collapsed={distCollapsed}
        onToggle={() => setDistCollapsed((v) => !v)}
        noPad
      >
        {distItems.length === 0 ? (
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', padding: '12px 16px 0' }}>
            No distributions in template yet.
          </p>
        ) : (
          <div className="mobile-cards table-container" style={{ borderRadius: 0, border: 'none', borderTop: '1px solid var(--color-border)', marginTop: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ color: 'var(--color-text-muted)', textAlign: 'left' }}>
                  <th style={{ padding: '0.3rem 0.5rem', fontWeight: 500 }}>Name</th>
                  <th style={{ padding: '0.3rem 0.5rem', fontWeight: 500, textAlign: 'right' }}>Value</th>
                  <th style={{ padding: '0.3rem 0.5rem', fontWeight: 500, textAlign: 'right' }}>Must</th>
                  <th style={{ padding: '0.3rem 0.5rem', fontWeight: 500, textAlign: 'right' }}>Want</th>
                  <th style={{ padding: '0.3rem 0.5rem', fontWeight: 500, textAlign: 'right' }}>Save</th>
                  <th style={{ padding: '0.3rem 0.5rem', fontWeight: 500 }}></th>
                </tr>
              </thead>
              <tbody>
                {distItems.map((item) => {
                  const sumDecomp = (item.must_amount || 0) + (item.want_amount || 0) + (item.save_amount || 0);
                  const anySet = item.must_amount != null || item.want_amount != null || item.save_amount != null;
                  const mismatch = anySet && Math.abs(sumDecomp - item.value) > 0.005;
                  return (
                    <tr key={item.id} style={{ borderTop: '1px solid var(--color-border)' }} className={expandedRows.has(item.id) ? 'mobile-expanded' : ''}>
                      <td className="mobile-card-title" style={{ padding: '0.4rem 0.5rem' }} onClick={() => toggleRow(item.id)}>
                        <span>{item.name}</span>
                        <span className="mobile-card-inline-value">{formatValue(item.value)}</span>
                        <button className="card-expand-btn" tabIndex={-1}><FontAwesomeIcon icon={faChevronRight} /></button>
                      </td>
                      <td data-label="Value" className="mobile-summary-in-title" style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>{formatValue(item.value)}</td>
                      {['must_amount', 'want_amount', 'save_amount'].map((field, fi) => (
                        <td key={field} data-label={['Must', 'Want', 'Save'][fi]} className="mobile-detail" style={{ padding: '0.3rem 0.4rem', textAlign: 'right' }}>
                          <input
                            type="number" inputMode="decimal"
                            min={0}
                            step="0.01"
                            value={item[field] ?? ''}
                            onChange={(e) => handleDecompositionChange(item, field, e.target.value)}
                            placeholder="—"
                            style={{
                              width: '5.5rem',
                              textAlign: 'right',
                              fontSize: '0.8rem',
                              border: mismatch ? '1px solid var(--color-danger)' : '1px solid var(--color-border)',
                            }}
                          />
                        </td>
                      ))}
                      <td data-label="" className="mobile-detail" style={{ padding: '0.4rem 0.5rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {mismatch && (
                          <span style={{ fontSize: '0.7rem', color: 'var(--color-danger)', marginRight: '0.4rem' }}>
                            sum ≠ {formatValue(item.value)}
                          </span>
                        )}
                        <button
                          className="btn-secondary"
                          onClick={() => { setActiveSection('distribution'); setEditingItem(item); setShowAddModal(true); }}
                          style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', marginRight: '0.25rem' }}
                        >
                          <FontAwesomeIcon icon={faPencil} style={{ marginRight: '0.35rem' }} />Edit
                        </button>
                        <button
                          className="btn-danger"
                          onClick={() => handleDelete(item)}
                          style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                        >
                          <FontAwesomeIcon icon={faTrash} style={{ marginRight: '0.35rem' }} />Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ padding: '10px 16px 14px' }}>
          <button
            className="btn-primary"
            onClick={() => { setActiveSection('distribution'); setEditingItem(null); setShowAddModal(true); }}
            style={{ fontSize: '0.875rem' }}
          >
            <FontAwesomeIcon icon={faPlus} style={{ marginRight: '0.4rem' }} />Add distribution
          </button>
        </div>
      </CollapsibleSection>

      {showAddModal && (
        <TemplateItemModal
          section={activeSection}
          item={editingItem}
          paperlessActive={paperlessActive}
          onSave={handleSaveItem}
          onClose={() => { setShowAddModal(false); setEditingItem(null); }}
        />
      )}
      {confirmState && <ConfirmModal {...confirmState} onCancel={() => setConfirmState(null)} />}
      <Toast message={toast.msg} visible={toast.show} />
    </div>
  );
}

function TemplateItemModal({ section, item, paperlessActive, onSave, onClose }) {
  const [name, setName] = useState(item?.name ?? '');
  const [type, setType] = useState(item?.type ?? 'Fixed');
  const [value, setValue] = useState(item?.value != null ? String(item.value) : '');
  const [dayOfPayment, setDayOfPayment] = useState(item?.day_of_payment != null ? String(item.day_of_payment) : '');
  const [paperlessTagId, setPaperlessTagId] = useState(item?.paperless_tag_id != null ? String(item.paperless_tag_id) : '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const isFixed = section === 'expense' && (item ? item.type === 'Fixed' : type === 'Fixed');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!name.trim()) { setError('Name is required'); return; }
    const numValue = Number(value);
    if (isNaN(numValue) || numValue < 0) { setError('Value must be a non-negative number'); return; }
    if (section === 'expense' && type === 'Fixed') {
      const day = Number(dayOfPayment);
      if (!Number.isInteger(day) || day < 1 || day > 31) { setError('Day of payment must be 1–31'); return; }
    }
    setSaving(true);
    try {
      const data = { name: name.trim(), value: numValue };
      if (section === 'expense') {
        data.type = type;
        if (type === 'Fixed') data.day_of_payment = Number(dayOfPayment);
        if (isFixed && paperlessActive) {
          data.paperless_tag_id = paperlessTagId.trim() !== '' ? Number(paperlessTagId) : null;
        }
      }
      await onSave(data, item?.id);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{item ? 'Edit' : 'Add'} {section === 'expense' ? 'Expense' : 'Distribution'}</h2>
          <button className="close-btn" onClick={onClose}><FontAwesomeIcon icon={faXmark} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="alert alert-error">{error}</div>}
            <div className="form-group">
              <label>Name</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rent" />
            </div>
            {section === 'expense' && !item && (
              <div className="form-group">
                <label>Type</label>
                <select value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="Fixed">Fixed</option>
                  <option value="Budget">Budget</option>
                </select>
              </div>
            )}
            <div className="form-group">
              <label>{section === 'expense' && type === 'Budget' ? 'Maximum amount (€)' : 'Value (€)'}</label>
              <input type="number" inputMode="decimal" min={0} step="0.01" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0.00" />
            </div>
            {isFixed && (
              <div className="form-group">
                <label>Day of payment (1–31)</label>
                <input type="number" inputMode="numeric" min={1} max={31} value={dayOfPayment} onChange={(e) => setDayOfPayment(e.target.value)} placeholder="e.g. 5" />
              </div>
            )}
            {isFixed && paperlessActive && (
              <div className="form-group">
                <label>Paperless Tag ID</label>
                <input type="number" inputMode="numeric" min={1} value={paperlessTagId} onChange={(e) => setPaperlessTagId(e.target.value)} placeholder="e.g. 15" />
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
