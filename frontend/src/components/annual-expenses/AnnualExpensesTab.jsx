import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faPlus, faPencil, faTrash, faXmark, faChevronDown, faChevronRight,
  faFileArrowDown, faFileArrowUp, faBuildingColumns, faHandHoldingDollar,
} from '@fortawesome/free-solid-svg-icons';
import { api } from '../../services/api';
import ConfirmModal from '../ConfirmModal';
import Checkbox from '../ui/Checkbox';
import KpiStrip from '../ui/KpiStrip';
import { parseDecimalInput, formatNumber } from '../../utils/numbers';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function fmt(v) {
  if (v == null) return '—';
  return formatNumber(v, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

// Returns the number of cycles in `calendarYear` whose start date is still in the future.
// A cycle displayed as display-month M (0=Jan) of calendarYear starts on cycleStartDay of
// the *previous* calendar month: new Date(calendarYear, M - 1, cycleStartDay).
function cyclesRemainingInYear(calendarYear, cycleStartDay) {
  const today = new Date();
  let count = 0;
  for (let displayMonth = 0; displayMonth < 12; displayMonth++) {
    const cycleStart = new Date(calendarYear, displayMonth - 1, cycleStartDay);
    if (cycleStart > today) count++;
  }
  return count;
}

function StatRow({ label, value, valueStyle }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border-default)' }}>
      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', ...valueStyle }}>{value}</span>
    </div>
  );
}

