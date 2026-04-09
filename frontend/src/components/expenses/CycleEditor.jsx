import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faArrowLeft, faPencil, faTrash, faLock, faLockOpen, faPlus, faXmark,
  faFileArrowDown, faSpinner, faFileLines, faCheck, faArrowRotateLeft,
  faReceipt, faWallet, faHandHoldingDollar, faMoneyBillWave,
  faCircleCheck, faClock,
} from '@fortawesome/free-solid-svg-icons';
import { api } from '../../services/api';
import ConfirmModal from '../ConfirmModal';
import Checkbox from '../ui/Checkbox';
import Toast from '../ui/Toast';
import KpiBlock from '../ui/KpiBlock';
import CollapsibleSection from '../ui/CollapsibleSection';
import { ItemFormModal } from '../annual-expenses/AnnualExpensesTab';

// ── Budget progress bar ───────────────────────────────────────────────────────

function BudgetBar({ spent, max }) {
  const pct = max > 0 ? Math.min((spent / max) * 100, 100) : 0;
  const color =
    pct > 90 ? 'var(--color-danger)' :
    pct > 60 ? 'var(--color-warning)' :
    'var(--color-success)';
  return (
    <div style={{
      height: 5, borderRadius: 3,
      background: 'var(--border-default)',
      overflow: 'hidden', flexShrink: 0,
    }}>
      <div style={{
        height: '100%', borderRadius: 3,
        background: color,
        width: `${pct}%`,
        transition: 'width 0.5s ease',
      }} />
    </div>
  );
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

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

// ── Main component ─────────────────────────────────────────────────────────────

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
  const [annualEditModal, setAnnualEditModal] = useState(null);

  const [paperlessSettings, setPaperlessSettings] = useState(null);
  const [fetchingPaperless, setFetchingPaperless] = useState(false);
  const [paperlessModal, setPaperlessModal] = useState(null);
  const [pullingAnnual, setPullingAnnual] = useState(false);

  // Mobile collapsible sections
  const [summaryCollapsed, setSummaryCollapsed] = useState(false);
  const [expensesCollapsed, setExpensesCollapsed] = useState(false);
  const [distributionsCollapsed, setDistributionsCollapsed] = useState(true);

  // Toast
  const [toast, setToast] = useState({ msg: '', show: false });
  const toastTimer = useRef(null);

  function showToast(msg) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, show: true });
    toastTimer.current = setTimeout(() => setToast((t) => ({ ...t, show: false })), 2000);
  }

  useEffect(() => {
    load();
    api.getDossierSettings(dossierId).then(setPaperlessSettings).catch(() => {});
    return () => { if (toastTimer.current) clearTimeout(toastTimer.current); };
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
      showToast('Cycle closed');
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
      showToast('Cycle reopened');
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
      await api.updateCycleItem(dossierId, cycleId, item.id, { paid: !item.paid });
      const fresh = await api.getCycle(dossierId, cycleId);
      setCycle(fresh);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleToggleDone(item) {
    try {
      await api.updateCycleItem(dossierId, cycleId, item.id, { done: !item.done });
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
          showToast('Item deleted');
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

  async function handlePullAnnualExpenses() {
    setError('');
    setPullingAnnual(true);
    try {
      await api.pullAnnualExpensesForCycle(dossierId, cycleId);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setPullingAnnual(false);
    }
  }

  async function handleAddItem(data) {
    try {
      await api.createCycleItem(dossierId, cycleId, { ...data, section: activeTab === 'expenses' ? 'expense' : 'distribution' });
      const fresh = await api.getCycle(dossierId, cycleId);
      setCycle(fresh);
      setShowAddModal(false);
      showToast('Item added');
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
  const { summary } = cycle;
  const expectedCurrentBalance = summary.total_available - summary.total_expenses_paid - summary.total_distributions_done;

  const fixedExpenses = expenses.filter((e) => e.type === 'Fixed');
  const budgetExpenses = expenses.filter((e) => e.type === 'Budget');
  const paidFixed = fixedExpenses.filter((e) => e.paid).length;
  const doneDist = distributions.filter((d) => d.done).length;

  // Difference for close panel
  const balDiff = finalBalance !== '' ? Number(finalBalance) - summary.expected_balance : null;

  return (
    <div className="page-fade-in">
      {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      {/* ── Header ── */}
      <div className="page-header">
        <button className="btn-ghost" onClick={() => navigate(`/dossiers/${dossierId}`, { state: { tab: 'expenses' } })}>
          <FontAwesomeIcon icon={faArrowLeft} style={{ marginRight: '0.4rem' }} />Back
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0 }}>{cycleLabel(cycle.year, cycle.month, cycle.cycle_start_day ?? 25)} Cycle</h1>
            <span className={`badge ${cycle.is_closed ? 'badge-secondary' : 'badge-success'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <FontAwesomeIcon icon={cycle.is_closed ? faLock : faLockOpen} style={{ fontSize: 10 }} />
              {cycle.is_closed ? 'Closed' : 'Open'}
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 'var(--space-1)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <FontAwesomeIcon icon={faClock} style={{ fontSize: 10 }} />
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
          <button className="btn-secondary" onClick={handlePullAnnualExpenses} disabled={pullingAnnual} style={{ fontSize: '0.8rem', padding: '0.3rem 0.65rem' }}>
            <FontAwesomeIcon icon={faFileArrowDown} style={{ marginRight: '0.35rem' }} />
            {pullingAnnual ? 'Pulling…' : 'Pull annual'}
          </button>
          {cycle.is_closed ? (
            <button className="btn-secondary" onClick={handleReopen} style={{ fontSize: '0.8rem', padding: '0.3rem 0.65rem' }}>
              <FontAwesomeIcon icon={faArrowRotateLeft} style={{ marginRight: '0.35rem' }} />Reopen
            </button>
          ) : null}
          <button className="btn-danger" onClick={handleDeleteCycle} style={{ fontSize: '0.8rem', padding: '0.3rem 0.65rem' }}>
            <FontAwesomeIcon icon={faTrash} style={{ marginRight: '0.35rem' }} />Delete
          </button>
        </div>
      </div>

      {/* ── Income row (edit mode) ── */}
      {editingInfo && (
        <div className="card" style={{ padding: '1rem', marginBottom: '1rem' }}>
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
        </div>
      )}

      {/* ── Summary KPIs ── */}
      <div className="cycle-editor-summary" style={{ marginBottom: '1.25rem' }}>
        {/* Desktop: horizontal row of KPI blocks */}
        <div className="cycle-kpi-row">
          <KpiBlock label="Salary" value={fmt(cycle.salary)} icon={faMoneyBillWave} />
          <KpiBlock label="Prev. bal." value={fmt(cycle.previous_balance)} icon={faWallet} />
          <KpiBlock label="Available" value={fmt(summary.total_available)} icon={faWallet} highlight="neutral" />
          <KpiBlock label="Expenses" value={fmt(summary.total_expenses)} icon={faReceipt} highlight="danger" />
          <KpiBlock label="Paid" value={fmt(summary.total_expenses_paid)} icon={faCircleCheck} highlight="success" />
          <KpiBlock label="Unpaid" value={fmt(summary.total_expenses_unpaid)} icon={faClock} highlight={summary.total_expenses_unpaid > 0 ? 'warning' : 'neutral'} />
          <KpiBlock
            label="Exp. balance"
            value={fmt(summary.expected_balance)}
            icon={faWallet}
            highlight={summary.expected_balance < 0 ? 'danger' : 'success'}
            large
          />
        </div>

        {/* Closed: show final balance and difference */}
        {cycle.is_closed && (
          <div style={{ display: 'flex', gap: '1rem', marginTop: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <KpiBlock
              label="Final balance"
              value={fmt(summary.final_real_balance)}
              icon={faLock}
              highlight={summary.balance_difference > 0 ? 'success' : summary.balance_difference < 0 ? 'danger' : 'neutral'}
            />
            <KpiBlock
              label="Difference"
              value={summary.balance_difference != null ? (summary.balance_difference > 0 ? '+' : '') + fmt(summary.balance_difference) : '—'}
              icon={faCircleCheck}
              highlight={summary.balance_difference > 0 ? 'success' : summary.balance_difference < 0 ? 'danger' : 'neutral'}
            />
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label style={{ fontSize: '0.8rem' }}>Update final balance (€)</label>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <input type="number" step="0.01" value={finalBalance} onChange={(e) => setFinalBalance(e.target.value)} style={{ width: '8rem' }} />
                <button className="btn-secondary" onClick={handleUpdateFinalBalance} style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}>Update</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Desktop two-column layout ── */}
      <div className="cycle-editor-columns">
        {/* LEFT: expenses + close form (if open cycle) */}
        <div className="cycle-editor-left">

          {/* ── Desktop: Paperless fetch button ── */}
          {paperlessActive && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.5rem' }}>
              <button className="btn-secondary" onClick={handleFetchPaperless} disabled={fetchingPaperless} style={{ fontSize: '0.8rem', padding: '0.3rem 0.75rem' }}>
                <FontAwesomeIcon icon={fetchingPaperless ? faSpinner : faFileArrowDown} spin={fetchingPaperless} style={{ marginRight: '0.4rem' }} />
                {fetchingPaperless ? 'Fetching…' : 'Fetch from Paperless'}
              </button>
            </div>
          )}

          {/* ── Fixed Expenses section ── */}
          <CollapsibleSection
            title="Fixed Expenses"
            icon={faReceipt}
            accent="var(--color-danger)"
            count={`${paidFixed}/${fixedExpenses.length + (cycle.annual_payments?.length ?? 0)}`}
            collapsed={expensesCollapsed}
            onToggle={() => setExpensesCollapsed((v) => !v)}
          >
            <ExpensesList
              expenses={expenses.filter((e) => e.type === 'Fixed')}
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
              onlyFixed
            />
            <button className="btn-ghost" onClick={() => { setActiveTab('expenses'); setShowAddModal(true); }} style={{ marginTop: '0.75rem', fontSize: '0.875rem' }}>
              <FontAwesomeIcon icon={faPlus} style={{ marginRight: '0.4rem' }} />Add expense
            </button>
          </CollapsibleSection>

          {/* ── Budget Expenses section ── */}
          {budgetExpenses.length > 0 && (
            <div style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius)', border: '1px solid var(--border-default)', overflow: 'hidden', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 16px', borderBottom: '1px solid var(--border-default)' }}>
                <div style={{ width: 3, height: 16, borderRadius: 2, background: 'var(--color-warning)', flexShrink: 0 }} />
                <FontAwesomeIcon icon={faWallet} style={{ fontSize: 13, color: 'var(--color-warning)' }} />
                <span style={{ fontSize: 14, fontWeight: 700 }}>Budgets</span>
              </div>
              <div style={{ padding: '0 16px 14px' }}>
                <BudgetExpensesList
                  expenses={budgetExpenses}
                  onUpdateSpent={handleUpdateSpent}
                  onDelete={handleDeleteItem}
                  onEdit={handleEditItem}
                />
              </div>
            </div>
          )}

          {/* ── Close Cycle panel (only on desktop, open cycle) ── */}
          {!cycle.is_closed && (
            <div className="cycle-close-panel-desktop">
              <CloseCyclePanel
                finalBalance={finalBalance}
                setFinalBalance={setFinalBalance}
                expectedBalance={summary.expected_balance}
                balDiff={balDiff}
                showCloseForm={showCloseForm}
                setShowCloseForm={setShowCloseForm}
                savingClose={savingClose}
                onClose={handleClose}
              />
            </div>
          )}
        </div>

        {/* RIGHT: Distributions + Close panel */}
        <div className="cycle-editor-right">
          <CollapsibleSection
            title="Distributions"
            icon={faHandHoldingDollar}
            accent="var(--color-brand)"
            count={`${doneDist}/${distributions.length}`}
            collapsed={distributionsCollapsed}
            onToggle={() => setDistributionsCollapsed((v) => !v)}
          >
            <DistributionsList
              distributions={distributions}
              onToggleDone={handleToggleDone}
              onDelete={handleDeleteItem}
              onEdit={handleEditItem}
            />
            {/* Distributions total footer */}
            {distributions.length > 0 && (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border-default)', display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)' }}>
                <span>Total: {fmt(summary.total_distributions)}</span>
                <span style={{ color: 'var(--color-brand)', fontWeight: 600 }}>Done: {fmt(summary.total_distributions_done)}</span>
              </div>
            )}
            <button className="btn-ghost" onClick={() => { setActiveTab('distributions'); setShowAddModal(true); }} style={{ marginTop: '0.75rem', fontSize: '0.875rem' }}>
              <FontAwesomeIcon icon={faPlus} style={{ marginRight: '0.4rem' }} />Add distribution
            </button>
          </CollapsibleSection>

          {/* ── Close Cycle panel (right column on desktop, open cycle) ── */}
          {!cycle.is_closed && (
            <div className="cycle-close-panel-right">
              <CloseCyclePanel
                finalBalance={finalBalance}
                setFinalBalance={setFinalBalance}
                expectedBalance={summary.expected_balance}
                balDiff={balDiff}
                showCloseForm={showCloseForm}
                setShowCloseForm={setShowCloseForm}
                savingClose={savingClose}
                onClose={handleClose}
              />
            </div>
          )}
        </div>
      </div>

      {/* ── Modals ── */}
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
      <Toast message={toast.msg} visible={toast.show} />
    </div>
  );
}



// ── Close Cycle Panel ─────────────────────────────────────────────────────────

function CloseCyclePanel({ finalBalance, setFinalBalance, expectedBalance, balDiff, showCloseForm, setShowCloseForm, savingClose, onClose }) {
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius)',
      padding: '16px',
      marginBottom: '1rem',
    }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
        <FontAwesomeIcon icon={faLock} style={{ fontSize: 12, color: 'var(--color-success)' }} />
        Close Cycle
      </div>
      {!showCloseForm ? (
        <button className="btn-secondary" onClick={() => setShowCloseForm(true)} style={{ fontSize: '0.875rem' }}>
          <FontAwesomeIcon icon={faLock} style={{ marginRight: '0.35rem' }} />Close cycle…
        </button>
      ) : (
        <>
          <div style={{ marginBottom: 8 }}>
            <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
              Final Real Balance (€)
            </label>
            <input
              type="number"
              step="0.01"
              value={finalBalance}
              onChange={(e) => setFinalBalance(e.target.value)}
              placeholder="0.00"
              style={{ width: '100%' }}
              autoFocus
            />
          </div>
          {balDiff !== null && (
            <div style={{
              marginBottom: 12,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '8px 12px',
              borderRadius: 'var(--radius)',
              background: balDiff >= 0 ? 'var(--color-success-light)' : 'var(--color-danger-light)',
            }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Difference vs expected</span>
              <span style={{
                fontSize: 15,
                fontWeight: 800,
                color: balDiff >= 0 ? 'var(--color-success)' : 'var(--color-danger)',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {balDiff >= 0 ? '+' : ''}{fmt(balDiff)}
              </span>
            </div>
          )}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn-primary" onClick={onClose} disabled={savingClose} style={{ flex: 1 }}>
              <FontAwesomeIcon icon={faCheck} style={{ marginRight: '0.35rem' }} />
              {savingClose ? 'Closing…' : 'Confirm close'}
            </button>
            <button className="btn-secondary" onClick={() => setShowCloseForm(false)}>Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Period edit modal ─────────────────────────────────────────────────────────

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

  const startFmt = new Date(year, month - 1, startDay).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const endFmt = endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

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

// ── Fixed Expenses list ───────────────────────────────────────────────────────

function ExpensesList({ expenses, annualPayments = [], cycleStartDay = 25, paperlessActive, onTogglePaid, onUpdateSpent, onDelete, onEdit, dossierId, onAnnualPaymentUpdated, onAnnualDelete, onAnnualEdit, onlyFixed }) {
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

  const annualItems = annualPayments.map((p) => ({ ...p, _annual: true }));
  const fixedExpenses = expenses.filter((e) => e.type === 'Fixed');
  const budgetExpenses = onlyFixed ? [] : expenses.filter((e) => e.type === 'Budget');

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
    return <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', margin: 0 }}>No expenses yet.</p>;
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
                background: 'var(--bg-card)',
                borderRadius: 'var(--radius)',
                border: '1px solid var(--border-default)',
                flexWrap: 'wrap',
                opacity: p.paid ? 0.5 : 1,
                transition: 'opacity 0.25s ease',
              }}
            >
              <Checkbox
                checked={!!p.paid}
                onChange={() => handleAnnualTogglePaid(p)}
                title={p.paid ? 'Mark as unpaid' : 'Mark as paid'}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{
                  fontWeight: 500,
                  textDecoration: p.paid ? 'line-through' : 'none',
                  color: p.paid ? 'var(--text-muted)' : 'var(--text-primary)',
                  transition: 'color 0.25s ease',
                }}>
                  {p.name}
                </span>
                {p.day != null && (
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
                    day {p.day}
                  </span>
                )}
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
                  {typeLabel}
                </span>
              </div>
              <span style={{ fontSize: '0.875rem', fontWeight: 500, color: p.paid ? 'var(--text-muted)' : 'var(--text-primary)', transition: 'color 0.25s ease' }}>
                {fmt(expectedValue)}
              </span>
              <button
                onClick={() => onAnnualEdit(p)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.8rem', padding: '0 0.25rem', flexShrink: 0 }}
                title="Edit annual expense"
              >
                <FontAwesomeIcon icon={faPencil} />
              </button>
              <button
                onClick={() => onAnnualDelete(p)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.8rem', padding: '0 0.25rem', flexShrink: 0 }}
                title="Delete annual expense"
              >
                <FontAwesomeIcon icon={faTrash} />
              </button>
            </div>
          );
        }

        // ── Regular expense row ──
        const isEditing = editingId === item.id;
        const isPaid = item.type === 'Fixed' && item.paid;
        return (
          <div
            key={item.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              padding: '0.6rem 0.75rem',
              background: 'var(--bg-card)',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border-default)',
              flexWrap: 'wrap',
              opacity: !isEditing && isPaid ? 0.5 : 1,
              transition: 'opacity 0.25s ease',
              borderLeft: !isEditing && isPaid ? '3px solid var(--color-success)' : undefined,
            }}
          >
            {item.type === 'Fixed' && !isEditing && (
              <Checkbox
                checked={!!item.paid}
                onChange={() => onTogglePaid(item)}
                title={item.paid ? 'Mark as unpaid' : 'Mark as paid'}
              />
            )}

            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{
                fontWeight: 500,
                textDecoration: !isEditing && isPaid ? 'line-through' : 'none',
                color: !isEditing && isPaid ? 'var(--text-muted)' : 'var(--text-primary)',
                transition: 'color 0.25s ease, text-decoration 0.25s ease',
              }}>
                {item.name}
              </span>
              {paperlessActive && item.type === 'Fixed' && item.paperless_tag_id != null && (
                <FontAwesomeIcon
                  icon={faFileLines}
                  title={`Linked to Paperless tag ${item.paperless_tag_id}`}
                  style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: '0.4rem' }}
                />
              )}
              {!isEditing && item.type === 'Fixed' && item.day_of_payment != null && (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
                  <FontAwesomeIcon icon={faClock} style={{ fontSize: '0.65rem', marginRight: 2 }} />
                  day {item.day_of_payment}
                </span>
              )}
            </div>

            {isEditing ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {item.type === 'Budget' ? 'Max' : 'Value'}
                  </label>
                  <input type="number" min={0} step="0.01" value={editValue} onChange={(e) => setEditValue(e.target.value)} style={{ width: '6rem' }} autoFocus />
                </div>
                {item.type === 'Fixed' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Day</label>
                    <input type="number" min={1} max={31} value={editDay} onChange={(e) => setEditDay(e.target.value)} style={{ width: '3.5rem' }} />
                  </div>
                )}
                {item.type === 'Fixed' && paperlessActive && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Tag ID</label>
                    <input type="number" min={1} value={editTagId} onChange={(e) => setEditTagId(e.target.value)} placeholder="—" style={{ width: '4rem' }} title="Paperless tag ID" />
                  </div>
                )}
                <button className="btn-primary" onClick={() => confirmEdit(item)} style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem' }}>Save</button>
                <button className="btn-secondary" onClick={() => setEditingId(null)} style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem' }}>Cancel</button>
              </div>
            ) : (
              <span style={{ fontSize: '0.875rem', fontWeight: 500, color: isPaid ? 'var(--text-muted)' : 'var(--text-primary)', transition: 'color 0.25s ease' }}>
                {fmt(item.value)}
              </span>
            )}

            {!isEditing && (
              <>
                <button
                  onClick={() => startEdit(item)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.8rem', padding: '0 0.25rem', flexShrink: 0 }}
                  title="Edit"
                >
                  <FontAwesomeIcon icon={faPencil} />
                </button>
                <button
                  onClick={() => onDelete(item)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.8rem', padding: '0 0.25rem', flexShrink: 0 }}
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

// ── Budget Expenses list ──────────────────────────────────────────────────────

function BudgetExpensesList({ expenses, onUpdateSpent, onDelete, onEdit }) {
  const [spentDrafts, setSpentDrafts] = useState({});
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

  if (expenses.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {expenses.map((item) => {
        const isEditing = editingId === item.id;
        const spent = spentDrafts[item.id] !== undefined ? Number(spentDrafts[item.id]) : (item.spent ?? 0);
        const pct = item.value > 0 ? Math.min((spent / item.value) * 100, 100) : 0;
        const barColor =
          pct > 90 ? 'var(--color-danger)' :
          pct > 60 ? 'var(--color-warning)' :
          'var(--color-success)';

        return (
          <div
            key={item.id}
            style={{
              background: 'var(--bg-card)',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border-default)',
              padding: '12px 14px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{item.name}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: barColor, fontVariantNumeric: 'tabular-nums' }}>
                  {Math.round(pct)}%
                </span>
                {!isEditing && (
                  <>
                    <button
                      onClick={() => startEdit(item)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.8rem', padding: '0 0.2rem' }}
                      title="Edit max"
                    >
                      <FontAwesomeIcon icon={faPencil} />
                    </button>
                    <button
                      onClick={() => onDelete(item)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.8rem', padding: '0 0.2rem' }}
                      title="Delete"
                    >
                      <FontAwesomeIcon icon={faTrash} />
                    </button>
                  </>
                )}
              </div>
            </div>
            {/* Progress bar */}
            <BudgetBar spent={spent} max={item.value} />
            {/* Spent input / max */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
              {isEditing ? (
                <>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Max (€)</label>
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
                </>
              ) : (
                <>
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
                  <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>/ {fmt(item.value)}</span>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Distributions list ────────────────────────────────────────────────────────

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
    return <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', margin: 0 }}>No distributions yet.</p>;
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
              background: 'var(--bg-card)',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border-default)',
              flexWrap: 'wrap',
              opacity: !isEditing && item.done ? 0.5 : 1,
              transition: 'opacity 0.25s ease',
              borderLeft: !isEditing && item.done ? '3px solid var(--color-brand)' : undefined,
            }}
          >
            {!isEditing && (
              <Checkbox
                checked={!!item.done}
                onChange={() => onToggleDone(item)}
                title={item.done ? 'Mark as not done' : 'Mark as done'}
                style={{ '--checkbox-color': 'var(--color-brand)' }}
              />
            )}
            <span style={{
              flex: 1,
              fontWeight: 500,
              textDecoration: !isEditing && item.done ? 'line-through' : 'none',
              color: !isEditing && item.done ? 'var(--text-muted)' : 'var(--text-primary)',
              transition: 'color 0.25s ease',
            }}>
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
                <span style={{
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  color: item.done ? 'var(--text-muted)' : 'var(--text-primary)',
                  transition: 'color 0.25s ease',
                  fontVariantNumeric: 'tabular-nums',
                }}>{fmt(item.value)}</span>
                <button
                  onClick={() => startEdit(item)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.8rem', padding: '0 0.25rem', flexShrink: 0 }}
                  title="Edit"
                >
                  <FontAwesomeIcon icon={faPencil} />
                </button>
                <button
                  onClick={() => onDelete(item)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.8rem', padding: '0 0.25rem', flexShrink: 0 }}
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

// ── Add cycle item modal ──────────────────────────────────────────────────────

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

// ── Paperless fetch modal ─────────────────────────────────────────────────────

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
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              No matching documents found in Paperless-ngx for this cycle's date range.
            </p>
          ) : (
            <div className="table-container" style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ color: 'var(--text-muted)', textAlign: 'left', borderBottom: '1px solid var(--border-default)' }}>
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
                      <tr key={r.cycle_item_id} style={{ borderBottom: '1px solid var(--border-default)' }}>
                        <td style={{ padding: '0.5rem 0.5rem', fontWeight: 500 }}>{r.expense_name}</td>
                        <td style={{ padding: '0.5rem 0.5rem', textAlign: 'right', color: 'var(--text-muted)' }}>
                          {fmt(r.current_value)}
                        </td>
                        <td style={{ padding: '0.5rem 0.5rem', textAlign: 'right', fontWeight: valueChanged ? 700 : 400, color: valueChanged ? 'var(--color-brand)' : 'inherit' }}>
                          {fmt(r.proposed_value)}
                        </td>
                        <td style={{ padding: '0.5rem 0.5rem', textAlign: 'center', color: dayChanged ? 'var(--color-brand)' : 'inherit', fontWeight: dayChanged ? 700 : 400 }}>
                          {dayChanged ? `${r.current_day_of_payment} to ${r.proposed_day_of_payment}` : r.proposed_day_of_payment}
                        </td>
                        <td style={{ padding: '0.5rem 0.5rem' }}>
                          {r.documents.map((doc) => (
                            <div key={doc.id} style={{ marginBottom: '0.2rem' }}>
                              <a href={doc.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.8rem', color: 'var(--color-brand)' }}>
                                <FontAwesomeIcon icon={faFileLines} style={{ marginRight: '0.25rem' }} />
                                {doc.title}
                              </a>
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.35rem' }}>
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
            <div style={{ marginTop: '1rem', padding: '0.75rem', background: 'var(--color-warning-light)', borderRadius: 'var(--radius)', border: '1px solid var(--color-warning-border)' }}>
              <div style={{ fontWeight: 600, fontSize: '0.8rem', marginBottom: '0.25rem', color: 'var(--color-warning-text)' }}>Warnings</div>
              {warnings.map((w, i) => (
                <div key={i} style={{ fontSize: '0.8rem', color: 'var(--color-warning-text)' }}>{w}</div>
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
