import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft, faPencil, faTrash, faTriangleExclamation, faChevronDown, faChevronRight, faPlus } from '@fortawesome/free-solid-svg-icons';
import KpiStrip from '../ui/KpiStrip';
import Toast from '../ui/Toast';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { api } from '../../services/api';
import GoalFormModal from './GoalFormModal';
import ConfirmModal from '../ConfirmModal';

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function formatEur(value) {
  if (value == null) return '—';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value) + ' €';
}

function formatYM(ym) {
  if (!ym) return '—';
  const [year, month] = ym.split('-');
  return `${MONTH_NAMES[Number(month) - 1]} ${year}`;
}


export default function GoalDetail() {
  const { id: dossierId, goalId } = useParams();
  const navigate = useNavigate();

  const [goal, setGoal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showEdit, setShowEdit] = useState(false);
  const [editingCycle, setEditingCycle] = useState(null);
  const [cycleContribValue, setCycleContribValue] = useState('');
  const [savingContrib, setSavingContrib] = useState(false);
  const [newHistYear, setNewHistYear] = useState(new Date().getFullYear());
  const [newHistMonth, setNewHistMonth] = useState(1);
  const [newHistAmount, setNewHistAmount] = useState('');
  const [batchStartYear, setBatchStartYear] = useState(new Date().getFullYear());
  const [batchStartMonth, setBatchStartMonth] = useState(1);
  const [batchEndYear, setBatchEndYear] = useState(new Date().getFullYear());
  const [batchEndMonth, setBatchEndMonth] = useState(new Date().getMonth() + 1);
  const [batchAmount, setBatchAmount] = useState('');
  const [histError, setHistError] = useState('');
  const [savingHist, setSavingHist] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  const [confirmState, setConfirmState] = useState(null);
  const [toast, setToast] = useState({ msg: '', show: false });
  const toastTimer = useRef(null);

  function showToast(msg) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, show: true });
    toastTimer.current = setTimeout(() => setToast((t) => ({ ...t, show: false })), 2000);
  }

  useEffect(() => {
    load();
  }, [dossierId, goalId]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const g = await api.getGoal(dossierId, goalId);
      setGoal(g);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleDelete() {
    setConfirmState({
      title: 'Delete goal',
      message: `Delete goal "${goal.name}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: async () => {
        try {
          await api.deleteGoal(dossierId, goal.id);
          navigate(`/dossiers/${dossierId}`, { state: { tab: 'goals' } });
        } catch (err) {
          setError(err.message);
        }
      },
    });
  }

  async function handleAddHistorical() {
    setHistError('');
    const y = Number(newHistYear);
    const m = Number(newHistMonth);
    const a = Number(newHistAmount);
    if (!Number.isInteger(y) || y < 1900) { setHistError('Invalid year'); return; }
    if (m < 1 || m > 12) { setHistError('Invalid month'); return; }
    if (isNaN(a)) { setHistError('Amount must be a number'); return; }
    const existing = goal.historical_contributions || [];
    if (existing.some((h) => h.year === y && h.month === m)) {
      setHistError('An entry for that month already exists'); return;
    }
    setSavingHist(true);
    try {
      await api.bulkReplaceGoalHistoricalContributions(dossierId, goal.id, [
        ...existing,
        { year: y, month: m, amount: a },
      ]);
      setNewHistAmount('');
      await load();
      showToast('Entry added');
    } catch (err) {
      setHistError(err.message);
    } finally {
      setSavingHist(false);
    }
  }

  async function handleAddBatchHistorical() {
    setHistError('');
    const sy = Number(batchStartYear), sm = Number(batchStartMonth);
    const ey = Number(batchEndYear), em = Number(batchEndMonth);
    const a = Number(batchAmount);
    if (!Number.isInteger(sy) || sy < 1900) { setHistError('Invalid start year'); return; }
    if (!Number.isInteger(ey) || ey < 1900) { setHistError('Invalid end year'); return; }
    if (sy * 12 + sm > ey * 12 + em) { setHistError('Start must be before or equal to end'); return; }
    if (isNaN(a)) { setHistError('Amount must be a number'); return; }
    const existing = goal.historical_contributions || [];
    const toAdd = [];
    let y = sy, m = sm;
    while (y * 12 + m <= ey * 12 + em) {
      if (!existing.some((h) => h.year === y && h.month === m)) {
        toAdd.push({ year: y, month: m, amount: a });
      }
      m++;
      if (m > 12) { m = 1; y++; }
    }
    if (toAdd.length === 0) { setHistError('All months in this range already have entries'); return; }
    setSavingHist(true);
    try {
      const merged = [...existing, ...toAdd].sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);
      await api.bulkReplaceGoalHistoricalContributions(dossierId, goal.id, merged);
      setBatchAmount('');
      await load();
      showToast('Entries added');
    } catch (err) {
      setHistError(err.message);
    } finally {
      setSavingHist(false);
    }
  }

  async function handleDeleteHistorical(year, month) {
    const existing = goal.historical_contributions || [];
    const updated = existing.filter((h) => !(h.year === year && h.month === month));
    try {
      await api.bulkReplaceGoalHistoricalContributions(dossierId, goal.id, updated);
      await load();
    } catch (err) {
      setHistError(err.message);
    }
  }

  async function handleSaveCycleContrib(cycleId) {
    if (cycleContribValue === '' || isNaN(Number(cycleContribValue))) return;
    setSavingContrib(true);
    try {
      await api.updateGoalCycleContribution(dossierId, goal.id, cycleId, {
        real_contribution: Number(cycleContribValue),
      });
      setEditingCycle(null);
      setCycleContribValue('');
      await load();
      showToast('Contribution saved');
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingContrib(false);
    }
  }

  if (loading) return <div className="loading">Loading…</div>;
  if (error) return <div className="alert alert-error">{error}</div>;
  if (!goal) return null;

  const progressPct = Math.min(100, (goal.total_current_progress / goal.target_value) * 100);
  const infeasible = goal.feasible === false;
  const isAdHoc = goal.contribution_mode === 'ad_hoc';

  return (
    <div>
      <div className="page-header" style={{ marginBottom: 'var(--space-6)' }}>
        <button className="btn-ghost" onClick={() => navigate(`/dossiers/${dossierId}`, { state: { tab: 'goals' } })}><FontAwesomeIcon icon={faArrowLeft} style={{ marginRight: '0.4rem' }} />Back to Goals</button>
        <h1 style={{ flex: 1, margin: 0 }}>{goal.name}</h1>
      </div>

      {/* ── Action toolbar ── */}
      <div className="cycle-toolbar">
        <div className="cycle-toolbar-group">
          <button className="cycle-toolbar-btn btn-secondary" onClick={() => setShowEdit(true)}>
            <FontAwesomeIcon icon={faPencil} />
          </button>
        </div>
        <div className="cycle-toolbar-group">
          <button className="cycle-toolbar-btn btn-danger" onClick={handleDelete}>
            <FontAwesomeIcon icon={faTrash} />
          </button>
        </div>
      </div>

      {infeasible && (
        <div className="alert alert-error" style={{ marginBottom: '1.5rem', fontWeight: 600 }}>
          <FontAwesomeIcon icon={faTriangleExclamation} style={{ marginRight: '0.4rem' }} />This goal cannot be reached with the current monthly contribution by the target date. Consider increasing the monthly contribution or extending the target date.
        </div>
      )}

      {/* ── Two-column layout: left = stats + contributions, right = chart ── */}
      <div className="cycle-editor-columns" style={{ marginBottom: '1.5rem' }}>

        {/* Left column */}
        <div className="cycle-editor-left">
          {/* Progress bar */}
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
              <span className={`badge badge-${goal.state === 'completed' ? 'success' : goal.state === 'failed' ? 'danger' : 'brand'}`}>
                {goal.state.charAt(0).toUpperCase() + goal.state.slice(1)}
              </span>
              <span style={{ fontSize: 12, fontWeight: 600 }}>{progressPct.toFixed(1)}%</span>
            </div>
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{
                  width: `${progressPct}%`,
                  background: goal.state === 'completed'
                    ? 'var(--color-success)'
                    : goal.state === 'failed'
                    ? 'var(--color-danger)'
                    : infeasible
                    ? 'var(--color-warning)'
                    : 'var(--color-brand)',
                }}
              />
            </div>
          </div>

          {/* KPI blocks */}
          <KpiStrip style={{ marginBottom: 'var(--space-4)' }} defaultOpen items={[
            { label: 'Target', value: formatEur(goal.target_value), large: true },
            { label: 'Progress', value: formatEur(goal.total_current_progress), highlight: goal.state === 'completed' ? 'success' : 'neutral' },
            { label: 'Remaining', value: formatEur(goal.remaining_amount), highlight: goal.remaining_amount > 0 && goal.state === 'active' ? 'neutral' : 'success' },
            { label: 'Target date', value: formatYM(goal.target_date) },
            !isAdHoc ? { label: 'Months left', value: goal.months_remaining > 0 ? `${goal.months_remaining} mo` : 'Overdue', highlight: goal.months_remaining <= 0 ? 'danger' : 'neutral' } : null,
            !isAdHoc ? { label: 'Mo. needed', value: formatEur(goal.monthly_value_needed), highlight: infeasible ? 'warning' : 'neutral' } : null,
            !isAdHoc ? { label: 'Mo. expected', value: formatEur(goal.expected_monthly_contribution), highlight: infeasible ? 'warning' : 'neutral' } : null,
            goal.anticipated_completion_date ? { label: 'Est. done', value: formatYM(goal.anticipated_completion_date), highlight: 'success' } : null,
            goal.extra_value > 0 ? { label: 'Extra', value: formatEur(goal.extra_value), note: 'In accounts — projection only' } : null,
          ]} />

          {/* Historical contributions */}
          {!isAdHoc && (
        <div style={{ marginBottom: '1.5rem' }}>
          <button
            className="btn-ghost"
            onClick={() => setHistOpen((o) => !o)}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '1rem', fontWeight: 600, padding: '0', marginBottom: histOpen ? '0.75rem' : 0 }}
          >
            <FontAwesomeIcon icon={histOpen ? faChevronDown : faChevronRight} style={{ fontSize: '0.75rem' }} />
            Historical contributions
          </button>
          {histOpen && <>
          <p style={{ fontSize: '0.825rem', color: 'var(--color-text-muted)', marginBottom: '0.75rem' }}>
            Record contributions made before this goal was created. These amounts are already reflected in your account balance and are used only for chart display — they are not added to any total.
          </p>
          {(goal.historical_contributions || []).length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem', marginBottom: '0.75rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
                  <th style={{ textAlign: 'left', padding: '0.35rem 0.5rem', fontWeight: 500 }}>Month</th>
                  <th style={{ textAlign: 'left', padding: '0.35rem 0.5rem', fontWeight: 500 }}>Year</th>
                  <th style={{ textAlign: 'right', padding: '0.35rem 0.5rem', fontWeight: 500 }}>Amount</th>
                  <th style={{ width: '2rem' }} />
                </tr>
              </thead>
              <tbody>
                {(goal.historical_contributions || []).map((h) => (
                  <tr key={`${h.year}-${h.month}`} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: '0.35rem 0.5rem' }}>{MONTH_NAMES[h.month - 1]}</td>
                    <td style={{ padding: '0.35rem 0.5rem' }}>{h.year}</td>
                    <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right' }}>{formatEur(h.amount)}</td>
                    <td style={{ padding: '0.35rem 0.5rem', textAlign: 'center' }}>
                      <button
                        className="btn-danger"
                        style={{ padding: '0.15rem 0.5rem', fontSize: '0.75rem' }}
                        onClick={() => handleDeleteHistorical(h.year, h.month)}
                      >
                        <FontAwesomeIcon icon={faTrash} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label style={{ fontSize: '0.8rem' }}>Month</label>
              <select value={newHistMonth} onChange={(e) => setNewHistMonth(Number(e.target.value))} style={{ width: '7rem' }}>
                {MONTH_NAMES.map((name, i) => (
                  <option key={i + 1} value={i + 1}>{name}</option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label style={{ fontSize: '0.8rem' }}>Year</label>
              <input type="number" inputMode="numeric" value={newHistYear} onChange={(e) => setNewHistYear(Number(e.target.value))} style={{ width: '6rem' }} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label style={{ fontSize: '0.8rem' }}>Amount (€)</label>
              <input type="number" inputMode="decimal" step="0.01" min="0" value={newHistAmount} onChange={(e) => setNewHistAmount(e.target.value)} style={{ width: '8rem' }} placeholder="0.00" />
            </div>
            <button className="btn-secondary" onClick={handleAddHistorical} disabled={savingHist} style={{ padding: '0.35rem 0.75rem' }}>
              <FontAwesomeIcon icon={faPlus} style={{ marginRight: '0.35rem' }} />Add entry
            </button>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label style={{ fontSize: '0.8rem' }}>From</label>
              <div style={{ display: 'flex', gap: '0.25rem' }}>
                <select value={batchStartMonth} onChange={(e) => setBatchStartMonth(Number(e.target.value))} style={{ width: '7rem' }}>
                  {MONTH_NAMES.map((name, i) => (
                    <option key={i + 1} value={i + 1}>{name}</option>
                  ))}
                </select>
                <input type="number" inputMode="numeric" value={batchStartYear} onChange={(e) => setBatchStartYear(Number(e.target.value))} style={{ width: '6rem' }} />
              </div>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label style={{ fontSize: '0.8rem' }}>To</label>
              <div style={{ display: 'flex', gap: '0.25rem' }}>
                <select value={batchEndMonth} onChange={(e) => setBatchEndMonth(Number(e.target.value))} style={{ width: '7rem' }}>
                  {MONTH_NAMES.map((name, i) => (
                    <option key={i + 1} value={i + 1}>{name}</option>
                  ))}
                </select>
                <input type="number" inputMode="numeric" value={batchEndYear} onChange={(e) => setBatchEndYear(Number(e.target.value))} style={{ width: '6rem' }} />
              </div>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label style={{ fontSize: '0.8rem' }}>Amount/month (€)</label>
              <input type="number" inputMode="decimal" step="0.01" min="0" value={batchAmount} onChange={(e) => setBatchAmount(e.target.value)} style={{ width: '8rem' }} placeholder="0.00" />
            </div>
            <button className="btn-secondary" onClick={handleAddBatchHistorical} disabled={savingHist} style={{ padding: '0.35rem 0.75rem' }}>
              <FontAwesomeIcon icon={faPlus} style={{ marginRight: '0.35rem' }} />Add range
            </button>
          </div>
          {histError && <div className="alert alert-error" style={{ marginTop: '0.5rem' }}>{histError}</div>}
          </>}
        </div>
      )}

          {/* Per-cycle manual contributions */}
          {goal.contribution_mode === 'manual' && goal.chart_data && goal.chart_data.length > 0 && (
            <div>
              <h3 style={{ marginBottom: '0.75rem', fontSize: '1rem' }}>Cycle contributions</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                {goal.chart_data.filter((c) => !c.is_historical).map((c) => {
                  const label = `${MONTH_NAMES[c.month - 1]} ${c.year}`;
                  const isEditing = editingCycle === c.cycle_id;
                  return (
                    <div
                      key={c.cycle_id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '1rem',
                        padding: '0.5rem 0.75rem',
                        background: 'var(--color-surface)',
                        borderRadius: 'var(--radius)',
                        fontSize: '0.875rem',
                      }}
                    >
                      <span style={{ flex: 1 }}>{label}</span>
                      {isEditing ? (
                        <>
                          <input
                            type="number" inputMode="decimal"
                            value={cycleContribValue}
                            onChange={(e) => setCycleContribValue(e.target.value)}
                            min="0"
                            step="0.01"
                            style={{ width: '120px' }}
                            autoFocus
                          />
                          <button
                            className="btn-primary"
                            style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem' }}
                            disabled={savingContrib}
                            onClick={() => handleSaveCycleContrib(c.cycle_id)}
                          >
                            Save
                          </button>
                          <button
                            className="btn-secondary"
                            style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem' }}
                            onClick={() => { setEditingCycle(null); setCycleContribValue(''); }}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <span style={{ color: c.real_contribution > 0 ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                            {formatEur(c.real_contribution)}
                          </span>
                          <button
                            className="btn-secondary"
                            style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem' }}
                            onClick={() => {
                              setEditingCycle(c.cycle_id);
                              setCycleContribValue(String(c.real_contribution));
                            }}
                          >
                            <FontAwesomeIcon icon={faPencil} style={{ marginRight: '0.35rem' }} />Edit
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>{/* end left column */}

        {/* Right column — chart */}
        <div className="cycle-editor-right">
          {!isAdHoc && goal.chart_data && goal.chart_data.length > 0 ? (
            <div className="card card--flat" style={{ padding: 'var(--space-4)' }}>
              <h3 style={{ marginBottom: '0.75rem', fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                Cumulative contributions
              </h3>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={goal.chart_data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis
                    dataKey={(d) => `${MONTH_NAMES[d.month - 1]} ${d.year}`}
                    tick={{ fontSize: 11 }}
                  />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v) => formatEur(v)} />
                  <Legend />
                  <Line type="monotone" dataKey="expected_cumulative" name="Expected" stroke="#6366f1" dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="real_cumulative" name="Real" stroke="#10b981" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : null}
        </div>{/* end right column */}

      </div>{/* end two-column */}

      {showEdit && (
        <GoalFormModal
          dossierId={dossierId}
          goal={goal}
          onSave={(updated) => {
            setGoal(updated);
            setShowEdit(false);
            load();
          }}
          onClose={() => setShowEdit(false)}
        />
      )}
      {confirmState && <ConfirmModal {...confirmState} onCancel={() => setConfirmState(null)} />}
      <Toast message={toast.msg} visible={toast.show} />
      {/* Spacer so fixed bottom toolbar doesn't overlap content on mobile */}
      <div className="cycle-toolbar-spacer" />
    </div>
  );
}
