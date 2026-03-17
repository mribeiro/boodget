import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft, faPencil, faTrash, faLock, faLockOpen, faPlus, faXmark, faFileArrowDown, faSpinner, faFileLines } from '@fortawesome/free-solid-svg-icons';
import { api } from '../../services/api';
import ConfirmModal from '../ConfirmModal';
import Checkbox from '../ui/Checkbox';
import { ItemFormModal } from '../annual-expenses/AnnualExpensesTab';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// A cycle stored as (year, month) runs to startDay-1 of the following month.
// The conventional name is the END month.
function cycleLabel(year, month, startDay) {
  const end = new Date(year, month, startDay - 1);
  return `${MONTH_NAMES[end.getMonth()]} ${end.getFullYear()}`;
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
  const [showEditPeriod, setShowEditPeriod] = useState(false);
  const [confirmState, setConfirmState] = useState(null);
  const [annualEditModal, setAnnualEditModal] = useState(null); // { yearId, item } | null

  const [paperlessSettings, setPaperlessSettings] = useState(null);
  const [fetchingPaperless, setFetchingPaperless] = useState(false);
  const [paperlessModal, setPaperlessModal] = useState(null);

  useEffect(() => {
    load();
    api.getDossierSettings(dossierId).then(setPaperlessSettings).catch(() => {});
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

  function handleDeleteItem(item) {
    setConfirmState({
      title: 'Delete item',
      message: `Delete "${item.name}"?`,
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: async () => {
        try {
          await api.deleteCycleItem(dossierId, cycleId, item.id);
          const fresh = await api.getCycle(dossierId, cycleId);
          setCycle(fresh);
        } catch (err) {
          setError(err.message);
        }
      },
    });
  }

  function handleDeleteCycle() {
    const startDay = cycle.cycle_start_day ?? 25;
    const label = cycleLabel(cycle.year, cycle.month, startDay);
    setConfirmState({
      title: 'Delete cycle',
      message: `Permanently delete the ${label} cycle and all its items? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: async () => {
        try {
          await api.deleteCycle(dossierId, cycleId);
          navigate(`/dossiers/${dossierId}`, { state: { tab: 'expenses' } });
        } catch (err) {
          setError(err.message);
        }
      },
    });
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

  async function handleAnnualEdit(p) {
    try {
      const yearData = await api.getAnnualYear(dossierId, p.year_id);
      const fullItem = yearData.items.find((i) => i.id === p.year_item_id);
      if (fullItem) setAnnualEditModal({ yearId: p.year_id, item: fullItem });
    } catch (err) {
      setError(err.message);
    }
  }

  function handleAnnualDelete(p) {
    setConfirmState({
      title: 'Delete annual expense',
      message: `Delete "${p.name}" from the annual expense year? All its installments and payment records will also be removed.`,
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: async () => {
        try {
          await api.deleteAnnualYearItem(dossierId, p.year_id, p.year_item_id);
          await load();
        } catch (err) {
          setError(err.message);
        }
      },
    });
  }

  async function handleFetchPaperless() {
    setError('');
    setFetchingPaperless(true);
    try {
      const result = await api.fetchPaperlessDocuments(dossierId, cycleId);
      setPaperlessModal(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setFetchingPaperless(false);
    }
  }

  async function handleApplyPaperless(items) {
    try {
      await api.applyPaperlessDocuments(dossierId, cycleId, items);
      setPaperlessModal(null);
      await load();
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
  const paperlessActive = !!(paperlessSettings?.paperless_url && paperlessSettings?.paperless_token_set && paperlessSettings?.paperless_date_field_id && paperlessSettings?.paperless_amount_field_id);
  const hasPaperlessItems = expenses.some((e) => e.type === 'Fixed' && e.paperless_tag_id != null);
  const { summary } = cycle;
  const expectedCurrentBalance = summary.total_available - summary.total_expenses_paid - summary.total_distributions_done;

  return (
    <div className="page-fade-in">
      {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      <div className="page-header">
        <button className="btn-ghost" onClick={() => navigate(`/dossiers/${dossierId}`, { state: { tab: 'expenses' } })}>
          <FontAwesomeIcon icon={faArrowLeft} style={{ marginRight: '0.4rem' }} />Back
        </button>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0 }}>{cycleLabel(cycle.year, cycle.month, cycle.cycle_start_day ?? 25)} Cycle</h1>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 'var(--space-1)' }}>
            {cycleDateRange(cycle.year, cycle.month, cycle.cycle_start_day ?? 25)}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button className="btn-secondary" onClick={() => setShowEditPeriod(true)} style={{ fontSize: '0.8rem', padding: '0.3rem 0.65rem' }}>
            <FontAwesomeIcon icon={faPencil} style={{ marginRight: '0.35rem' }} />Period
          </button>
          <button className="btn-secondary" onClick={() => setEditingInfo(true)} style={{ fontSize: '0.8rem', padding: '0.3rem 0.65rem' }}>
            <FontAwesomeIcon icon={faPencil} style={{ marginRight: '0.35rem' }} />Income
          </button>
          {cycle.is_closed ? (
            <button className="btn-secondary" onClick={handleReopen} style={{ fontSize: '0.8rem', padding: '0.3rem 0.65rem' }}>
              <FontAwesomeIcon icon={faLockOpen} style={{ marginRight: '0.35rem' }} />Reopen
            </button>
          ) : (
            <button className="btn-secondary" onClick={() => setShowCloseForm(true)} style={{ fontSize: '0.8rem', padding: '0.3rem 0.65rem' }}>
              <FontAwesomeIcon icon={faLock} style={{ marginRight: '0.35rem' }} />Close cycle
            </button>
          )}
          <button className="btn-danger" onClick={handleDeleteCycle} style={{ fontSize: '0.8rem', padding: '0.3rem 0.65rem' }}>
            <FontAwesomeIcon icon={faTrash} style={{ marginRight: '0.35rem' }} />Delete
          </button>
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
                <div className="cycle-derived-values">
                  <div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Total available</div>
                    <div style={{ fontWeight: 600 }}>{fmt(summary.total_available)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Leftovers expected</div>
                    <div style={{ fontWeight: 600, color: summary.expected_balance < 0 ? 'var(--color-danger)' : 'inherit' }}>{fmt(summary.expected_balance)}</div>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Expected current balance</div>
                  <div style={{ fontWeight: 600, color: expectedCurrentBalance < 0 ? 'var(--color-danger)' : 'inherit' }}>{fmt(expectedCurrentBalance)}</div>
                </div>
              </div>
            )}
          </div>

          {(cycle.is_closed || showCloseForm) && (
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
                </div>
              ) : (
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
              )}
            </div>
          )}
        </div>
      </div>

      {/* Summary */}
      <div className="card" style={{ padding: '1rem', marginBottom: '1.25rem', background: 'var(--color-surface)' }}>
        <h3 style={{ margin: '0 0 0.9rem 0', fontSize: '0.95rem' }}>Summary</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.875rem' }}>
          {/* Expenses */}
          <div>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.3rem' }}>Expenses</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' }}>
              <div>
                <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>Total</div>
                <div style={{ fontWeight: 500 }}>{fmt(summary.total_expenses)}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>Paid</div>
                <div style={{ fontWeight: 500 }}>{fmt(summary.total_expenses_paid)}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>Unpaid</div>
                <div style={{ fontWeight: 500, color: summary.total_expenses_unpaid > 0 ? 'var(--color-warning, #d97706)' : 'inherit' }}>{fmt(summary.total_expenses_unpaid)}</div>
              </div>
            </div>
          </div>

          {/* Distributions */}
          <div>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.3rem' }}>Distributions</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' }}>
              <div>
                <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>Total</div>
                <div style={{ fontWeight: 500 }}>{fmt(summary.total_distributions)}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>Done</div>
                <div style={{ fontWeight: 500 }}>{fmt(summary.total_distributions_done)}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>Pending</div>
                <div style={{ fontWeight: 500, color: summary.total_distributions_not_done > 0 ? 'var(--color-warning, #d97706)' : 'inherit' }}>{fmt(summary.total_distributions_not_done)}</div>
              </div>
            </div>
          </div>

          {/* Closing row (only when closed) */}
          {!!cycle.is_closed && (
            <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '0.5rem' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.3rem' }}>Closing</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' }}>
                <div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>Final real balance</div>
                  <div style={{ fontWeight: 600 }}>{fmt(summary.final_real_balance)}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>Difference</div>
                  <div style={{ fontWeight: 600, color: summary.balance_difference > 0 ? 'var(--color-success)' : summary.balance_difference < 0 ? 'var(--color-danger)' : 'inherit' }}>
                    {fmt(summary.balance_difference)}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Items tabs */}
      <div className="tabs" style={{ marginBottom: 'var(--space-4)' }}>
        {[['expenses', 'Expenses'], ['distributions', 'Distributions']].map(([key, label]) => (
          <button
            key={key}
            className={`tab-btn${activeTab === key ? ' active' : ''}`}
            onClick={() => setActiveTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'expenses' && paperlessActive && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.5rem' }}>
          <button
            className="btn-secondary"
            onClick={handleFetchPaperless}
            disabled={fetchingPaperless}
            style={{ fontSize: '0.8rem', padding: '0.3rem 0.75rem' }}
          >
            <FontAwesomeIcon
              icon={fetchingPaperless ? faSpinner : faFileArrowDown}
              spin={fetchingPaperless}
              style={{ marginRight: '0.4rem' }}
            />
            {fetchingPaperless ? 'Fetching…' : 'Fetch from Paperless'}
          </button>
        </div>
      )}

      {activeTab === 'expenses' ? (
        <ExpensesList
          expenses={expenses}
          annualPayments={cycle.annual_payments ?? []}
          cycleStartDay={cycle.cycle_start_day ?? 25}
          paperlessActive={paperlessActive}
          onTogglePaid={handleTogglePaid}
          onUpdateSpent={handleUpdateSpent}
          onDelete={handleDeleteItem}
          onEdit={handleEditItem}
          dossierId={dossierId}
          onAnnualPaymentUpdated={load}
          onAnnualEdit={handleAnnualEdit}
          onAnnualDelete={handleAnnualDelete}
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
        <FontAwesomeIcon icon={faPlus} style={{ marginRight: '0.4rem' }} />Add {activeTab === 'expenses' ? 'expense' : 'distribution'}
      </button>

      {showAddModal && (
        <AddCycleItemModal
          section={activeTab === 'expenses' ? 'expense' : 'distribution'}
          onSave={handleAddItem}
          onClose={() => setShowAddModal(false)}
        />
      )}
      {confirmState && <ConfirmModal {...confirmState} onCancel={() => setConfirmState(null)} />}
      {annualEditModal && (
        <ItemFormModal
          dossierId={dossierId}
          yearId={annualEditModal.yearId}
          item={annualEditModal.item}
          onSave={async () => { setAnnualEditModal(null); await load(); }}
          onClose={() => setAnnualEditModal(null)}
        />
      )}
      {paperlessModal && (
        <PaperlessFetchModal
          results={paperlessModal.results}
          warnings={paperlessModal.warnings}
          onApply={handleApplyPaperless}
          onClose={() => setPaperlessModal(null)}
        />
      )}
      {showEditPeriod && (
        <EditPeriodModal
          cycle={cycle}
          dossierId={dossierId}
          onSave={async (year, month) => {
            await api.updateCycle(dossierId, cycleId, { year, month });
            setShowEditPeriod(false);
            await load();
          }}
          onClose={() => setShowEditPeriod(false)}
        />
      )}
    </div>
  );
}

const MONTH_NAMES_MODAL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function EditPeriodModal({ cycle, dossierId, onSave, onClose }) {
  const startDay = cycle.cycle_start_day ?? 25;
  const [year, setYear] = useState(cycle.year);
  const [month, setMonth] = useState(cycle.month);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [allCycles, setAllCycles] = useState([]);

  useEffect(() => {
    api.getCycles(dossierId).then(setAllCycles).catch(() => {});
  }, [dossierId]);

  const now = new Date();
  const baseYear = now.getFullYear();
  const minYear = Math.min(baseYear - 3, cycle.year);
  const maxYear = Math.max(baseYear + 3, cycle.year);
  const years = Array.from({ length: maxYear - minYear + 1 }, (_, i) => minYear + i);

  function isTaken(y, m) {
    return allCycles.some((c) => c.year === y && c.month === m && c.id !== cycle.id);
  }

  const endDate = new Date(year, month, startDay - 1);
  const cycleDisplayLabel = `${MONTH_NAMES_MODAL[endDate.getMonth()]} ${endDate.getFullYear()}`;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (isTaken(year, month)) { setError('A cycle for that period already exists'); return; }
    setSaving(true);
    try {
      await onSave(year, month);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  const startFmt = new Date(year, month - 1, startDay).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const endFmt = endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Edit Period</h2>
          <button className="close-btn" onClick={onClose}><FontAwesomeIcon icon={faXmark} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="alert alert-error">{error}</div>}
            <div style={{ display: 'flex', gap: '1rem' }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Cycle</label>
                <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
                    const end = new Date(year, m, startDay - 1);
                    const label = `${MONTH_NAMES_MODAL[end.getMonth()]} ${end.getFullYear()}`;
                    return (
                      <option key={m} value={m} disabled={isTaken(year, m)}>
                        {label}{isTaken(year, m) ? ' (exists)' : ''}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Start year</label>
                <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
                  {years.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: '-0.25rem' }}>
              {startFmt} – {endFmt}
            </div>
            {isTaken(year, month) && <div className="alert alert-error" style={{ marginTop: '0.5rem' }}>This period already has a cycle.</div>}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving || isTaken(year, month)}>
              {saving ? 'Saving…' : `Move to ${cycleDisplayLabel}`}
            </button>
          </div>
        </form>
      </div>
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

function ExpensesList({ expenses, annualPayments = [], cycleStartDay = 25, paperlessActive, onTogglePaid, onUpdateSpent, onDelete, onEdit, dossierId, onAnnualPaymentUpdated, onAnnualDelete, onAnnualEdit }) {
  const [spentDrafts, setSpentDrafts] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [editDay, setEditDay] = useState('');
  const [editTagId, setEditTagId] = useState('');
  function startEdit(item) {
    setEditingId(item.id);
    setEditValue(String(item.value));
    setEditDay(item.day_of_payment != null ? String(item.day_of_payment) : '');
    setEditTagId(item.paperless_tag_id != null ? String(item.paperless_tag_id) : '');
  }

  async function confirmEdit(item) {
    const data = { value: Number(editValue) };
    if (item.type === 'Fixed') {
      data.day_of_payment = Number(editDay);
      if (paperlessActive) {
        data.paperless_tag_id = editTagId.trim() !== '' ? Number(editTagId) : null;
      }
    }
    await onEdit(item, data);
    setEditingId(null);
  }

  async function handleAnnualTogglePaid(p) {
    try {
      await api.updateAnnualPayment(dossierId, p.id, { paid: p.paid ? false : true });
      onAnnualPaymentUpdated();
    } catch (e) {
      console.error('Failed to toggle annual payment:', e);
    }
  }

  // Merge annual payments into the sorted expenses list
  // Tag annual items so we can render them differently
  const annualItems = annualPayments.map((p) => ({ ...p, _annual: true }));

  // Re-sort fixed + annual together by the same cycle-day ordering
  const fixedExpenses = expenses.filter((e) => e.type === 'Fixed');
  const budgetExpenses = expenses.filter((e) => e.type === 'Budget');

  const fixedAndAnnual = [...fixedExpenses, ...annualItems].sort((a, b) => {
    const aDay = a._annual ? (a.day ?? 0) : (a.day_of_payment ?? 0);
    const bDay = b._annual ? (b.day ?? 0) : (b.day_of_payment ?? 0);
    const aLate = aDay < cycleStartDay ? 1 : 0;
    const bLate = bDay < cycleStartDay ? 1 : 0;
    if (aLate !== bLate) return aLate - bLate;
    return aDay - bDay;
  });

  const allItems = [...fixedAndAnnual, ...budgetExpenses];

  if (allItems.length === 0) {
    return <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>No expenses yet.</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      {allItems.map((item) => {
        // ── Annual payment row ──
        if (item._annual) {
          const p = item;
          const typeLabel = p.num_installments > 1
            ? `Annual ${p.installment_number}/${p.num_installments}`
            : 'Annual';
          const expectedValue = (p.budgeted_value ?? 0) / (p.num_installments || 1);
          return (
            <div
              key={`annual-${p.id}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.6rem 0.75rem',
                background: 'var(--color-surface)',
                borderRadius: 'var(--radius)',
                border: '1px solid var(--color-border)',
                flexWrap: 'wrap',
                opacity: p.paid ? 0.6 : 1,
              }}
            >
              <Checkbox
                checked={!!p.paid}
                onChange={() => handleAnnualTogglePaid(p)}
                title={p.paid ? 'Mark as unpaid' : 'Mark as paid'}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 500, textDecoration: p.paid ? 'line-through' : 'none' }}>
                  {p.name}
                </span>
                {p.day != null && (
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginLeft: '0.5rem' }}>
                    day {p.day}
                  </span>
                )}
                <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginLeft: '0.5rem' }}>
                  {typeLabel}
                </span>
              </div>
              <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>
                {fmt(expectedValue)}
              </span>
              <button
                onClick={() => onAnnualEdit(p)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: '0.8rem', padding: '0 0.25rem', flexShrink: 0 }}
                title="Edit annual expense"
              >
                <FontAwesomeIcon icon={faPencil} />
              </button>
              <button
                onClick={() => onAnnualDelete(p)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: '0.8rem', padding: '0 0.25rem', flexShrink: 0 }}
                title="Delete annual expense"
              >
                <FontAwesomeIcon icon={faTrash} />
              </button>
            </div>
          );
        }

        // ── Regular expense row ──
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
              <Checkbox
                checked={!!item.paid}
                onChange={() => onTogglePaid(item)}
                title={item.paid ? 'Mark as unpaid' : 'Mark as paid'}
              />
            )}

            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontWeight: 500, textDecoration: !isEditing && item.type === 'Fixed' && item.paid ? 'line-through' : 'none' }}>
                {item.name}
              </span>
              {paperlessActive && item.type === 'Fixed' && item.paperless_tag_id != null && (
                <FontAwesomeIcon
                  icon={faFileLines}
                  title={`Linked to Paperless tag ${item.paperless_tag_id}`}
                  style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginLeft: '0.4rem' }}
                />
              )}
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
                {item.type === 'Fixed' && paperlessActive && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <label style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Tag ID</label>
                    <input
                      type="number"
                      min={1}
                      value={editTagId}
                      onChange={(e) => setEditTagId(e.target.value)}
                      placeholder="—"
                      style={{ width: '4rem' }}
                      title="Paperless tag ID"
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
                  <FontAwesomeIcon icon={faPencil} />
                </button>
                <button
                  onClick={() => onDelete(item)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: '0.8rem', padding: '0 0.25rem', flexShrink: 0 }}
                  title="Delete"
                >
                  <FontAwesomeIcon icon={faTrash} />
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
              <Checkbox
                checked={!!item.done}
                onChange={() => onToggleDone(item)}
                title={item.done ? 'Mark as not done' : 'Mark as done'}
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
                  <FontAwesomeIcon icon={faPencil} />
                </button>
                <button
                  onClick={() => onDelete(item)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: '0.8rem', padding: '0 0.25rem', flexShrink: 0 }}
                  title="Delete"
                >
                  <FontAwesomeIcon icon={faTrash} />
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
          <button className="close-btn" onClick={onClose}><FontAwesomeIcon icon={faXmark} /></button>
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

