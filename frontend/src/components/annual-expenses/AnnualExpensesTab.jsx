import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faPlus, faPencil, faTrash, faXmark, faChevronDown, faChevronRight,
  faSync, faListCheck, faCheck, faTriangleExclamation, faArrowRight,
} from '@fortawesome/free-solid-svg-icons';
import { api } from '../../services/api';
import ConfirmModal from '../ConfirmModal';
import Checkbox from '../ui/Checkbox';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function fmt(v) {
  if (v == null) return '—';
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v) + ' €';
}

function StatRow({ label, value, valueStyle }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border-default)' }}>
      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', ...valueStyle }}>{value}</span>
    </div>
  );
}

function InstallmentStatusBadge({ inst, calYear }) {
  if (!inst.payment) return null;
  if (inst.payment.paid) {
    return <span style={{ color: 'var(--color-success-text)', fontSize: 12, fontWeight: 600 }}><FontAwesomeIcon icon={faCheck} style={{ marginRight: 4 }} />Paid</span>;
  }
  const today = new Date();
  const instDate = new Date(calYear, inst.month - 1, inst.day);
  const overdue = instDate < today;
  return (
    <span style={{ color: overdue ? 'var(--color-warning-text)' : 'var(--text-muted)', fontSize: 12 }}>
      {overdue ? <FontAwesomeIcon icon={faTriangleExclamation} style={{ marginRight: 4 }} /> : null}
      {overdue ? 'Overdue' : 'Upcoming'}
    </span>
  );
}