// Modal for add/edit year item
export function ItemFormModal({ dossierId, yearId, item, onSave, onClose }) {
  const numInstDefault = item ? item.num_installments : 1;
  const [name, setName] = useState(item?.name ?? '');
  const [value, setValue] = useState(item ? String(item.budgeted_value) : '');
  const [classification, setClassification] = useState(item?.classification ?? '');
  const [numInst, setNumInst] = useState(numInstDefault);
  const [installments, setInstallments] = useState(() => {
    if (item?.installments?.length) {
      return item.installments.map((i) => ({ installment_number: i.installment_number, month: i.month, day: i.day }));
    }
    return [{ installment_number: 1, month: 1, day: 1 }];
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function handleNumInstChange(n) {
    const newNum = Math.max(1, Math.floor(Number(n)) || 1);
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
    setInstallments((prev) => prev.map((inst, i) => i === idx ? { ...inst, [field]: Math.floor(Number(val)) || 0 } : inst));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const v = parseDecimalInput(value);
    if (!name.trim() || isNaN(v) || v < 0) { setError('Please fill all fields correctly.'); return; }
    setSaving(true);
    try {
      const payload = { name: name.trim(), budgeted_value: v, classification: classification || null, num_installments: numInst, installments };
      let result;
      if (item) {
        result = await api.updateAnnualYearItem(dossierId, yearId, item.id, payload);
      } else {
        result = await api.createAnnualYearItem(dossierId, yearId, payload);
      }
      onSave(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const expectedPerInst = numInst > 0 && value ? fmt(parseDecimalInput(value) / numInst) : '—';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 540 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{item ? 'Edit Expense' : 'Add Expense'}</h2>
          <button className="close-btn" onClick={onClose}><FontAwesomeIcon icon={faXmark} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}
            <div className="form-group">
              <label>Name</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Car Insurance" required />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label>Annual value</label>
                <input type="text" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0.00" required />
              </div>
              <div className="form-group">
                <label>Classification</label>
                <select value={classification} onChange={(e) => setClassification(e.target.value)}>
                  <option value="">—</option>
                  <option value="must">Must</option>
                  <option value="want">Want</option>
                </select>
              </div>
              <div className="form-group">
                <label>Installments</label>
                <input type="number" inputMode="numeric" step="1" value={numInst} onChange={(e) => handleNumInstChange(e.target.value.replace(/[^0-9]/g, ''))} min="1" max="12" />
              </div>
            </div>
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                Expected per installment: <strong>{expectedPerInst}</strong>
              </div>
              {installments.map((inst, idx) => (
                <div key={idx} style={{ display: 'grid', gridTemplateColumns: '40px 1fr 1fr', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>#{idx + 1}</span>
                  <div className="form-group" style={{ margin: 0 }}>
                    <select value={inst.month} onChange={(e) => setInstField(idx, 'month', e.target.value)}>
                      {MONTH_NAMES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                    </select>
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <input type="number" inputMode="numeric" step="1" value={inst.day} onChange={(e) => setInstField(idx, 'day', e.target.value.replace(/[^0-9]/g, ''))} placeholder="Day" min="1" max="31" />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : item ? 'Save' : 'Add'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function AnnualExpensesTab({ dossierId }) {
  const navigate = useNavigate();
  const currentYear = new Date().getFullYear();

  const [years, setYears] = useState([]);
  const [selectedYearId, setSelectedYearId] = useState(null);
  const [yearData, setYearData] = useState(null);
  const [allAccounts, setAllAccounts] = useState([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState([]);
  const [distributionTemplate, setDistributionTemplate] = useState([]);
  const [selectedDistIds, setSelectedDistIds] = useState([]);
  const [cycleStartDay, setCycleStartDay] = useState(25);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmState, setConfirmState] = useState(null);

  // UI state
  const [expandedItems, setExpandedItems] = useState({});
  const [showCarryoverModal, setShowCarryoverModal] = useState(false);
  const [showOtherYearModal, setShowOtherYearModal] = useState(false);
  const [itemModal, setItemModal] = useState(null); // null | {} | item
  const [showAccountPicker, setShowAccountPicker] = useState(false);
  const [pickerAccountSelection, setPickerAccountSelection] = useState([]);
  const [showDistPicker, setShowDistPicker] = useState(false);
  const [pickerDistSelection, setPickerDistSelection] = useState([]);

  const loadYears = useCallback(async () => {
    try {
      const [yrs, accs, selAccs, tmpl, selDists, settings] = await Promise.all([
        api.getAnnualYears(dossierId),
        api.getAccounts(dossierId, false),
        api.getAnnualExpenseAccounts(dossierId),
        api.getExpenseTemplate(dossierId),
        api.getAnnualExpenseDistributions(dossierId),
        api.getDossierSettings(dossierId),
      ]);
      setYears(yrs);
      setAllAccounts(accs);
      setSelectedAccountIds(selAccs);
      setDistributionTemplate(tmpl.filter((i) => i.section === 'distribution'));
      setSelectedDistIds(selDists);
      setCycleStartDay(settings.cycle_start_day ?? 25);
      return yrs;
    } catch (e) {
      setError(e.message);
      return [];
    }
  }, [dossierId]);

  const loadYearData = useCallback(async (yearId) => {
    if (!yearId) { setYearData(null); return; }
    try {
      const data = await api.getAnnualYear(dossierId, yearId);
      setYearData(data);
    } catch (e) {
      setError(e.message);
    }
  }, [dossierId]);

  useEffect(() => {
    setLoading(true);
    loadYears().then((yrs) => {
      // Auto-select current year if it exists, otherwise the most recent
      const curYr = yrs.find((y) => y.year === currentYear);
      const toSelect = curYr ? curYr.id : (yrs[0]?.id ?? null);
      setSelectedYearId(toSelect);
    }).finally(() => setLoading(false));
  }, [dossierId]);

  useEffect(() => {
    loadYearData(selectedYearId);
  }, [selectedYearId, loadYearData]);

  async function handleCreateYear(year) {
    try {
      const result = await api.createAnnualYear(dossierId, year);
      const yrs = await loadYears();
      const newYr = yrs.find((y) => y.year === year);
      if (newYr) setSelectedYearId(newYr.id);
      setYearData(result);
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDeleteYear() {
    if (!selectedYearId) return;
    const yr = years.find((y) => y.id === selectedYearId);
    setConfirmState({
      title: `Delete year ${yr?.year}`,
      message: `This will permanently delete the annual expense year ${yr?.year}, all its items, installments, and all payment records linked to those installments (even in cycles). This cannot be undone.`,
      confirmLabel: 'Delete year',
      danger: true,
      onConfirm: async () => {
        await api.deleteAnnualYear(dossierId, selectedYearId);
        const yrs = await loadYears();
        const toSelect = yrs[0]?.id ?? null;
        setSelectedYearId(toSelect);
        setYearData(null);
      },
    });
  }

  async function handleSyncFromTemplate() {
    setConfirmState({
      title: 'Sync from template',
      message: 'This will replace all template-derived items with current template values, and delete their payment records. Ad-hoc items are preserved. Continue?',
      confirmLabel: 'Sync',
      danger: false,
      onConfirm: async () => {
        const result = await api.syncAnnualYearFromTemplate(dossierId, selectedYearId);
        setYearData(result);
      },
    });
  }

  async function handleSyncToTemplate() {
    setConfirmState({
      title: 'Sync to template',
      message: 'This will replace the entire annual expense template with the items in this year. Continue?',
      confirmLabel: 'Sync to template',
      danger: true,
      onConfirm: async () => {
        await api.syncAnnualYearToTemplate(dossierId, selectedYearId);
        setError('');
      },
    });
  }

  async function handleSaveCarryover(v) {
    try {
      const result = await api.updateAnnualYear(dossierId, selectedYearId, { carryover: v });
      setYearData(result);
      setShowCarryoverModal(false);
    } catch (e) {
      setError(e.message);
    }
  }

  function handleItemSaved(updatedYearData) {
    setYearData(updatedYearData);
    setItemModal(null);
  }

  function handleDeleteItem(item) {
    setConfirmState({
      title: 'Delete expense',
      message: `Delete "${item.name}" and all its installments and payment records?`,
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: async () => {
        const result = await api.deleteAnnualYearItem(dossierId, selectedYearId, item.id);
        setYearData(result);
      },
    });
  }

  function toggleExpand(itemId) {
    setExpandedItems((prev) => ({ ...prev, [itemId]: !prev[itemId] }));
  }

  // Account picker
  function openAccountPicker() {
    setPickerAccountSelection([...selectedAccountIds]);
    setShowAccountPicker(true);
  }

  async function saveAccountSelection() {
    try {
      const saved = await api.setAnnualExpenseAccounts(dossierId, pickerAccountSelection);
      setSelectedAccountIds(saved);
      setShowAccountPicker(false);
      await loadYearData(selectedYearId);
    } catch (e) { setError(e.message); }
  }

  // Distribution picker
  function openDistPicker() {
    setPickerDistSelection([...selectedDistIds]);
    setShowDistPicker(true);
  }

  async function saveDistSelection() {
    try {
      const saved = await api.setAnnualExpenseDistributions(dossierId, pickerDistSelection);
      setSelectedDistIds(saved);
      setShowDistPicker(false);
      await loadYearData(selectedYearId);
    } catch (e) { setError(e.message); }
  }

  if (loading) return <div className="loading">Loading…</div>;

  const selectedYear = years.find((y) => y.id === selectedYearId);
  const hasCurrentYear = years.some((y) => y.year === currentYear);

  return (
    <div>
      {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      {/* ── Year selector ──────────────────────────────────────────────────── */}
      <div className="card card--flat" style={{ marginBottom: 'var(--space-5)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Year:</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1 }}>
            {years.map((y) => (
              <button
                key={y.id}
                className={selectedYearId === y.id ? 'btn-primary' : 'btn-secondary'}
                style={{ fontSize: 13, padding: '4px 14px' }}
                onClick={() => setSelectedYearId(y.id)}
              >
                {y.year}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {!hasCurrentYear && (
              <button className="btn-primary" style={{ fontSize: 13 }} onClick={() => handleCreateYear(currentYear)}>
                <FontAwesomeIcon icon={faPlus} style={{ marginRight: 4 }} />Open {currentYear}
              </button>
            )}
            <button className="btn-secondary" style={{ fontSize: 13 }} onClick={() => setShowOtherYearModal(true)}>
              <FontAwesomeIcon icon={faPlus} style={{ marginRight: 4 }} />Other year…
            </button>
          </div>
        </div>
      </div>

      {/* ── No year selected ────────────────────────────────────────────────── */}
      {years.length === 0 ? (
        <div className="card card--flat" style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
          <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>No annual expense year opened for {currentYear}.</p>
          <button className="btn-primary" onClick={() => handleCreateYear(currentYear)}>
            <FontAwesomeIcon icon={faPlus} style={{ marginRight: 4 }} />Open {currentYear}
          </button>
        </div>
      ) : !selectedYear ? null : (
        <>
          {/* ── Summary card ──────────────────────────────────────────────── */}
          <div className="card card--flat" style={{ marginBottom: 'var(--space-5)' }}>
            <div style={{ borderBottom: '1px solid var(--border-default)', paddingBottom: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 var(--space-3) 0' }}>{selectedYear.year} Summary</h2>
              <div className="cycle-toolbar">
                <div className="cycle-toolbar-group">
                  <button className="cycle-toolbar-btn btn-secondary" onClick={handleSyncFromTemplate}>
                    <FontAwesomeIcon icon={faFileArrowDown} /><span className="cycle-toolbar-label">From template</span>
                  </button>
                  <button className="cycle-toolbar-btn btn-secondary" onClick={handleSyncToTemplate}>
                    <FontAwesomeIcon icon={faFileArrowUp} /><span className="cycle-toolbar-label">To template</span>
                  </button>
                  <button className="cycle-toolbar-btn btn-secondary" onClick={openAccountPicker}>
                    <FontAwesomeIcon icon={faBuildingColumns} /><span className="cycle-toolbar-label">Accounts</span>
                  </button>
                  <button className="cycle-toolbar-btn btn-secondary" onClick={openDistPicker}>
                    <FontAwesomeIcon icon={faHandHoldingDollar} /><span className="cycle-toolbar-label">Distributions</span>
                  </button>
                </div>
                <div className="cycle-toolbar-group">
                  <button className="cycle-toolbar-btn btn-danger" onClick={handleDeleteYear}>
                    <FontAwesomeIcon icon={faTrash} /><span className="cycle-toolbar-label">Delete</span>
                  </button>
                </div>
              </div>
            </div>

            {yearData ? (() => {
              const monthlyDistProjected = distributionTemplate
                .filter((d) => selectedDistIds.includes(d.id))
                .reduce((sum, d) => sum + (d.value || 0), 0);
              const annualDistProjected = monthlyDistProjected * 12;
              const totalRaiseNeeded = Math.max(0, (yearData.total_budgeted || 0) - (yearData.carryover || 0));
              const amountLeftNeeded = Math.max(0, (yearData.total_remaining || 0) - (yearData.accumulated_accounts || 0));
              const cyclesLeft = cyclesRemainingInYear(yearData.year, cycleStartDay);
              const monthlyAverageNeeded = cyclesLeft > 0 ? amountLeftNeeded / cyclesLeft : amountLeftNeeded;

              // ── Goal-style progress: how close is this year to being fully funded? ──
              const raisedToDate = (yearData.accumulated_accounts || 0) + (yearData.total_paid || 0);
              const target = yearData.total_budgeted || 0;
              const fullyFunded = target === 0 || raisedToDate >= target;
              const progressPct = target > 0 ? Math.min(100, (raisedToDate / target) * 100) : 100;
              const statusLabel = fullyFunded ? 'Fully funded' : 'In progress';
              const statusVariant = fullyFunded ? 'success' : 'brand';
              const fillColor = fullyFunded ? 'var(--color-success)'
                : progressPct < 25 ? 'var(--color-danger)'
                : progressPct < 75 ? 'var(--color-warning)'
                : 'var(--color-success)';

              // ── Timeframe: Jan 1 of the year through the last installment due date ──
              const allInstallments = (yearData.items || []).flatMap((i) => i.installments || []);
              const lastInstallmentDate = allInstallments.length
                ? allInstallments.reduce((max, inst) => {
                    const d = new Date(yearData.year, inst.month - 1, inst.day);
                    return d > max ? d : max;
                  }, new Date(yearData.year, 0, 1))
                : new Date(yearData.year, 11, 31);
              const yearStart = new Date(yearData.year, 0, 1);
              const todayMidnight = new Date();
              todayMidnight.setHours(0, 0, 0, 0);
              const totalDays = Math.round((lastInstallmentDate - yearStart) / 86400000) + 1;
              const elapsedDays = Math.min(totalDays, Math.max(0, Math.round((todayMidnight - yearStart) / 86400000) + 1));
              const yearPercent = totalDays > 0 ? Math.min(100, Math.max(0, (elapsedDays / totalDays) * 100)) : 100;

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                  {/* Hero: funding status + progress bar + timeline + headline numbers */}
                  <div className="card card--flat">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
                      <span className={`badge badge-${statusVariant}`}>{statusLabel}</span>
                      <span style={{ fontSize: 13, fontWeight: 700 }}>{progressPct.toFixed(1)}%</span>
                    </div>
                    <div className="progress-track lg" style={{ marginBottom: 'var(--space-4)' }}>
                      <div className="progress-fill" style={{ width: `${progressPct}%`, background: fillColor }} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 'var(--space-4)' }}>
                      <div className="progress-track" style={{ flex: 1 }}>
                        <div className="progress-fill" style={{ width: `${yearPercent}%` }} />
                      </div>
                      <span className="text-xs tabular" style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Day {elapsedDays}/{totalDays}</span>
                    </div>
                    <div className="goal-hero-numbers">
                      <div className="goal-hero-num">
                        <div className="goal-hero-num-label">Target</div>
                        <div className="goal-hero-num-value">{fmt(target)}</div>
                      </div>
                      <div className="goal-hero-num">
                        <div className="goal-hero-num-label">Raised to date</div>
                        <div className="goal-hero-num-value">{fmt(raisedToDate)}</div>
                      </div>
                      <div className="goal-hero-num">
                        <div className="goal-hero-num-label">Remaining</div>
                        <div className="goal-hero-num-value" style={{ color: amountLeftNeeded <= 0 ? 'var(--color-success)' : 'var(--text-primary)' }}>
                          {fmt(amountLeftNeeded)}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Carryover — the one editable stat, kept standalone */}
                  <div className="card card--flat" style={{ padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="kpi-strip-row-label">Carryover</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="kpi-strip-row-value">{fmt(yearData.carryover)}</span>
                      <button className="annual-action-btn" style={{ fontSize: '0.75rem' }} onClick={() => setShowCarryoverModal(true)} title="Edit carryover">
                        <FontAwesomeIcon icon={faPencil} />
                      </button>
                    </div>
                  </div>

                  {/* Secondary KPIs */}
                  <KpiStrip defaultOpen items={[
                    { label: 'In tracked accounts', value: fmt(yearData.accumulated_accounts), note: 'Current balance, net of paid expenses' },
                    { label: 'Contributed (distributions)', value: fmt(yearData.contributed_distributions) },
                    { label: 'Total paid', value: fmt(yearData.total_paid) },
                    { label: 'Total expenses remaining', value: fmt(yearData.total_remaining), highlight: yearData.total_remaining > 0 ? 'warning' : 'success' },
                    {
                      label: 'Needed this cycle',
                      value: fmt(yearData.needed_this_cycle),
                      highlight: yearData.needed_this_cycle > 0
                        ? (yearData.accumulated_accounts >= yearData.needed_this_cycle ? 'success' : 'danger')
                        : 'success',
                      note: yearData.needed_this_cycle > 0
                        ? (yearData.accumulated_accounts >= yearData.needed_this_cycle ? 'Covered' : `Shortfall: ${fmt(yearData.needed_this_cycle - yearData.accumulated_accounts)}`)
                        : 'Nothing due this cycle',
                    },
                    {
                      label: 'Total raise needed',
                      value: fmt(totalRaiseNeeded),
                      highlight: annualDistProjected >= totalRaiseNeeded ? 'success' : 'warning',
                      note: `Distributions/yr: ${fmt(annualDistProjected)}`,
                    },
                    {
                      label: `Monthly average needed (${cyclesLeft} cycle${cyclesLeft !== 1 ? 's' : ''} left)`,
                      value: fmt(monthlyAverageNeeded),
                      highlight: monthlyDistProjected >= monthlyAverageNeeded ? 'success' : 'warning',
                      note: `Distributions/mo: ${fmt(monthlyDistProjected)}`,
                    },
                  ]} />
                </div>
              );
            })() : (
              <div className="loading">Loading year data…</div>
            )}
          </div>

          {/* ── Year items ────────────────────────────────────────────────── */}
          <div className="card card--flat">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-default)', paddingBottom: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Expenses</h2>
              <button className="btn-primary" style={{ fontSize: 13 }} onClick={() => setItemModal({})}>
                <FontAwesomeIcon icon={faPlus} style={{ marginRight: 4 }} />Add expense
              </button>
            </div>

            {!yearData || yearData.items.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No expenses defined for {selectedYear.year}. Add expenses or sync from the template.</p>
            ) : (
              yearData.items.map((item) => {
                const isSingle = item.num_installments === 1;
                const inst0 = item.installments[0];

                // Shared inline styles matching the monthly expense row
                const rowStyle = {
                  display: 'flex', alignItems: 'center', gap: '0.75rem',
                  padding: '0.6rem 0.75rem',
                  background: 'var(--color-surface)',
                  borderRadius: 'var(--radius)',
                  border: '1px solid var(--color-border)',
                };
                const iconBtnStyle = {
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--color-text-muted)', fontSize: '0.8rem',
                  padding: '0 0.25rem', flexShrink: 0,
                };

                if (isSingle) {
                  // ── Single installment: one flat row matching monthly expense style ──
                  const paid = !!inst0?.payment?.paid;
                  return (
                    <div key={item.id} style={{ ...rowStyle, opacity: paid ? 0.6 : 1, marginBottom: 4 }}>
                      <Checkbox
                        checked={paid}
                        disabled={!inst0?.payment}
                        onChange={async () => {
                          await api.updateAnnualPayment(dossierId, inst0.payment.id, { paid: !paid });
                          await loadYearData(selectedYearId);
                        }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontWeight: 500, textDecoration: paid ? 'line-through' : 'none' }}>
                          {item.name}
                        </span>
                        {inst0 && (
                          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginLeft: '0.5rem' }}>
                            {MONTH_NAMES[inst0.month - 1]} {inst0.day}
                          </span>
                        )}
                      </div>
                      <span style={{ fontSize: '0.875rem', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                        {fmt(item.budgeted_value)}
                      </span>
                      <button style={iconBtnStyle} onClick={() => setItemModal(item)} title="Edit">
                        <FontAwesomeIcon icon={faPencil} />
                      </button>
                      <button style={iconBtnStyle} onClick={() => handleDeleteItem(item)} title="Delete">
                        <FontAwesomeIcon icon={faTrash} />
                      </button>
                    </div>
                  );
                }

                // ── Multiple installments: collapsible header + installment rows ──
                const expanded = !!expandedItems[item.id];
                return (
                  <div key={item.id} style={{ marginBottom: 4 }}>
                    {/* Header row */}
                    <div style={{ ...rowStyle, cursor: 'pointer' }} onClick={() => toggleExpand(item.id)}>
                      <FontAwesomeIcon icon={expanded ? faChevronDown : faChevronRight} style={{ fontSize: 11, color: 'var(--color-text-muted)', width: 12, flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontWeight: 500 }}>{item.name}</span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginLeft: '0.5rem' }}>
                          {item.num_installments} installments
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                        <div style={{ textAlign: 'right', fontSize: 13 }}>
                          <div style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{fmt(item.budgeted_value)}</div>
                          <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{fmt(item.total_paid)} paid</div>
                        </div>
                        <div style={{ display: 'flex', gap: 2 }} onClick={(e) => e.stopPropagation()}>
                          <button style={iconBtnStyle} onClick={() => setItemModal(item)} title="Edit">
                            <FontAwesomeIcon icon={faPencil} />
                          </button>
                          <button style={iconBtnStyle} onClick={() => handleDeleteItem(item)} title="Delete">
                            <FontAwesomeIcon icon={faTrash} />
                          </button>
                        </div>
                      </div>
                    </div>
                    {/* Expanded installment rows */}
                    {expanded && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4, marginLeft: 24, animation: 'slideUp var(--transition-normal) both' }}>
                        {item.installments.map((inst) => {
                          const paid = !!inst.payment?.paid;
                          return (
                            <div key={inst.id} style={{ ...rowStyle, opacity: paid ? 0.6 : 1 }}>
                              <Checkbox
                                checked={paid}
                                disabled={!inst.payment}
                                onChange={async () => {
                                  await api.updateAnnualPayment(dossierId, inst.payment.id, { paid: !paid });
                                  await loadYearData(selectedYearId);
                                }}
                              />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <span style={{ fontWeight: 500, textDecoration: paid ? 'line-through' : 'none' }}>
                                  {item.name}
                                </span>
                                <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginLeft: '0.5rem' }}>
                                  {inst.installment_number}/{item.num_installments}
                                </span>
                                <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginLeft: '0.5rem' }}>
                                  {MONTH_NAMES[inst.month - 1]} {inst.day}
                                </span>
                              </div>
                              <span style={{ fontSize: '0.875rem', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                                {fmt(inst.expected_value)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <div className="cycle-toolbar-spacer" />
        </>
      )}

      {/* ── Item modal ────────────────────────────────────────────────────── */}
      {itemModal !== null && selectedYearId && (
        <ItemFormModal
          dossierId={dossierId}
          yearId={selectedYearId}
          item={itemModal && itemModal.id ? itemModal : null}
          onSave={handleItemSaved}
          onClose={() => setItemModal(null)}
        />
      )}

      {/* ── Account picker modal ──────────────────────────────────────────── */}
      {showAccountPicker && (
        <div className="modal-overlay" onClick={() => setShowAccountPicker(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Contributing Accounts</h2>
              <button className="close-btn" onClick={() => setShowAccountPicker(false)}><FontAwesomeIcon icon={faXmark} /></button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
                Select accounts whose current value counts toward annual expense funding.
              </p>
              {allAccounts.length === 0 ? (
                <p style={{ color: 'var(--text-muted)' }}>No accounts in this dossier.</p>
              ) : (
                <table className="table">
                  <thead><tr><th style={{ width: 40 }}></th><th>Group</th><th>Account</th></tr></thead>
                  <tbody>
                    {allAccounts.map((a) => (
                      <tr key={a.id} style={{ cursor: 'pointer' }} onClick={() => setPickerAccountSelection((prev) => prev.includes(a.id) ? prev.filter((x) => x !== a.id) : [...prev, a.id])}>
                        <td><Checkbox checked={pickerAccountSelection.includes(a.id)} onChange={() => {}} /></td>
                        <td style={{ color: 'var(--text-muted)' }}>{a.group_name}</td>
                        <td>{a.name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowAccountPicker(false)}>Cancel</button>
              <button className="btn-primary" onClick={saveAccountSelection}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Distribution picker modal ──────────────────────────────────────── */}
      {showDistPicker && (
        <div className="modal-overlay" onClick={() => setShowDistPicker(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Contributing Distributions</h2>
              <button className="close-btn" onClick={() => setShowDistPicker(false)}><FontAwesomeIcon icon={faXmark} /></button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
                Select distributions that contribute to annual expense funding. Completed distributions in cycles of this year will be counted.
              </p>
              {distributionTemplate.length === 0 ? (
                <p style={{ color: 'var(--text-muted)' }}>No distribution template items defined.</p>
              ) : (
                <table className="table">
                  <thead><tr><th style={{ width: 40 }}></th><th>Distribution</th></tr></thead>
                  <tbody>
                    {distributionTemplate.map((d) => (
                      <tr key={d.id} style={{ cursor: 'pointer' }} onClick={() => setPickerDistSelection((prev) => prev.includes(d.id) ? prev.filter((x) => x !== d.id) : [...prev, d.id])}>
                        <td><Checkbox checked={pickerDistSelection.includes(d.id)} onChange={() => {}} /></td>
                        <td>{d.name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowDistPicker(false)}>Cancel</button>
              <button className="btn-primary" onClick={saveDistSelection}>Save</button>
            </div>
          </div>
        </div>
      )}

      {confirmState && <ConfirmModal {...confirmState} onCancel={() => setConfirmState(null)} />}

      {showOtherYearModal && (
        <OtherYearModal
          currentYear={currentYear}
          existingYears={years.map((y) => y.year)}
          onSave={(y) => { setShowOtherYearModal(false); handleCreateYear(y); }}
          onClose={() => setShowOtherYearModal(false)}
        />
      )}

      {showCarryoverModal && yearData && (
        <EditCarryoverModal
          current={yearData.carryover}
          onSave={handleSaveCarryover}
          onClose={() => setShowCarryoverModal(false)}
        />
      )}
    </div>
  );
}

// ── Other year modal ──────────────────────────────────────────────────────────

function OtherYearModal({ currentYear, existingYears, onSave, onClose }) {
  const [year, setYear] = useState(String(currentYear + 1));
  const [error, setError] = useState('');

  function handleSubmit(e) {
    e.preventDefault();
    const y = parseInt(year, 10);
    if (isNaN(y) || y < 2000 || y > 2100) { setError('Enter a valid year (2000–2100)'); return; }
    if (existingYears.includes(y)) { setError(`Year ${y} already exists`); return; }
    onSave(y);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 320 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Open other year</h2>
          <button className="close-btn" onClick={onClose}><FontAwesomeIcon icon={faXmark} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="alert alert-error">{error}</div>}
            <div className="form-group">
              <label>Year</label>
              <input type="number" inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} min="2000" max="2100" autoFocus />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary">Open</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Edit carryover modal ──────────────────────────────────────────────────────

function EditCarryoverModal({ current, onSave, onClose }) {
  const [value, setValue] = useState(current != null ? String(current) : '0');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    const v = parseDecimalInput(value);
    if (isNaN(v)) { setError('Enter a valid number'); return; }
    setSaving(true);
    try { await onSave(v); } catch (err) { setError(err.message); setSaving(false); }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 320 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Edit Carryover</h2>
          <button className="close-btn" onClick={onClose}><FontAwesomeIcon icon={faXmark} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="alert alert-error">{error}</div>}
            <div className="form-group">
              <label>Carryover (€)</label>
              <input type="text" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
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