function PaperlessFetchModal({ results, warnings, onApply, onClose }) {
  const [applying, setApplying] = useState(false);

  async function handleApply() {
    setApplying(true);
    const items = results.map((r) => ({
      cycle_item_id: r.cycle_item_id,
      value: r.proposed_value,
      day_of_payment: r.proposed_day_of_payment,
    }));
    await onApply(items);
    setApplying(false);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 680 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Paperless-ngx — Fetched Documents</h2>
          <button className="close-btn" onClick={onClose}><FontAwesomeIcon icon={faXmark} /></button>
        </div>
        <div className="modal-body">
          {results.length === 0 ? (
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
              No matching documents found in Paperless-ngx for this cycle's date range.
            </p>
          ) : (
            <div className="table-container" style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ color: 'var(--color-text-muted)', textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>
                    <th style={{ padding: '0.4rem 0.5rem', fontWeight: 500 }}>Expense</th>
                    <th style={{ padding: '0.4rem 0.5rem', fontWeight: 500, textAlign: 'right' }}>Current</th>
                    <th style={{ padding: '0.4rem 0.5rem', fontWeight: 500, textAlign: 'right' }}>Proposed</th>
                    <th style={{ padding: '0.4rem 0.5rem', fontWeight: 500, textAlign: 'center' }}>Day</th>
                    <th style={{ padding: '0.4rem 0.5rem', fontWeight: 500 }}>Documents</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => {
                    const valueChanged = r.proposed_value !== r.current_value;
                    const dayChanged = r.proposed_day_of_payment !== r.current_day_of_payment;
                    return (
                      <tr key={r.cycle_item_id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <td style={{ padding: '0.5rem 0.5rem', fontWeight: 500 }}>{r.expense_name}</td>
                        <td style={{ padding: '0.5rem 0.5rem', textAlign: 'right', color: 'var(--color-text-muted)' }}>
                          {fmt(r.current_value)}
                        </td>
                        <td style={{ padding: '0.5rem 0.5rem', textAlign: 'right', fontWeight: valueChanged ? 700 : 400, color: valueChanged ? 'var(--color-primary, #2563eb)' : 'inherit' }}>
                          {fmt(r.proposed_value)}
                        </td>
                        <td style={{ padding: '0.5rem 0.5rem', textAlign: 'center', color: dayChanged ? 'var(--color-primary, #2563eb)' : 'inherit', fontWeight: dayChanged ? 700 : 400 }}>
                          {dayChanged ? `${r.current_day_of_payment} → ${r.proposed_day_of_payment}` : r.proposed_day_of_payment}
                        </td>
                        <td style={{ padding: '0.5rem 0.5rem' }}>
                          {r.documents.map((doc) => (
                            <div key={doc.id} style={{ marginBottom: '0.2rem' }}>
                              <a href={doc.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.8rem', color: 'var(--color-primary, #2563eb)' }}>
                                <FontAwesomeIcon icon={faFileLines} style={{ marginRight: '0.25rem' }} />
                                {doc.title}
                              </a>
                              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginLeft: '0.35rem' }}>
                                ({fmt(doc.value)}, {doc.date})
                              </span>
                            </div>
                          ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {warnings.length > 0 && (
            <div style={{ marginTop: '1rem', padding: '0.75rem', background: '#fef3c7', borderRadius: 'var(--radius)', border: '1px solid #f59e0b' }}>
              <div style={{ fontWeight: 600, fontSize: '0.8rem', marginBottom: '0.25rem', color: '#92400e' }}>Warnings</div>
              {warnings.map((w, i) => (
                <div key={i} style={{ fontSize: '0.8rem', color: '#92400e' }}>{w}</div>
              ))}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          {results.length > 0 && (
            <button type="button" className="btn-primary" onClick={handleApply} disabled={applying}>
              {applying ? 'Applying…' : 'Apply'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

