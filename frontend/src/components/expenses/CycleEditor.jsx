import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { parseDecimalInput, formatNumber } from '../../utils/numbers';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faArrowLeft, faPencil, faTrash, faLock, faLockOpen, faPlus, faXmark,
  faFileArrowDown, faSpinner, faFileLines, faArrowRotateLeft,
  faReceipt, faWallet, faHandHoldingDollar, faMoneyBillWave, faSackDollar, faPiggyBank,
  faCircleCheck, faClock, faCalendarDays, faLeaf, faBuildingColumns,
} from '@fortawesome/free-solid-svg-icons';
import { api } from '../../services/api';
import ConfirmModal from '../ConfirmModal';
import Checkbox from '../ui/Checkbox';
import Toast from '../ui/Toast';
import KpiBlock from '../ui/KpiBlock';
import KpiStrip from '../ui/KpiStrip';
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
  const formatted = formatNumber(v, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return formatted + ' €';
}

function cycleDateRange(year, month, startDay) {
  const start = new Date(year, month - 1, startDay);
  const end = new Date(year, month, startDay - 1);
  const fmtDate = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${fmtDate(start)} – ${fmtDate(end)}`;
}

function groupAccounts(accounts) {
  const groups = new Map();
  for (const a of accounts) {
    if (!groups.has(a.group_name)) groups.set(a.group_name, []);
    groups.get(a.group_name).push(a);
  }
  return [...groups.entries()];
}

// Accounts selectable for a transfer link: must allow transfers, except the
// item's current account, kept visible even if it was disabled afterward.
function transferableAccounts(accounts, currentAccountId) {
  return accounts.filter((a) => a.can_receive_transfers || a.id === currentAccountId);
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

// ── Transfer per account summary ──────────────────────────────────────────────

function TransferPerAccountSection({ distributionsByAccount, accountsById, collapsed, onToggle }) {
  const rows = distributionsByAccount
    .map((row) => {
      const account = row.account_id != null ? accountsById.get(row.account_id) : null;
      const name = account ? `${account.group_name} — ${account.name}` : 'Unassigned';
      return { ...row, name };
    })
    .filter((row) => row.total > 0)
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  if (rows.length === 0) return null;

  return (
    <CollapsibleSection
      title="Transfer per Account"
      icon={faBuildingColumns}
      accent="var(--color-brand)"
      count={rows.length}
      collapsed={collapsed}
      onToggle={onToggle}
      noPad
    >
      {rows.map((row) => (
        <div key={row.account_id ?? 'unassigned'} className="kpi-strip-row">
          <span className="kpi-strip-row-label">{row.name}</span>
          <span className="kpi-strip-row-value">{fmt(row.total)}</span>
        </div>
      ))}
    </CollapsibleSection>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function CycleEditor() {
  const { id: dossierId, cycleId } = useParams();
  const navigate = useNavigate();

  const [cycle, setCycle] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [activeTab, setActiveTab] = useState('expenses');
  const [error, setError] = useState('');

  const [showEditIncome, setShowEditIncome] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [showEditFinalBalance, setShowEditFinalBalance] = useState(false);


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
  const [budgetsCollapsed, setBudgetsCollapsed] = useState(false);
  const [distributionsCollapsed, setDistributionsCollapsed] = useState(true);
  const [transferCollapsed, setTransferCollapsed] = useState(false);

  // Toast
  const [toast, setToast] = useState({ msg: '', show: false });
  const toastTimer = useRef(null);

  function showToast(msg) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, show: true });
    toastTimer.current = setTimeout(() => setToast((t) => ({ ...t, show: false })), 2000);
  }

  useEffect(() => {
    window.scrollTo(0, 0);
    load();
    api.getDossierSettings(dossierId).then(setPaperlessSettings).catch(() => {});
    api.getAccounts(dossierId, true).then(setAccounts).catch(() => {});
    return () => { if (toastTimer.current) clearTimeout(toastTimer.current); };
  }, [cycleId]);

  async function load() {
    try {
      const data = await api.getCycle(dossierId, cycleId);
      setCycle(data);
    } catch (err) {
      setError(err.message);
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

  async function handleUpdateFinalBalance(bal) {
    await api.updateCycle(dossierId, cycleId, { final_real_balance: bal });
    await load();
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

  function handlePullAnnualExpenses() {
    setConfirmState({
      title: 'Pull annual expenses',
      message: `This will import any annual expense installments that fall within this cycle's date range (${cycleDateRange(cycle.year, cycle.month, cycle.cycle_start_day ?? 25)}) into the Fixed Expenses list.\n\nItems already imported will not be duplicated. New items will appear as unpaid fixed expenses.`,
      confirmLabel: 'Pull',
      onConfirm: async () => {
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
      },
    });
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
  const accountsById = new Map(accounts.map((a) => [a.id, a]));
  const { summary } = cycle;
  const expectedCurrentBalance = summary.total_available - summary.total_expenses_paid - summary.total_distributions_done;

  const fixedExpenses = expenses.filter((e) => e.type === 'Fixed');
  const budgetExpenses = expenses.filter((e) => e.type === 'Budget');
  const paidFixed = fixedExpenses.filter((e) => e.paid).length;
  const doneDist = distributions.filter((d) => d.done).length;

  return (
    <div className="page-fade-in">
      {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      {/* ── Header ── */}
      <div className="page-header">
        <button className="btn-ghost" onClick={() => navigate(`/dossiers/${dossierId}`, { state: { tab: 'expenses' } })}>
          <FontAwesomeIcon icon={faArrowLeft} />
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h1 style={{ margin: 0 }}>{cycleLabel(cycle.year, cycle.month, cycle.cycle_start_day ?? 25)} Cycle</h1>
            <FontAwesomeIcon
              icon={!!cycle.is_closed ? faLock : faLockOpen}
              style={{ fontSize: 14, color: !!cycle.is_closed ? 'var(--text-primary)' : 'var(--color-success)' }}
            />
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 'var(--space-1)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <FontAwesomeIcon icon={faClock} style={{ fontSize: 10 }} />
            {cycleDateRange(cycle.year, cycle.month, cycle.cycle_start_day ?? 25)}
          </div>
        </div>
      </div>

      {/* ── Action toolbar ── */}
      <div className="cycle-toolbar">
        <div className="cycle-toolbar-group">
          <button className="cycle-toolbar-btn btn-secondary" onClick={() => setShowEditPeriod(true)}>
            <FontAwesomeIcon icon={faCalendarDays} /><span className="cycle-toolbar-label">Period</span>
          </button>
          <button className="cycle-toolbar-btn btn-secondary" onClick={() => setShowEditIncome(true)}>
            <FontAwesomeIcon icon={faMoneyBillWave} /><span className="cycle-toolbar-label">Income</span>
          </button>
          <button className="cycle-toolbar-btn btn-secondary" onClick={handlePullAnnualExpenses} disabled={pullingAnnual}>
            <FontAwesomeIcon icon={faFileArrowDown} /><span className="cycle-toolbar-label">{pullingAnnual ? 'Pulling…' : 'Pull annual'}</span>
          </button>
          {paperlessActive && (
            <button className="cycle-toolbar-btn btn-secondary" onClick={handleFetchPaperless} disabled={fetchingPaperless}>
              <FontAwesomeIcon icon={fetchingPaperless ? faSpinner : faLeaf} spin={fetchingPaperless} />
              <span className="cycle-toolbar-label">{fetchingPaperless ? 'Fetching…' : 'Paperless'}</span>
            </button>
          )}
        </div>
        <div className="cycle-toolbar-group">
          <button
            className={`cycle-toolbar-btn ${!!cycle.is_closed ? 'btn-secondary' : 'btn-warning'}`}
            onClick={!!cycle.is_closed ? handleReopen : () => setShowCloseModal(true)}
          >
            <FontAwesomeIcon icon={!!cycle.is_closed ? faLockOpen : faLock} />
            <span className="cycle-toolbar-label">{!!cycle.is_closed ? 'Reopen' : 'Close'}</span>
          </button>
          <button className="cycle-toolbar-btn btn-danger" onClick={handleDeleteCycle}>
            <FontAwesomeIcon icon={faTrash} /><span className="cycle-toolbar-label">Delete</span>
          </button>
        </div>
      </div>

      {showEditIncome && (
        <EditIncomeModal
          cycle={cycle}
          onSave={async (salary, prevBalance) => {
            await api.updateCycle(dossierId, cycleId, { salary, previous_balance: prevBalance });
            await load();
            setShowEditIncome(false);
          }}
          onClose={() => setShowEditIncome(false)}
        />
      )}

      {showCloseModal && (
        <CloseCycleModal
          expectedBalance={summary.expected_balance}
          initialBalance={cycle.final_real_balance != null ? String(cycle.final_real_balance) : ''}
          onClose={() => setShowCloseModal(false)}
          onConfirm={async (bal) => {
            await api.updateCycle(dossierId, cycleId, { is_closed: true, final_real_balance: bal });
            await load();
            setShowCloseModal(false);
            showToast('Cycle closed');
          }}
        />
      )}

      {/* ── Summary KPIs ── */}
      <div className="cycle-editor-summary" style={{ marginBottom: '1rem' }}>
        <KpiStrip style={{ marginBottom: cycle.is_closed ? '0.75rem' : 0 }} items={[
          { label: 'Salary', value: fmt(cycle.salary), icon: faMoneyBillWave },
          { label: 'Prev. bal.', value: fmt(cycle.previous_balance), icon: faWallet },
          { label: 'Available', value: fmt(summary.total_available), icon: faSackDollar },
          { label: 'Expenses', value: fmt(summary.total_expenses), icon: faReceipt, highlight: 'danger' },
          { label: 'Paid', value: fmt(summary.total_expenses_paid), icon: faCircleCheck, highlight: 'success' },
          { label: 'Unpaid', value: fmt(summary.total_expenses_unpaid), icon: faClock, highlight: summary.total_expenses_unpaid > 0 ? 'warning' : 'neutral' },
          { label: 'Curr. balance', value: fmt(expectedCurrentBalance), icon: faWallet, highlight: expectedCurrentBalance < 0 ? 'danger' : 'success', large: true },
          { label: 'Exp. balance', value: fmt(summary.expected_balance), icon: faPiggyBank, highlight: summary.expected_balance < 0 ? 'danger' : 'success' },
        ]} />

        {/* Closed: show final balance and difference */}
        {!!cycle.is_closed && (
          <div style={{ display: 'flex', gap: '1rem', marginTop: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
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
            <button
              onClick={() => setShowEditFinalBalance(true)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.9rem', padding: '0.25rem' }}
              title="Update final balance"
            >
              <FontAwesomeIcon icon={faPencil} />
            </button>
          </div>
        )}
        {showEditFinalBalance && (
          <EditFinalBalanceModal
            expectedBalance={summary.expected_balance}
            currentBalance={cycle.final_real_balance}
            onSave={async (bal) => { await handleUpdateFinalBalance(bal); setShowEditFinalBalance(false); }}
            onClose={() => setShowEditFinalBalance(false)}
          />
        )}
      </div>

      {/* ── Desktop two-column layout ── */}
      <div className="cycle-editor-columns">
        {/* LEFT: expenses + close form (if open cycle) */}
        <div className="cycle-editor-left">

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
            <CollapsibleSection
              title="Budgets"
              icon={faWallet}
              accent="var(--color-warning)"
              count={`${budgetExpenses.filter((e) => e.spent >= e.value).length}/${budgetExpenses.length}`}
              collapsed={budgetsCollapsed}
              onToggle={() => setBudgetsCollapsed((v) => !v)}
            >
              <BudgetExpensesList
                expenses={budgetExpenses}
                onUpdateSpent={handleUpdateSpent}
                onDelete={handleDeleteItem}
                onEdit={handleEditItem}
              />
            </CollapsibleSection>
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
              accounts={accounts}
              accountsById={accountsById}
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

        </div>
      </div>

      <TransferPerAccountSection
        distributionsByAccount={summary.distributions_by_account ?? []}
        accountsById={accountsById}
        collapsed={transferCollapsed}
        onToggle={() => setTransferCollapsed((v) => !v)}
      />

      {/* ── Modals ── */}
      {showAddModal && (
        <AddCycleItemModal
          section={activeTab === 'expenses' ? 'expense' : 'distribution'}
          accounts={accounts}
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
      {/* Spacer so fixed bottom toolbar doesn't overlap last section on mobile */}
      <div className="cycle-toolbar-spacer" />
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

// ── Close cycle modal ─────────────────────────────────────────────────────────

function CloseCycleModal({ expectedBalance, initialBalance, onConfirm, onClose }) {
  const [balance, setBalance] = useState(initialBalance ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const diff = balance !== '' && !isNaN(parseDecimalInput(balance))
    ? parseDecimalInput(balance) - expectedBalance
    : null;

  async function handleSubmit(e) {
    e.preventDefault();
    const bal = parseDecimalInput(balance);
    if (isNaN(bal)) { setError('Enter a valid number'); return; }
    setError('');
    setSaving(true);
    try {
      await onConfirm(bal);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Close Cycle</h2>
          <button className="close-btn" onClick={onClose}><FontAwesomeIcon icon={faXmark} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="alert alert-error">{error}</div>}
            <div className="form-group">
              <label>Final real balance (€)</label>
              <input
                type="text" inputMode="decimal"
                value={balance}
                onChange={(e) => setBalance(e.target.value)}
                placeholder="0.00"
                autoFocus
              />
            </div>
            {diff !== null && (
              <div style={{
                padding: '10px 14px',
                borderRadius: 'var(--radius)',
                background: diff >= 0 ? 'var(--color-success-light)' : 'var(--color-danger-light)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Difference vs expected</span>
                <span style={{
                  fontSize: 15, fontWeight: 800,
                  color: diff >= 0 ? 'var(--color-success)' : 'var(--color-danger)',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {diff >= 0 ? '+' : ''}{formatNumber(diff, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
                </span>
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              <FontAwesomeIcon icon={faLock} style={{ marginRight: '0.35rem' }} />
              {saving ? 'Closing…' : 'Confirm close'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Income edit modal ─────────────────────────────────────────────────────────

function EditIncomeModal({ cycle, onSave, onClose }) {
  const [salary, setSalary] = useState(String(cycle.salary));
  const [prevBalance, setPrevBalance] = useState(String(cycle.previous_balance));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await onSave(parseDecimalInput(salary), parseDecimalInput(prevBalance));
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Edit Income</h2>
          <button className="close-btn" onClick={onClose}><FontAwesomeIcon icon={faXmark} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="alert alert-error">{error}</div>}
            <div className="form-group">
              <label>Salary received (€)</label>
              <input type="text" inputMode="decimal" value={salary} onChange={(e) => setSalary(e.target.value)} autoFocus />
            </div>
            <div className="form-group">
              <label>Previous balance (€)</label>
              <input type="text" inputMode="decimal" value={prevBalance} onChange={(e) => setPrevBalance(e.target.value)} />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Fixed Expenses list ───────────────────────────────────────────────────────

function ExpensesList({ expenses, annualPayments = [], cycleStartDay = 25, paperlessActive, onTogglePaid, onUpdateSpent, onDelete, onEdit, dossierId, onAnnualPaymentUpdated, onAnnualDelete, onAnnualEdit, onlyFixed }) {
  const [editingItem, setEditingItem] = useState(null);

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
                borderLeft: p.paid ? '3px solid var(--color-success)' : undefined,
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
              opacity: isPaid ? 0.5 : 1,
              transition: 'opacity 0.25s ease',
              borderLeft: isPaid ? '3px solid var(--color-success)' : undefined,
            }}
          >
            {item.type === 'Fixed' && (
              <Checkbox
                checked={!!item.paid}
                onChange={() => onTogglePaid(item)}
                title={item.paid ? 'Mark as unpaid' : 'Mark as paid'}
              />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{
                fontWeight: 500,
                textDecoration: isPaid ? 'line-through' : 'none',
                color: isPaid ? 'var(--text-muted)' : 'var(--text-primary)',
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
              {item.exclude_from_emergency_fund === 1 && (
                <span
                  title="Excluded from emergency fund average (set on the template)"
                  style={{
                    marginLeft: '0.4rem',
                    fontSize: '0.65rem',
                    padding: '0.1rem 0.4rem',
                    borderRadius: '999px',
                    background: 'var(--bg-muted, var(--bg-card))',
                    color: 'var(--text-muted)',
                    border: '1px solid var(--border-default)',
                    fontWeight: 500,
                    verticalAlign: 'middle',
                    whiteSpace: 'nowrap',
                  }}
                >
                  EF excluded
                </span>
              )}
              {item.type === 'Fixed' && item.day_of_payment != null && (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
                  <FontAwesomeIcon icon={faClock} style={{ fontSize: '0.65rem', marginRight: 2 }} />
                  day {item.day_of_payment}
                </span>
              )}
            </div>
            <span style={{ fontSize: '0.875rem', fontWeight: 500, color: isPaid ? 'var(--text-muted)' : 'var(--text-primary)', transition: 'color 0.25s ease' }}>
              {fmt(item.value)}
            </span>
            <button
              onClick={() => setEditingItem(item)}
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
          </div>
        );
      })}
      {editingItem && !editingItem._annual && (
        <EditExpenseItemModal
          item={editingItem}
          paperlessActive={paperlessActive}
          onSave={async (data) => { await onEdit(editingItem, data); setEditingItem(null); }}
          onClose={() => setEditingItem(null)}
        />
      )}
    </div>
  );
}

// ── Budget Expenses list ──────────────────────────────────────────────────────

function BudgetExpensesList({ expenses, onUpdateSpent, onDelete, onEdit }) {
  const [editingItem, setEditingItem] = useState(null);

  if (expenses.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {expenses.map((item) => {
        const spent = item.spent ?? 0;
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
              <span style={{ fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.4rem' }}>
                {item.name}
                {item.exclude_from_emergency_fund === 1 && (
                  <span
                    title="Excluded from emergency fund average (set on the template)"
                    style={{
                      fontSize: '0.65rem',
                      padding: '0.1rem 0.4rem',
                      borderRadius: '999px',
                      background: 'var(--bg-muted, var(--bg-card))',
                      color: 'var(--text-muted)',
                      border: '1px solid var(--border-default)',
                      fontWeight: 500,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    EF excluded
                  </span>
                )}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: barColor, fontVariantNumeric: 'tabular-nums' }}>
                  {Math.round(pct)}%
                </span>
                <button
                  onClick={() => setEditingItem(item)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.8rem', padding: '0 0.2rem' }}
                  title="Edit"
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
              </div>
            </div>
            <BudgetBar spent={spent} max={item.value} />
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
              {fmt(spent)} / {fmt(item.value)}
            </div>
          </div>
        );
      })}
      {editingItem && (
        <EditBudgetItemModal
          item={editingItem}
          onSave={async (data) => { await onEdit(editingItem, data); setEditingItem(null); }}
          onClose={() => setEditingItem(null)}
        />
      )}
    </div>
  );
}

// ── Distributions list ────────────────────────────────────────────────────────

function DistributionsList({ distributions, accounts, accountsById, onToggleDone, onDelete, onEdit }) {
  const [editingItem, setEditingItem] = useState(null);

  if (distributions.length === 0) {
    return <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', margin: 0 }}>No distributions yet.</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      {distributions.map((item) => {
        const account = item.account_id != null ? accountsById.get(item.account_id) : null;
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
            opacity: item.done ? 0.5 : 1,
            transition: 'opacity 0.25s ease',
            borderLeft: item.done ? '3px solid var(--color-brand)' : undefined,
          }}
        >
          <Checkbox
            checked={!!item.done}
            onChange={() => onToggleDone(item)}
            title={item.done ? 'Mark as not done' : 'Mark as done'}
            style={{ '--checkbox-color': 'var(--color-brand)' }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{
              fontWeight: 500,
              textDecoration: item.done ? 'line-through' : 'none',
              color: item.done ? 'var(--text-muted)' : 'var(--text-primary)',
              transition: 'color 0.25s ease',
            }}>
              {item.name}
            </span>
            {account && (
              <span
                title={`Funded from ${account.group_name} — ${account.name}`}
                style={{
                  marginLeft: '0.4rem',
                  fontSize: '0.65rem',
                  padding: '0.1rem 0.4rem',
                  borderRadius: '999px',
                  background: 'var(--bg-muted, var(--bg-card))',
                  color: 'var(--text-muted)',
                  border: '1px solid var(--border-default)',
                  fontWeight: 500,
                  verticalAlign: 'middle',
                  whiteSpace: 'nowrap',
                }}
              >
                {account.name}
              </span>
            )}
          </div>
          <span style={{
            fontSize: '0.875rem',
            fontWeight: 500,
            color: item.done ? 'var(--text-muted)' : 'var(--text-primary)',
            transition: 'color 0.25s ease',
            fontVariantNumeric: 'tabular-nums',
          }}>{fmt(item.value)}</span>
          <button
            onClick={() => setEditingItem(item)}
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
        </div>
        );
      })}
      {editingItem && (
        <EditDistributionModal
          item={editingItem}
          accounts={accounts}
          onSave={async (data) => { await onEdit(editingItem, data); setEditingItem(null); }}
          onClose={() => setEditingItem(null)}
        />
      )}
    </div>
  );
}

// ── Add cycle item modal ──────────────────────────────────────────────────────

function AddCycleItemModal({ section, accounts = [], onSave, onClose }) {
  const [name, setName] = useState('');
  const [type, setType] = useState('Fixed');
  const [value, setValue] = useState('');
  const [dayOfPayment, setDayOfPayment] = useState('');
  const [accountId, setAccountId] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!name.trim()) { setError('Name is required'); return; }
    const numValue = parseDecimalInput(value);
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
      } else {
        data.account_id = accountId || null;
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
              <input type="text" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0.00" />
            </div>
            {section === 'expense' && type === 'Fixed' && (
              <div className="form-group">
                <label>Day of payment (1–31)</label>
                <input type="number" inputMode="numeric" step="1" min={1} max={31} value={dayOfPayment} onChange={(e) => setDayOfPayment(e.target.value.replace(/[^0-9]/g, ''))} placeholder="e.g. 5" />
              </div>
            )}
            {section === 'distribution' && (
              <div className="form-group">
                <label>Account</label>
                <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  <option value="">— None —</option>
                  {groupAccounts(transferableAccounts(accounts, null)).map(([groupName, accs]) => (
                    <optgroup key={groupName} label={groupName}>
                      {accs.map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
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

// ── Edit expense item modal ───────────────────────────────────────────────────

function EditExpenseItemModal({ item, paperlessActive, onSave, onClose }) {
  const [value, setValue] = useState(String(item.value));
  const [day, setDay] = useState(String(item.day_of_payment ?? ''));
  const [tagId, setTagId] = useState(String(item.paperless_tag_id ?? ''));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    const numValue = parseDecimalInput(value);
    if (isNaN(numValue) || numValue < 0) { setError('Value must be a non-negative number'); return; }
    const numDay = Number(day);
    if (!Number.isInteger(numDay) || numDay < 1 || numDay > 31) { setError('Day of payment must be 1–31'); return; }
    setSaving(true);
    try {
      const data = { value: numValue, day_of_payment: numDay };
      if (paperlessActive) data.paperless_tag_id = tagId !== '' ? Number(tagId) : null;
      await onSave(data);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Edit Expense</h2>
          <button className="close-btn" onClick={onClose}><FontAwesomeIcon icon={faXmark} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="alert alert-error">{error}</div>}
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, fontWeight: 600 }}>{item.name}</div>
            <div className="form-group">
              <label>Value (€)</label>
              <input type="text" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
            </div>
            <div className="form-group">
              <label>Day of payment (1–31)</label>
              <input type="number" inputMode="numeric" step="1" min={1} max={31} value={day} onChange={(e) => setDay(e.target.value.replace(/[^0-9]/g, ''))} />
            </div>
            {paperlessActive && (
              <div className="form-group">
                <label>Paperless tag ID (optional)</label>
                <input type="number" inputMode="numeric" min={1} value={tagId} onChange={(e) => setTagId(e.target.value)} placeholder="leave blank to unlink" />
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

// ── Edit budget item modal ────────────────────────────────────────────────────

function EditBudgetItemModal({ item, onSave, onClose }) {
  const [maxValue, setMaxValue] = useState(String(item.value));
  const [spent, setSpent] = useState(String(item.spent ?? 0));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    const numMax = parseDecimalInput(maxValue);
    const numSpent = parseDecimalInput(spent);
    if (isNaN(numMax) || numMax < 0) { setError('Maximum must be a non-negative number'); return; }
    if (isNaN(numSpent) || numSpent < 0) { setError('Spent must be a non-negative number'); return; }
    setSaving(true);
    try {
      await onSave({ value: numMax, spent: numSpent });
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Edit Budget</h2>
          <button className="close-btn" onClick={onClose}><FontAwesomeIcon icon={faXmark} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="alert alert-error">{error}</div>}
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, fontWeight: 600 }}>{item.name}</div>
            <div className="form-group">
              <label>Maximum (€)</label>
              <input type="text" inputMode="decimal" value={maxValue} onChange={(e) => setMaxValue(e.target.value)} autoFocus />
            </div>
            <div className="form-group">
              <label>Spent (€)</label>
              <input type="text" inputMode="decimal" value={spent} onChange={(e) => setSpent(e.target.value)} />
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

// ── Edit distribution modal ───────────────────────────────────────────────────

function EditDistributionModal({ item, accounts = [], onSave, onClose }) {
  const [value, setValue] = useState(String(item.value));
  const [accountId, setAccountId] = useState(item.account_id ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    const numValue = parseDecimalInput(value);
    if (isNaN(numValue) || numValue < 0) { setError('Value must be a non-negative number'); return; }
    setSaving(true);
    try {
      await onSave({ value: numValue, account_id: accountId || null });
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Edit Distribution</h2>
          <button className="close-btn" onClick={onClose}><FontAwesomeIcon icon={faXmark} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="alert alert-error">{error}</div>}
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, fontWeight: 600 }}>{item.name}</div>
            <div className="form-group">
              <label>Amount (€)</label>
              <input type="text" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
            </div>
            <div className="form-group">
              <label>Account</label>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">— None —</option>
                {groupAccounts(transferableAccounts(accounts, item.account_id)).map(([groupName, accs]) => (
                  <optgroup key={groupName} label={groupName}>
                    {accs.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
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

// ── Edit final balance modal ──────────────────────────────────────────────────

function EditFinalBalanceModal({ expectedBalance, currentBalance, onSave, onClose }) {
  const [balance, setBalance] = useState(currentBalance != null ? String(currentBalance) : '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const diff = balance !== '' && !isNaN(parseDecimalInput(balance))
    ? parseDecimalInput(balance) - expectedBalance
    : null;

  async function handleSubmit(e) {
    e.preventDefault();
    const bal = parseDecimalInput(balance);
    if (isNaN(bal)) { setError('Enter a valid number'); return; }
    setError('');
    setSaving(true);
    try {
      await onSave(bal);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Update Final Balance</h2>
          <button className="close-btn" onClick={onClose}><FontAwesomeIcon icon={faXmark} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="alert alert-error">{error}</div>}
            <div className="form-group">
              <label>Final real balance (€)</label>
              <input
                type="text" inputMode="decimal"
                value={balance}
                onChange={(e) => setBalance(e.target.value)}
                placeholder="0.00"
                autoFocus
              />
            </div>
            {diff !== null && (
              <div style={{
                padding: '10px 14px',
                borderRadius: 'var(--radius)',
                background: diff >= 0 ? 'var(--color-success-light)' : 'var(--color-danger-light)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Difference vs expected</span>
                <span style={{
                  fontSize: 15, fontWeight: 800,
                  color: diff >= 0 ? 'var(--color-success)' : 'var(--color-danger)',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {diff >= 0 ? '+' : ''}{formatNumber(diff, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
                </span>
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
