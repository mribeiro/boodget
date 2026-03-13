import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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

function stateBadgeStyle(state) {
  if (state === 'completed') return { background: '#d1fae5', color: '#065f46', padding: '0.2rem 0.6rem', borderRadius: '999px', fontSize: '0.8rem', fontWeight: 600 };
  if (state === 'failed') return { background: '#fee2e2', color: '#991b1b', padding: '0.2rem 0.6rem', borderRadius: '999px', fontSize: '0.8rem', fontWeight: 600 };
  return { background: 'var(--color-surface-elevated)', color: 'var(--color-text-muted)', padding: '0.2rem 0.6rem', borderRadius: '999px', fontSize: '0.8rem', fontWeight: 600 };
}

export default function GoalDetail({ dossierId, goalId, onBack, onGoalUpdated, onGoalDeleted }) {
  const [goal, setGoal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showEdit, setShowEdit] = useState(false);
  const [editingCycle, setEditingCycle] = useState(null);
  const [cycleContribValue, setCycleContribValue] = useState('');
  const [savingContrib, setSavingContrib] = useState(false);

  useEffect(() => {
    load();
  }, [goalId]);

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

  async function handleDelete() {
    if (!confirm(`Delete goal "${goal.name}"? This cannot be undone.`)) return;
    try {
      await api.deleteGoal(dossierId, goal.id);
      onGoalDeleted();
    } catch (err) {
      setError(err.message);
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
      <div className="page-header" style={{ marginBottom: '1.5rem' }}>
        <button className="btn-ghost" onClick={onBack}>&larr; Back to Goals</button>
        <h2 style={{ flex: 1, margin: 0 }}>{goal.name}</h2>
        <span style={stateBadgeStyle(goal.state)}>{goal.state.charAt(0).toUpperCase() + goal.state.slice(1)}</span>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn-secondary" onClick={() => setShowEdit(true)}>Edit</button>
          <button className="btn-danger" onClick={handleDelete}>Delete</button>
        </div>
      </div>

      {infeasible && (
        <div className="alert alert-error" style={{ marginBottom: '1.5rem', fontWeight: 600 }}>
          ⚠ This goal cannot be reached with the current monthly contribution by the target date. Consider increasing the monthly contribution or extending the target date.
        </div>
      )}

      {/* Progress bar */}
      <div style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem', fontSize: '0.875rem' }}>
          <span style={{ color: 'var(--color-text-muted)' }}>Progress</span>
          <span style={{ fontWeight: 600 }}>{progressPct.toFixed(1)}%</span>
        </div>
        <div style={{ height: '12px', background: 'var(--color-border)', borderRadius: '999px', overflow: 'hidden' }}>
          <div
            style={{
              width: `${progressPct}%`,
              height: '100%',
              background: goal.state === 'completed'
                ? '#10b981'
                : goal.state === 'failed'
                ? '#ef4444'
                : infeasible
                ? '#f59e0b'
                : 'var(--color-primary)',
              borderRadius: '999px',
              transition: 'width 0.3s ease',
            }}
          />
        </div>
      </div>

      {/* Key values grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <KeyValue label="Target value" value={formatEur(goal.target_value)} />
        <KeyValue label="Total current progress" value={formatEur(goal.total_current_progress)} />
        <KeyValue label="Remaining amount" value={formatEur(goal.remaining_amount)} />
        <KeyValue label="Target date" value={formatYM(goal.target_date)} />
        {!isAdHoc && (
          <>
            <KeyValue label="Months remaining" value={goal.months_remaining > 0 ? `${goal.months_remaining} months` : 'Overdue'} />
            <KeyValue label="Monthly value needed" value={formatEur(goal.monthly_value_needed)} />
            <KeyValue label="Expected monthly contribution" value={formatEur(goal.expected_monthly_contribution)} highlight={infeasible} />
          </>
        )}
        {goal.anticipated_completion_date && (
          <KeyValue label="Anticipated completion" value={formatYM(goal.anticipated_completion_date)} accent />
        )}
        {goal.extra_value > 0 && (
          <KeyValue label="Extra value (in accounts)" value={formatEur(goal.extra_value)} note="Already included in account balance — used for projection only" />
        )}
      </div>

      {/* Chart */}
      {!isAdHoc && goal.chart_data && goal.chart_data.length > 0 && (
        <div style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ marginBottom: '1rem', fontSize: '1rem' }}>Cumulative contributions</h3>
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
              <Line
                type="monotone"
                dataKey="expected_cumulative"
                name="Expected"
                stroke="#6366f1"
                dot={false}
                strokeWidth={2}
              />
              <Line
                type="monotone"
                dataKey="real_cumulative"
                name="Real"
                stroke="#10b981"
                dot={false}
                strokeWidth={2}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Per-cycle manual contributions */}
      {goal.contribution_mode === 'manual' && goal.chart_data && goal.chart_data.length > 0 && (
        <div>
          <h3 style={{ marginBottom: '0.75rem', fontSize: '1rem' }}>Cycle contributions</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            {goal.chart_data.map((c) => {
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
                        type="number"
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
                        Edit
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showEdit && (
        <GoalFormModal
          dossierId={dossierId}
          goal={goal}
          onSave={(updated) => {
            setGoal(updated);
            setShowEdit(false);
            onGoalUpdated(updated);
          }}
          onClose={() => setShowEdit(false)}
        />
      )}
    </div>
  );
}

function KeyValue({ label, value, highlight, accent, note }) {
  return (
    <div
      style={{
        background: 'var(--color-surface)',
        borderRadius: 'var(--radius)',
        padding: '0.75rem 1rem',
        borderLeft: highlight ? '3px solid #f59e0b' : accent ? '3px solid #10b981' : '3px solid var(--color-border)',
      }}
    >
      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: '0.25rem' }}>{label}</div>
      <div style={{ fontWeight: 600, fontSize: '1rem', color: highlight ? '#d97706' : accent ? '#059669' : 'var(--color-text)' }}>{value}</div>
      {note && <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: '0.25rem', fontStyle: 'italic' }}>{note}</div>}
    </div>
  );
}
