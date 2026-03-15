import { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPencil, faTrash, faPlus, faXmark } from '@fortawesome/free-solid-svg-icons';
import { api } from '../../services/api';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

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

export default function AnnualExpenseTemplate({ dossierId }) {
  const [items, setItems] = useState([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [error, setError] = useState('');
  const [expandedRows, setExpandedRows] = useState(new Set());

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
      const data = await api.getAnnualExpenseTemplate(dossierId);
      setItems(data);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(item) {
    if (!confirm(`Delete "${item.name}" from the annual template?`)) return;
    try {
      await api.deleteAnnualTemplateItem(dossierId, item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSaveItem(data, itemId) {
    try {
      if (itemId) {
        const updated = await api.updateAnnualTemplateItem(dossierId, itemId, data);
        setItems((prev) => prev.map((i) => (i.id === itemId ? updated : i)));
      } else {
        const created = await api.createAnnualTemplateItem(dossierId, data);
        setItems((prev) => [...prev, created]);
      }
      setShowAddModal(false);
      setEditingItem(null);
    } catch (err) {
      throw err;
    }
  }

  async function handleClassificationChange(item, classification) {
    try {
      const updated = await api.updateAnnualTemplateItem(dossierId, item.id, {
        classification: classification || null,
      });
      setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      {error && <div className="alert alert-error" style={{ marginBottom: '0.75rem' }}>{error}</div>}

      {items.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', marginBottom: '0.75rem' }}>
          No annual expenses in template yet.
        </p>
      ) : (
        <div className="mobile-cards table-container" style={{ marginBottom: '0.75rem' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ color: 'var(--color-text-muted)', textAlign: 'left' }}>
              <th style={{ padding: '0.3rem 0.5rem', fontWeight: 500 }}>Name</th>
              <th style={{ padding: '0.3rem 0.5rem', fontWeight: 500, textAlign: 'right' }}>Annual value</th>
              <th style={{ padding: '0.3rem 0.5rem', fontWeight: 500, textAlign: 'right' }}>Monthly avg</th>
              <th style={{ padding: '0.3rem 0.5rem', fontWeight: 500 }}>Payment</th>
              <th style={{ padding: '0.3rem 0.5rem', fontWeight: 500 }}>Classification</th>
              <th style={{ padding: '0.3rem 0.5rem', fontWeight: 500 }}></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} style={{ borderTop: '1px solid var(--color-border)' }} className={expandedRows.has(item.id) ? 'mobile-expanded' : ''}>
                <td className="mobile-card-title" style={{ padding: '0.4rem 0.5rem' }} onClick={() => toggleRow(item.id)}>
                  <span>{item.name}</span>
                  <span className="mobile-card-inline-value">{formatValue(item.value)}</span>
                  <button className="card-expand-btn" tabIndex={-1}>›</button>
                </td>
                <td data-label="Annual" className="mobile-summary-in-title" style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>{formatValue(item.value)}</td>
                <td data-label="Monthly" className="mobile-detail" style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: 'var(--color-text-muted)' }}>
                  {formatValue(item.value / 12)}
                </td>
                <td data-label="Payment" className="mobile-detail" style={{ padding: '0.4rem 0.5rem', color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>
                  {item.day_of_payment && item.month_of_payment
                    ? `${item.day_of_payment} ${MONTHS[item.month_of_payment - 1]}`
                    : '—'}
                </td>
                <td data-label="Class" className="mobile-detail" style={{ padding: '0.3rem 0.5rem' }}>
                  <ClassificationPills
                    value={item.classification}
                    onChange={(v) => handleClassificationChange(item, v)}
                  />
                </td>
                <td data-label="" className="mobile-detail" style={{ padding: '0.4rem 0.5rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button
                    className="btn-secondary"
                    onClick={() => { setEditingItem(item); setShowAddModal(true); }}
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

      <button
        className="btn-primary"
        onClick={() => { setEditingItem(null); setShowAddModal(true); }}
        style={{ fontSize: '0.875rem' }}
      >
        <FontAwesomeIcon icon={faPlus} style={{ marginRight: '0.4rem' }} />Add annual expense
      </button>

      {showAddModal && (
        <AnnualTemplateItemModal
          item={editingItem}
          onSave={handleSaveItem}
          onClose={() => { setShowAddModal(false); setEditingItem(null); }}
        />
      )}
    </div>
  );
}

function AnnualTemplateItemModal({ item, onSave, onClose }) {
  const [name, setName] = useState(item?.name ?? '');
  const [value, setValue] = useState(item?.value != null ? String(item.value) : '');
  const [day, setDay] = useState(item?.day_of_payment != null ? String(item.day_of_payment) : '');
  const [month, setMonth] = useState(item?.month_of_payment != null ? String(item.month_of_payment) : '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!name.trim()) { setError('Name is required'); return; }
    const numValue = Number(value);
    if (isNaN(numValue) || numValue < 0) { setError('Value must be a non-negative number'); return; }
    const numDay = day ? Number(day) : null;
    const numMonth = month ? Number(month) : null;
    if (numDay !== null && (!Number.isInteger(numDay) || numDay < 1 || numDay > 31)) {
      setError('Day must be 1–31');
      return;
    }
    if (numMonth !== null && (!Number.isInteger(numMonth) || numMonth < 1 || numMonth > 12)) {
      setError('Month must be 1–12');
      return;
    }
    setSaving(true);
    try {
      await onSave(
        {
          name: name.trim(),
          value: numValue,
          day_of_payment: numDay,
          month_of_payment: numMonth,
        },
        item?.id
      );
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{item ? 'Edit' : 'Add'} Annual Expense</h2>
          <button className="close-btn" onClick={onClose}><FontAwesomeIcon icon={faXmark} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="alert alert-error">{error}</div>}
            <div className="form-group">
              <label>Name</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Car insurance" />
            </div>
            <div className="form-group">
              <label>Annual value (€)</label>
              <input type="number" min={0} step="0.01" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0.00" />
            </div>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Day of payment (optional)</label>
                <input type="number" min={1} max={31} value={day} onChange={(e) => setDay(e.target.value)} placeholder="e.g. 15" />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Month of payment (optional)</label>
                <select value={month} onChange={(e) => setMonth(e.target.value)}>
                  <option value="">—</option>
                  {MONTHS.map((m, i) => (
                    <option key={i + 1} value={i + 1}>{m}</option>
                  ))}
                </select>
              </div>
            </div>
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
