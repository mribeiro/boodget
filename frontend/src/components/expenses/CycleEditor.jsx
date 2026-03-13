import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../../services/api';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function cycleLabel(year, month) {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

function fmt(v) {
  if (v == null) return '—';
  const formatted = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
  return formatted + ' €';
}

function cycleDateRange(year, month, startDay) {
  const start = new Date(year, month - 1, startDay);
  const end = new Date(year, month, startDay - 1);
  const fmtDate = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${fmtDate(start)} – ${fmtDate(end)}`;
}

function sortExpenses(expenses, cycleStartDay) {
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

export default function CycleEditor() {
  const { id: dossierId, cycleId } = useParams();
  const navigate = useNavigate();

  const [cycle, setCycle] = useState(null);
  const [activeTab, setActiveTab] = useState('expenses');
  const [error, setError] = useState('');

  const [editingInfo, setEditingInfo] = useState(false);
  const [infoSalary, setInfoSalary] = useState('');
  const [infoPrevBalance, setInfoPrevBalance] = useState('');
  const [savingInfo, setSavingInfo] = useState(false);

  const [showCloseForm, setShowCloseForm] = useState(false);
  const [finalBalance, setFinalBalance] = useState('');
  const [savingClose, setSavingClose] = useState(false);

  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
    load();
  }, [cycleId]);

  async function load() {
    try {
      const data = await api.getCycle(dossierId, cycleId);
      setCycle(data);
      setInfoSalary(String(data.salary));
      setInfoPrevBalance(String(data.previous_balance));
      if (data.final_real_balance != null) setFinalBalance(String(data.final_real_balance));
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSaveInfo() {
    setError('');
    setSavingInfo(true);
    try {
      await api.updateCycle(dossierId, cycleId, {
        salary: Number(infoSalary),
        previous_balance: Number(infoPrevBalance),
      });
      await load();
      setEditingInfo(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingInfo(false);
    }
  }

  async function handleClose() {
    setError('');
    const bal = Number(finalBalance);
    if (isNaN(bal)) { setError('Final balance must be a number'); return; }
    setSavingClose(true);
    try {
      await api.updateCycle(dossierId, cycleId, {
        is_closed: true,
        final_real_balance: bal,
      });
      await load();
      setShowCloseForm(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingClose(false);
    }
  }

  async function handleReopen() {
    setError('');
    try {
      await api.updateCycle(dossierId, cycleId, { is_closed: false });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleUpdateFinalBalance() {
    setError('');
    const bal = Number(finalBalance);
    if (isNaN(bal)) { setError('Final balance must be a number'); return; }
    try {
      await api.updateCycle(dossierId, cycleId, { final_real_balance: bal });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleTogglePaid(item) {
    try {
      const updated = await api.updateCycleItem(dossierId, cycleId, item.id, { paid: !item.paid });
      setCycle((prev) => ({
        ...prev,
        items: prev.items.map((i) => (i.id === updated.id ? updated : i)),
      }));
      // Refresh summary
      const fresh = await api.getCycle(dossierId, cycleId);
      setCycle(fresh);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleToggleDone(item) {
    try {
      const updated = await api.updateCycleItem(dossierId, cycleId, item.id, { done: !item.done });
      const fresh = await api.getCycle(dossierId, cycleId);
      setCycle(fresh);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleUpdateSpent(item, newSpent) {
    try {
      await api.updateCycleItem(dossierId, cycleId, item.id, { spent: Number(newSpent) });
      const fresh = await api.getCycle(dossierId, cycleId);
      setCycle(fresh);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeleteItem(item) {
    if (!confirm(`Delete "${item.name}"?`)) return;
    try {
      await api.deleteCycleItem(dossierId, cycleId, item.id);
      const fresh = await api.getCycle(dossierId, cycleId);
      setCycle(fresh);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleEditItem(item, data) {
    try {
      await api.updateCycleItem(dossierId, cycleId, item.id, data);
      const fresh = await api.getCycle(dossierId, cycleId);
      setCycle(fresh);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleAddItem(data) {
    try {
      await api.createCycleItem(dossierId, cycleId, { ...data, section: activeTab === 'expenses' ? 'expense' : 'distribution' });
      const fresh = await api.getCycle(dossierId, cycleId);
      setCycle(fresh);
      setShowAddModal(false);
    } catch (err) {
      throw err;
    }
  }

  if (!cycle) return <div className="loading">Loading…</div>;

  const expenses = sortExpenses(
    cycle.items.filter((i) => i.section === 'expense'),
    cycle.cycle_start_day
  );
  const distributions = cycle.items.filter((i) => i.section === 'distribution');
  const { summary } = cycle;
  const expectedCurrentBalance = summary.total_available - summary.total_expenses_paid - summary.total_distributions_done;

  return (
    <div>
      {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      <div className="page-header">
        <button className="btn-ghost" onClick={() => navigate(`/dossiers/${dossierId}`, { state: { tab: 'expenses' } })}>
          &larr; Back
        </button>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0 }}>{cycleLabel(cycle.year, cycle.month)} Cycle</h1>
          <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: '0.2rem' }}>
            {cycleDateRange(cycle.year, cycle.month, cycle.cycle_start_day ?? 25)}
          </div>
        </div>
      </div>

      {/* Cycle info */}
      <div className="card" style={{ padding: '1rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            {editingInfo ? (
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={{ fontSize: '0.8rem' }}>Salary received (€)</label>
                  <input type="number" step="0.01" value={infoSalary} onChange={(e) => setInfoSalary(e.target.value)} style={{ width: '8rem' }} />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={{ fontSize: '0.8rem' }}>Previous balance (€)</label>
                  <input type="number" step="0.01" value={infoPrevBalance} onChange={(e) => setInfoPrevBalance(e.target.value)} style={{ width: '8rem' }} />
                </div>
                <button className="btn-primary" onClick={handleSaveInfo} disabled={savingInfo} style={{ padding: '0.35rem 0.75rem' }}>
                  {savingInfo ? 'Saving…' : 'Save'}
                </button>
                <button className="btn-secondary" onClick={() => { setEditingInfo(false); setInfoSalary(String(cycle.salary)); setInfoPrevBalance(String(cycle.previous_balance)); }} style={{ padding: '0.35rem 0.75rem' }}>
                  Cancel
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Salary received</div>
                  <div style={{ fontWeight: 600 }}>{fmt(cycle.salary)}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Previous balance</div>
                  <div style={{ fontWeight: 600 }}>{fmt(cycle.previous_balance)}</div>
                </div>
                <div style={{ borderLeft: '1px solid var(--color-border)', paddingLeft: '2rem' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Total available</div>
                  <div style={{ fontWeight: 600 }}>{fmt(summary.total_available)}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Leftovers expected</div>
                  <div style={{ fontWeight: 600, color: summary.expected_balance < 0 ? 'var(--color-danger)' : 'inherit' }}>{fmt(summary.expected_balance)}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Expected current balance</div>
                  <div style={{ fontWeight: 600, color: expectedCurrentBalance < 0 ? 'var(--color-danger)' : 'inherit' }}>{fmt(expectedCurrentBalance)}</div>
                </div>
                <button className="btn-secondary" onClick={() => setEditingInfo(true)} style={{ padding: '0.25rem 0.6rem', fontSize: '0.8rem' }}>
                  Edit
                </button>
              </div>
            )}
          </div>

          <div>
            {cycle.is_closed ? (
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={{ fontSize: '0.8rem' }}>Final real balance (€)</label>
                  <input type="number" step="0.01" value={finalBalance} onChange={(e) => setFinalBalance(e.target.value)} style={{ width: '8rem' }} />
                </div>
                <button className="btn-secondary" onClick={handleUpdateFinalBalance} style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}>
                  Update
                </button>
                <button className="btn-secondary" onClick={handleReopen} style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}>
                  Reopen
                </button>
              </div>
            ) : showCloseForm ? (
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={{ fontSize: '0.8rem' }}>Final real balance (€)</label>
                  <input type="number" step="0.01" value={finalBalance} onChange={(e) => setFinalBalance(e.target.value)} style={{ width: '8rem' }} placeholder="0.00" />
                </div>
                <button className="btn-primary" onClick={handleClose} disabled={savingClose} style={{ padding: '0.35rem 0.75rem' }}>
                  {savingClose ? 'Closing…' : 'Confirm close'}
                </button>
                <button className="btn-secondary" onClick={() => setShowCloseForm(false)} style={{ padding: '0.35rem 0.75rem' }}>
                  Cancel
                </button>
              </div>
            ) : (
              <button className="btn-secondary" onClick={() => setShowCloseForm(true)} style={{ fontSize: '0.875rem' }}>
                Close cycle
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="card" style={{ padding: '1rem', marginBottom: '1.25rem', background: 'var(--color-surface)' }}>
        <h3 style={{ margin: '0 0 0.9rem 0', fontSize: '0.95rem' }}>Summary</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '9rem repeat(3, minmax(7rem, 1fr))', rowGap: '0.2rem', columnGap: '0.5rem', fontSize: '0.875rem' }}>
          {/* Expenses header */}
          <div />
          {['Total', 'Paid', 'Unpaid'].map((h) => (
            <div key={h} style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', paddingBottom: '0.1rem' }}>{h}</div>
          ))}
          {/* Expenses values */}
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', alignSelf: 'center' }}>Expenses</div>
          <div style={{ fontWeight: 500 }}>{fmt(summary.total_expenses)}</div>
          <div style={{ fontWeight: 500 }}>{fmt(summary.total_expenses_paid)}</div>
          <div style={{ fontWeight: 500, color: summary.total_expenses_unpaid > 0 ? 'var(--color-warning, #d97706)' : 'inherit' }}>{fmt(summary.total_expenses_unpaid)}</div>

          {/* Spacer */}
          <div style={{ gridColumn: '1 / -1', height: '0.6rem' }} />

          {/* Distributions header */}
          <div />
          {['Total', 'Done', 'Pending'].map((h) => (
            <div key={h} style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', paddingBottom: '0.1rem' }}>{h}</div>
          ))}
          {/* Distributions values */}
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', alignSelf: 'center' }}>Distributions</div>
          <div style={{ fontWeight: 500 }}>{fmt(summary.total_distributions)}</div>
          <div style={{ fontWeight: 500 }}>{fmt(summary.total_distributions_done)}</div>
          <div style={{ fontWeight: 500, color: summary.total_distributions_not_done > 0 ? 'var(--color-warning, #d97706)' : 'inherit' }}>{fmt(summary.total_distributions_not_done)}</div>

          {/* Closing row (only when closed) */}
          {!!cycle.is_closed && (
            <>
              <div style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--color-border)', margin: '0.5rem 0 0.4rem' }} />
              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', alignSelf: 'center' }}>Closing</div>
              <div>
                <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', paddingBottom: '0.1rem' }}>Final real balance</div>
                <div style={{ fontWeight: 600 }}>{fmt(summary.final_real_balance)}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', paddingBottom: '0.1rem' }}>Difference</div>
                <div style={{ fontWeight: 600, color: summary.balance_difference > 0 ? 'var(--color-success)' : summary.balance_difference < 0 ? 'var(--color-danger)' : 'inherit' }}>
                  {fmt(summary.balance_difference)}
                </div>
              </div>
              <div />
            </>
          )}
        </div>
      </div>

      {/* Items tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--color-border)', marginBottom: '1rem' }}>
        {[['expenses', 'Expenses'], ['distributions', 'Distributions']].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            style={{
              padding: '0.4rem 1rem',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === key ? '2px solid var(--color-primary)' : '2px solid transparent',
              color: activeTab === key ? 'var(--color-primary)' : 'var(--color-text-muted)',
              fontWeight: activeTab === key ? 600 : 400,
              cursor: 'pointer',
              fontSize: '0.875rem',
              marginBottom: '-1px',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'expenses' ? (
        <ExpensesList
          expenses={expenses}
          onTogglePaid={handleTogglePaid}
          onUpdateSpent={handleUpdateSpent}
          onDelete={handleDeleteItem}
          onEdit={handleEditItem}
        />
      ) : (
        <DistributionsList
          distributions={distributions}
          onToggleDone={handleToggleDone}
          onDelete={handleDeleteItem}
          onEdit={handleEditItem}
        />
      )}

      <button className="btn-primary" onClick={() => setShowAddModal(true)} style={{ marginTop: '0.75rem', fontSize: '0.875rem' }}>
        + Add {activeTab === 'expenses' ? 'expense' : 'distribution'}
      </button>

      {showAddModal && (
        <AddCycleItemModal
          section={activeTab === 'expenses' ? 'expense' : 'distribution'}
          onSave={handleAddItem}
          onClose={() => setShowAddModal(false)}
        />
      )}
    </div>
  );
}

function SummaryRow({ label, value, highlight, bold }) {
  const color =
    highlight === 'danger' ? 'var(--color-danger)'
    : highlight === 'warn' ? 'var(--color-warning, #d97706)'
    : highlight === 'success' ? 'var(--color-success)'
    : 'inherit';
  return (
    <div>
      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{label}</div>
      <div style={{ fontWeight: bold ? 600 : 400, color }}>{fmt(value)}</div>
    </div>
  );
}

function ExpensesList({ expenses, onTogglePaid, onUpdateSpent, onDelete, onEdit }) {
  const [spentDrafts, setSpentDrafts] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [editDay, setEditDay] = useState('');

  function startEdit(item) {
    setEditingId(item.id);
    setEditValue(String(item.value));
    setEditDay(item.day_of_payment != null ? String(item.day_of_payment) : '');
  }

  async function confirmEdit(item) {
    const data = { value: Number(editValue) };
    if (item.type === 'Fixed') data.day_of_payment = Number(editDay);
    await onEdit(item, data);
    setEditingId(null);
  }

  if (expenses.length === 0) {
    return <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>No expenses yet.</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      {expenses.map((item) => {
        const isEditing = editingId === item.id;
        return (
          <div
            key={item.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              padding: '0.6rem 0.75rem',
              background: 'var(--color-surface)',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--color-border)',
              flexWrap: 'wrap',
              opacity: !isEditing && item.type === 'Fixed' && item.paid ? 0.6 : 1,
            }}
          >
            {/* Paid toggle for Fixed */}
            {item.type === 'Fixed' && !isEditing && (
              <input
                type="checkbox"
                checked={!!item.paid}
                onChange={() => onTogglePaid(item)}
                title={item.paid ? 'Mark as unpaid' : 'Mark as paid'}
                style={{ cursor: 'pointer', width: '1rem', height: '1rem', flexShrink: 0 }}
              />
            )}

            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontWeight: 500, textDecoration: !isEditing && item.type === 'Fixed' && item.paid ? 'line-through' : 'none' }}>
                {item.name}
              </span>
              {!isEditing && item.type === 'Fixed' && item.day_of_payment != null && (
                <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginLeft: '0.5rem' }}>
                  day {item.day_of_payment}
                </span>
              )}
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginLeft: '0.5rem' }}>
                {item.type === 'Budget' ? 'Budget' : 'Fixed'}
              </span>
            </div>

            {isEditing ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  <label style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                    {item.type === 'Budget' ? 'Max' : 'Value'}
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    style={{ width: '6rem' }}
                    autoFocus
                  />
                </div>
                {item.type === 'Fixed' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <label style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Day</label>
                    <input
                      type="number"
                      min={1}
                      max={31}
                      value={editDay}
                      onChange={(e) => setEditDay(e.target.value)}
                      style={{ width: '3.5rem' }}
                    />
                  </div>
                )}
                <button className="btn-primary" onClick={() => confirmEdit(item)} style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem' }}>Save</button>
                <button className="btn-secondary" onClick={() => setEditingId(null)} style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem' }}>Cancel</button>
              </div>
            ) : item.type === 'Budget' ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.875rem' }}>
                <input
                  type="number"
                  min={0}
                  max={item.value}
                  step="0.01"
                  value={spentDrafts[item.id] ?? item.spent}
                  onChange={(e) => setSpentDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))}
                  onBlur={() => {
                    const val = spentDrafts[item.id];
                    if (val !== undefined && val !== String(item.spent)) {
                      onUpdateSpent(item, val).then(() => {
                        setSpentDrafts((prev) => { const n = { ...prev }; delete n[item.id]; return n; });
                      });
                    }
                  }}
                  style={{ width: '5rem', textAlign: 'right' }}
                  title="Spent so far"
                />
                <span style={{ color: 'var(--color-text-muted)' }}>/ {fmt(item.value)}</span>
              </div>
            ) : (
              <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{fmt(item.value)}</span>
            )}

            {!isEditing && (
              <>
                <button
                  onClick={() => startEdit(item)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: '0.8rem', padding: '0 0.25rem', flexShrink: 0 }}
                  title="Edit"
                >
                  ✎
                </button>
                <button
                  onClick={() => onDelete(item)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: '1rem', padding: '0 0.25rem', flexShrink: 0 }}
                  title="Delete"
                >
                  &times;
                </button>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DistributionsList({ distributions, onToggleDone, onDelete, onEdit }) {
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');

  function startEdit(item) {
    setEditingId(item.id);
    setEditValue(String(item.value));
  }

  async function confirmEdit(item) {
    await onEdit(item, { value: Number(editValue) });
    setEditingId(null);
  }

  if (distributions.length === 0) {
    return <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>No distributions yet.</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      {distributions.map((item) => {
        const isEditing = editingId === item.id;
        return (
          <div
            key={item.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              padding: '0.6rem 0.75rem',
              background: 'var(--color-surface)',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--color-border)',
              flexWrap: 'wrap',
              opacity: !isEditing && item.done ? 0.6 : 1,
            }}
          >
            {!isEditing && (
              <input
                type="checkbox"
                checked={!!item.done}
                onChange={() => onToggleDone(item)}
                title={item.done ? 'Mark as not done' : 'Mark as done'}
                style={{ cursor: 'pointer', width: '1rem', height: '1rem', flexShrink: 0 }}
              />
            )}
            <span style={{ flex: 1, fontWeight: 500, textDecoration: !isEditing && item.done ? 'line-through' : 'none' }}>
              {item.name}
            </span>
            {isEditing ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  style={{ width: '6rem' }}
                  autoFocus
                />
                <button className="btn-primary" onClick={() => confirmEdit(item)} style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem' }}>Save</button>
                <button className="btn-secondary" onClick={() => setEditingId(null)} style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem' }}>Cancel</button>
              </div>
            ) : (
              <>
                <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{fmt(item.value)}</span>
                <button
                  onClick={() => startEdit(item)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: '0.8rem', padding: '0 0.25rem', flexShrink: 0 }}
                  title="Edit"
                >
                  ✎
                </button>
                <button
                  onClick={() => onDelete(item)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: '1rem', padding: '0 0.25rem', flexShrink: 0 }}
                  title="Delete"
                >
                  &times;
                </button>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AddCycleItemModal({ section, onSave, onClose }) {
  const [name, setName] = useState('');
  const [type, setType] = useState('Fixed');
  const [value, setValue] = useState('');
  const [dayOfPayment, setDayOfPayment] = useState('');
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
      await onSave(data);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Add {section === 'expense' ? 'Expense' : 'Distribution'}</h2>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="alert alert-error">{error}</div>}
            <div className="form-group">
              <label>Name</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Groceries" autoFocus />
            </div>
            {section === 'expense' && (
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
            {section === 'expense' && type === 'Fixed' && (
              <div className="form-group">
                <label>Day of payment (1–31)</label>
                <input type="number" min={1} max={31} value={dayOfPayment} onChange={(e) => setDayOfPayment(e.target.value)} placeholder="e.g. 5" />
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Adding…' : 'Add'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
