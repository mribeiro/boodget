import { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPencil, faTrash, faPlus, faXmark, faChevronDown, faChevronRight } from '@fortawesome/free-solid-svg-icons';
import { api } from '../../services/api';
import ConfirmModal from '../ConfirmModal';

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
  const [confirmState, setConfirmState] = useState(null);

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

  function handleDelete(item) {
    setConfirmState({
      title: 'Delete template item',
      message: `Delete "${item.name}" from the annual template?`,
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: async () => {
        try {
          await api.deleteAnnualTemplateItem(dossierId, item.id);
          setItems((prev) => prev.filter((i) => i.id !== item.id));
        } catch (err) {
          setError(err.message);
        }
      },
    });
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
        <div style={{ marginBottom: '0.75rem' }}>
          {items.map((item) => {
            const expanded = expandedRows.has(item.id);
            const numInst = item.num_installments ?? 1;
            return (
              <div key={item.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.5rem 0', cursor: 'pointer' }} onClick={() => toggleRow(item.id)}>
                  <FontAwesomeIcon icon={expanded ? faChevronDown : faChevronRight} style={{ fontSize: 11, color: 'var(--color-text-muted)', width: 14 }} />
                  <span style={{ flex: 1, fontSize: '0.875rem', fontWeight: 500 }}>{item.name}</span>
                  <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', minWidth: 90, textAlign: 'right' }}>{formatValue(item.value)}</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', minWidth: 60, textAlign: 'center' }}>{numInst} installment{numInst !== 1 ? 's' : ''}</span>
                  <div onClick={(e) => e.stopPropagation()}>
                    <ClassificationPills value={item.classification} onChange={(v) => handleClassificationChange(item, v)} />
                  </div>
                  <div style={{ display: 'flex', gap: 4 }} onClick={(e) => e.stopPropagation()}>
                    <button className="btn-secondary" onClick={() => { setEditingItem(item); setShowAddModal(true); }} style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}>
                      <FontAwesomeIcon icon={faPencil} style={{ marginRight: '0.3rem' }} />Edit
                    </button>
                    <button className="btn-danger" onClick={() => handleDelete(item)} style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}>
                      <FontAwesomeIcon icon={faTrash} style={{ marginRight: '0.3rem' }} />Delete
                    </button>
                  </div>
                </div>
                {expanded && (
                  <div style={{ marginLeft: 22, paddingBottom: 8 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                      <thead>
                        <tr style={{ color: 'var(--color-text-muted)' }}>
                          <th style={{ textAlign: 'left', fontWeight: 500, padding: '2px 6px' }}>#</th>
                          <th style={{ textAlign: 'left', fontWeight: 500, padding: '2px 6px' }}>Date</th>
                          <th style={{ textAlign: 'right', fontWeight: 500, padding: '2px 6px' }}>Expected</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(item.installments || []).map((inst) => (
                          <tr key={inst.installment_number}>
                            <td style={{ padding: '2px 6px', color: 'var(--color-text-muted)' }}>{inst.installment_number}/{numInst}</td>
                            <td style={{ padding: '2px 6px' }}>{MONTHS[inst.month - 1]} {inst.day}</td>
                            <td style={{ padding: '2px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatValue(item.value / numInst)}</td>
                          </tr>
                        ))}
                        {(item.installments || []).length === 0 && (
                          <tr><td colSpan={3} style={{ padding: '4px 6px', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>No installments defined — edit to add dates.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
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
      {confirmState && <ConfirmModal {...confirmState} onCancel={() => setConfirmState(null)} />}
    </div>
  );
}

function AnnualTemplateItemModal({ item, onSave, onClose }) {
  const numInstDefault = item?.num_installments ?? 1;
  const [name, setName] = useState(item?.name ?? '');
  const [value, setValue] = useState(item?.value != null ? String(item.value) : '');
  const [numInst, setNumInst] = useState(numInstDefault);
  const [installments, setInstallments] = useState(() => {
    if (item?.installments?.length) {
      return item.installments.map((i) => ({ installment_number: i.installment_number, month: i.month, day: i.day }));
    }
    // Fallback: use legacy day_of_payment/month_of_payment
    if (item?.day_of_payment && item?.month_of_payment) {
      return [{ installment_number: 1, month: item.month_of_payment, day: item.day_of_payment }];
    }
    return [{ installment_number: 1, month: 1, day: 1 }];
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function handleNumInstChange(n) {
    const newNum = Math.max(1, Number(n));
    setNumInst(newNum);
    setInstallments((prev) => {
      const updated = [...prev];
      while (updated.length < newNum) {
        updated.push({ installment_number: updated.length + 1, month: 1, day: 1 });
      }
      return updated.slice(0, newNum).map((inst, idx) => ({ ...inst, installment_number: idx + 1 }));
    });
  }

  function setInstField(idx, field, val) {
    setInstallments((prev) => prev.map((inst, i) => i === idx ? { ...inst, [field]: Number(val) } : inst));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!name.trim()) { setError('Name is required'); return; }
    const numValue = Number(value);
    if (isNaN(numValue) || numValue < 0) { setError('Value must be a non-negative number'); return; }

    setSaving(true);
    try {
      await onSave(
        {
          name: name.trim(),
          value: numValue,
          num_installments: numInst,
          installments,
          // Also send legacy fields from first installment for backward compat
          day_of_payment: installments[0]?.day ?? null,
          month_of_payment: installments[0]?.month ?? null,
        },
        item?.id
      );
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  const expectedPerInst = numInst > 0 && value ? formatValue(parseFloat(value) / numInst) : '—';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{item ? 'Edit' : 'Add'} Annual Expense</h2>
          <button className="close-btn" onClick={onClose}><FontAwesomeIcon icon={faXmark} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}
            <div className="form-group">
              <label>Name</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Car insurance" />
            </div>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Annual value (€)</label>
                <input type="number" min={0} step="0.01" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0.00" />
              </div>
              <div className="form-group" style={{ flex: 0, minWidth: 120 }}>
                <label>Installments</label>
                <input type="number" value={numInst} onChange={(e) => handleNumInstChange(e.target.value)} min="1" max="12" />
              </div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 12 }}>
              Expected per installment: <strong>{expectedPerInst}</strong>
            </div>
            {installments.map((inst, idx) => (
              <div key={idx} style={{ display: 'grid', gridTemplateColumns: '40px 1fr 1fr', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)', textAlign: 'center' }}>#{idx + 1}</span>
                <div className="form-group" style={{ margin: 0 }}>
                  <select value={inst.month} onChange={(e) => setInstField(idx, 'month', e.target.value)}>
                    {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                  </select>
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <input type="number" value={inst.day} onChange={(e) => setInstField(idx, 'day', e.target.value)} placeholder="Day" min="1" max="31" />
                </div>
              </div>
            ))}
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
