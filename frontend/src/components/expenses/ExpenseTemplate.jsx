import { useState, useEffect } from 'react';
import { api } from '../../services/api';

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
  const [activeTab, setActiveTab] = useState('expense');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [error, setError] = useState('');

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
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(item) {
    if (!confirm(`Delete "${item.name}" from the template?`)) return;
    try {
      await api.deleteTemplateItem(dossierId, item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
    } catch (err) {
      setError(err.message);
    }
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
      } else {
        const created = await api.createTemplateItem(dossierId, { ...data, section: activeTab });
        setItems((prev) => [...prev, created]);
      }
      setShowAddModal(false);
      setEditingItem(null);
    } catch (err) {
      throw err;
    }
  }

  const rawTabItems = items.filter((i) => i.section === activeTab);
  const tabItems = activeTab === 'expense'
    ? sortTemplateExpenses(rawTabItems, cycleStartDay)
    : rawTabItems;

  return (
    <div>
      {error && <div className="alert alert-error" style={{ marginBottom: '0.75rem' }}>{error}</div>}

      <div className="tabs" style={{ marginBottom: 'var(--space-4)' }}>
        {['expense', 'distribution'].map((tab) => (
          <button
            key={tab}
            className={`tab-btn${activeTab === tab ? ' active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'expense' ? 'Expenses' : 'Distributions'}
          </button>
        ))}
      </div>

      {tabItems.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', marginBottom: '0.75rem' }}>
          No {activeTab === 'expense' ? 'expenses' : 'distributions'} in template yet.
        </p>
      ) : activeTab === 'expense' ? (
        <div className="table-container" style={{ marginBottom: '0.75rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ color: 'var(--color-text-muted)', textAlign: 'left' }}>
                <th style={{ padding: '0.3rem 0.5rem', fontWeight: 500 }}>Name</th>
                <th style={{ padding: '0.3rem 0.5rem', fontWeight: 500 }}>Type</th>
                <th style={{ padding: '0.3rem 0.5rem', fontWeight: 500, textAlign: 'right' }}>Value / Max</th>
                <th style={{ padding: '0.3rem 0.5rem', fontWeight: 500 }}>Day</th>
                <th style={{ padding: '0.3rem 0.5rem', fontWeight: 500 }}>Classification</th>
                <th style={{ padding: '0.3rem 0.5rem', fontWeight: 500 }}></th>
              </tr>
            </thead>
            <tbody>
              {tabItems.map((item) => (
                <tr key={item.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '0.4rem 0.5rem' }}>{item.name}</td>
                  <td style={{ padding: '0.4rem 0.5rem', color: 'var(--color-text-muted)' }}>{item.type}</td>
                  <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>{formatValue(item.value)}</td>
                  <td style={{ padding: '0.4rem 0.5rem', color: 'var(--color-text-muted)' }}>
                    {item.type === 'Fixed' ? item.day_of_payment : '—'}
                  </td>
                  <td style={{ padding: '0.3rem 0.5rem' }}>
                    <ClassificationPills
                      value={item.classification}
                      onChange={(v) => handleClassificationChange(item, v)}
                    />
                  </td>
                  <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button
                      className="btn-secondary"
                      onClick={() => { setEditingItem(item); setShowAddModal(true); }}
                      style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', marginRight: '0.25rem' }}
                    >
                      Edit
                    </button>
                    <button
                      className="btn-danger"
                      onClick={() => handleDelete(item)}
                      style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="table-container" style={{ marginBottom: '0.75rem' }}>
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
              {tabItems.map((item) => {
                const sumDecomp = (item.must_amount || 0) + (item.want_amount || 0) + (item.save_amount || 0);
                const anySet = item.must_amount != null || item.want_amount != null || item.save_amount != null;
                const mismatch = anySet && Math.abs(sumDecomp - item.value) > 0.005;
                return (
                  <tr key={item.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                    <td style={{ padding: '0.4rem 0.5rem' }}>{item.name}</td>
                    <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>{formatValue(item.value)}</td>
                    {['must_amount', 'want_amount', 'save_amount'].map((field) => (
                      <td key={field} style={{ padding: '0.3rem 0.4rem', textAlign: 'right' }}>
                        <input
                          type="number"
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
                    <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {mismatch && (
                        <span style={{ fontSize: '0.7rem', color: 'var(--color-danger)', marginRight: '0.4rem' }}>
                          sum ≠ {formatValue(item.value)}
                        </span>
                      )}
                      <button
                        className="btn-secondary"
                        onClick={() => { setEditingItem(item); setShowAddModal(true); }}
                        style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', marginRight: '0.25rem' }}
                      >
                        Edit
                      </button>
                      <button
                        className="btn-danger"
                        onClick={() => handleDelete(item)}
                        style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <button
        className="btn-primary"
        onClick={() => { setEditingItem(null); setShowAddModal(true); }}
        style={{ fontSize: '0.875rem' }}
      >
        + Add {activeTab === 'expense' ? 'expense' : 'distribution'}
      </button>

      {showAddModal && (
        <TemplateItemModal
          section={activeTab}
          item={editingItem}
          onSave={handleSaveItem}
          onClose={() => { setShowAddModal(false); setEditingItem(null); }}
        />
      )}
    </div>
  );
}

function TemplateItemModal({ section, item, onSave, onClose }) {
  const [name, setName] = useState(item?.name ?? '');
  const [type, setType] = useState(item?.type ?? 'Fixed');
  const [value, setValue] = useState(item?.value != null ? String(item.value) : '');
  const [dayOfPayment, setDayOfPayment] = useState(item?.day_of_payment != null ? String(item.day_of_payment) : '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

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
          <button className="close-btn" onClick={onClose}>&times;</button>
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
              <input type="number" min={0} step="0.01" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0.00" />
            </div>
            {section === 'expense' && (item ? item.type === 'Fixed' : type === 'Fixed') && (
              <div className="form-group">
                <label>Day of payment (1–31)</label>
                <input type="number" min={1} max={31} value={dayOfPayment} onChange={(e) => setDayOfPayment(e.target.value)} placeholder="e.g. 5" />
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