// Modal for add/edit year item
function ItemFormModal({ dossierId, yearId, item, onSave, onClose }) {
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
    const v = parseFloat(value);
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

  const expectedPerInst = numInst > 0 && value ? fmt(parseFloat(value) / numInst) : '—';

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
                <label>Annual value (€)</label>
                <input type="number" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0.00" step="0.01" min="0" required />
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
                <input type="number" value={numInst} onChange={(e) => handleNumInstChange(e.target.value)} min="1" max="12" />
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
                    <input type="number" value={inst.day} onChange={(e) => setInstField(idx, 'day', e.target.value)} placeholder="Day" min="1" max="31" />
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

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmState, setConfirmState] = useState(null);

  // UI state
  const [expandedItems, setExpandedItems] = useState({});
  const [editingCarryover, setEditingCarryover] = useState(false);
  const [carryoverInput, setCarryoverInput] = useState('');
  const [itemModal, setItemModal] = useState(null); // null | {} | item
  const [showAccountPicker, setShowAccountPicker] = useState(false);
  const [pickerAccountSelection, setPickerAccountSelection] = useState([]);
  const [showDistPicker, setShowDistPicker] = useState(false);
  const [pickerDistSelection, setPickerDistSelection] = useState([]);

  const loadYears = useCallback(async () => {
    try {
      const [yrs, accs, selAccs, tmpl, selDists] = await Promise.all([
        api.getAnnualYears(dossierId),
        api.getAccounts(dossierId, false),
        api.getAnnualExpenseAccounts(dossierId),
        api.getExpenseTemplate(dossierId),
        api.getAnnualExpenseDistributions(dossierId),
      ]);
      setYears(yrs);
      setAllAccounts(accs);
      setSelectedAccountIds(selAccs);
      setDistributionTemplate(tmpl.filter((i) => i.section === 'distribution'));
      setSelectedDistIds(selDists);
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

  async function handleSaveCarryover() {
    const v = parseFloat(carryoverInput);
    if (isNaN(v)) return;
    try {
      const result = await api.updateAnnualYear(dossierId, selectedYearId, { carryover: v });
      setYearData(result);
      setEditingCarryover(false);
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
            <button className="btn-secondary" style={{ fontSize: 13 }} onClick={() => {
              const y = parseInt(window.prompt('Open year (e.g. 2027):', String(currentYear + 1)));
              if (!isNaN(y) && y > 2000) handleCreateYear(y);
            }}>
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-default)', paddingBottom: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{selectedYear.year} Summary</h2>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-secondary" style={{ fontSize: 12 }} onClick={handleSyncFromTemplate} title="Reset template-derived items from template">
                  <FontAwesomeIcon icon={faSync} style={{ marginRight: 4 }} />Sync from template
                </button>
                <button className="btn-secondary" style={{ fontSize: 12 }} onClick={handleSyncToTemplate} title="Replace template with this year's items">
                  <FontAwesomeIcon icon={faSync} style={{ marginRight: 4 }} />Sync to template
                </button>
                <button className="btn-ghost" style={{ fontSize: 12, color: 'var(--color-danger)' }} onClick={handleDeleteYear}>
                  <FontAwesomeIcon icon={faTrash} style={{ marginRight: 4 }} />Delete year
                </button>
              </div>
            </div>

            {yearData ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
                  {/* Carryover */}
                  <div style={{ background: 'var(--surface-secondary)', padding: 12, borderRadius: 'var(--radius)' }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Carryover</div>
                    {editingCarryover ? (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input type="number" value={carryoverInput} onChange={(e) => setCarryoverInput(e.target.value)} step="0.01" style={{ width: 90, fontSize: 14 }} autoFocus />
                        <button className="btn-primary" style={{ fontSize: 11, padding: '3px 8px' }} onClick={handleSaveCarryover}>Save</button>
                        <button className="btn-ghost" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => setEditingCarryover(false)}>Cancel</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 18, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmt(yearData.carryover)}</span>
                        <button className="btn-ghost" style={{ fontSize: 11, padding: '2px 6px' }} onClick={() => { setCarryoverInput(String(yearData.carryover)); setEditingCarryover(true); }}>
                          <FontAwesomeIcon icon={faPencil} />
                        </button>
                      </div>
                    )}
                  </div>

                  {[
                    { label: 'Accumulated (accounts)', value: fmt(yearData.accumulated_accounts) },
                    { label: 'Contributed (distributions)', value: fmt(yearData.contributed_distributions) },
                    { label: 'Total budgeted', value: fmt(yearData.total_budgeted) },
                    { label: 'Total paid', value: fmt(yearData.total_paid) },
                    { label: 'Total remaining', value: fmt(yearData.total_remaining), style: { color: yearData.total_remaining > 0 ? 'var(--color-warning-text)' : 'var(--color-success-text)' } },
                    { label: 'Balance', value: fmt(yearData.balance), style: { color: yearData.balance >= 0 ? 'var(--color-success-text)' : 'var(--color-danger-text)' } },
                  ].map(({ label, value, style }) => (
                    <div key={label} style={{ background: 'var(--surface-secondary)', padding: 12, borderRadius: 'var(--radius)' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{label}</div>
                      <span style={{ fontSize: 18, fontWeight: 600, fontVariantNumeric: 'tabular-nums', ...style }}>{value}</span>
                    </div>
                  ))}
                </div>

                {/* Contributing sources */}
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <button className="btn-secondary" style={{ fontSize: 12 }} onClick={openAccountPicker}>
                    <FontAwesomeIcon icon={faListCheck} style={{ marginRight: 4 }} />
                    Contributing accounts ({yearData.contributing_accounts?.length ?? 0})
                  </button>
                  <button className="btn-secondary" style={{ fontSize: 12 }} onClick={openDistPicker}>
                    <FontAwesomeIcon icon={faListCheck} style={{ marginRight: 4 }} />
                    Contributing distributions ({selectedDistIds.length})
                  </button>
                </div>
              </>
            ) : (
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
                const expanded = !!expandedItems[item.id];
                const diff = item.difference ?? ((item.total_paid || 0) - (item.budgeted_value || 0));
                return (
                  <div key={item.id} style={{ borderBottom: '1px solid var(--border-default)', marginBottom: 8, paddingBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => toggleExpand(item.id)}>
                      <FontAwesomeIcon icon={expanded ? faChevronDown : faChevronRight} style={{ fontSize: 11, color: 'var(--text-muted)', width: 12 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 600, fontSize: 14 }}>{item.name}</span>
                          {item.classification && (
                            <span style={{
                              fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 'var(--radius-full)',
                              background: item.classification === 'must' ? 'var(--color-danger-light)' : 'var(--color-warning-light)',
                              color: item.classification === 'must' ? 'var(--color-danger-text)' : 'var(--color-warning-text)',
                              border: `1px solid ${item.classification === 'must' ? 'var(--color-danger-border)' : 'var(--color-warning-border)'}`,
                            }}>
                              {item.classification === 'must' ? 'Must' : 'Want'}
                            </span>
                          )}
                          {!item.from_template && (
                            <span style={{ fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic' }}>ad-hoc</span>
                          )}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginLeft: 'auto' }}>
                        <div style={{ textAlign: 'right', fontSize: 13 }}>
                          <div style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmt(item.budgeted_value)}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>budgeted</div>
                        </div>
                        <div style={{ textAlign: 'right', fontSize: 13 }}>
                          <div style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmt(item.total_paid)}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>paid</div>
                        </div>
                        <div style={{ textAlign: 'right', fontSize: 13, minWidth: 80 }}>
                          <div style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: diff > 0 ? 'var(--color-danger-text)' : diff < 0 ? 'var(--color-success-text)' : 'inherit' }}>
                            {diff >= 0 ? '+' : ''}{fmt(diff)}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>difference</div>
                        </div>
                        <div style={{ display: 'flex', gap: 4 }} onClick={(e) => e.stopPropagation()}>
                          <button className="btn-ghost" style={{ fontSize: 12, padding: '3px 8px' }} onClick={() => setItemModal(item)}>
                            <FontAwesomeIcon icon={faPencil} />
                          </button>
                          <button className="btn-ghost" style={{ fontSize: 12, padding: '3px 8px', color: 'var(--color-danger)' }} onClick={() => handleDeleteItem(item)}>
                            <FontAwesomeIcon icon={faTrash} />
                          </button>
                        </div>
                      </div>
                    </div>

                    {expanded && (
                      <div style={{ marginTop: 8, marginLeft: 22 }}>
                        <table className="table" style={{ fontSize: 13 }}>
                          <thead>
                            <tr>
                              <th style={{ width: 60 }}>#</th>
                              <th>Date</th>
                              <th style={{ textAlign: 'right' }}>Amount</th>
                              <th>Status</th>
                              <th></th>
                            </tr>
                          </thead>
                          <tbody>
                            {item.installments.map((inst) => {
                              const today = new Date();
                              const instDate = new Date(selectedYear.year, inst.month - 1, inst.day);
                              const overdue = !inst.payment?.paid && instDate < today;
                              return (
                                <tr key={inst.id} style={{ background: overdue ? 'var(--color-warning-light)' : 'inherit' }}>
                                  <td style={{ color: 'var(--text-muted)' }}>{inst.installment_number}/{item.num_installments}</td>
                                  <td>{MONTH_NAMES[inst.month - 1]} {inst.day}</td>
                                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(inst.expected_value)}</td>
                                  <td><InstallmentStatusBadge inst={inst} calYear={selectedYear.year} /></td>
                                  <td>
                                    {inst.payment?.cycle_id && (
                                      <button className="btn-ghost" style={{ fontSize: 11, padding: '2px 6px' }} onClick={() => navigate(`/dossiers/${dossierId}/cycles/${inst.payment.cycle_id}`)}>
                                        <FontAwesomeIcon icon={faArrowRight} style={{ marginRight: 3 }} />Cycle
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
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
    </div>
  );
}
