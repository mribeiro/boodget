import { useState, useEffect } from 'react';
import { api } from '../../services/api';
import GoalFormModal from './GoalFormModal';
import GoalDetail from './GoalDetail';

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
  if (state === 'completed') return { background: '#d1fae5', color: '#065f46', padding: '0.15rem 0.5rem', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 600, whiteSpace: 'nowrap' };
  if (state === 'failed') return { background: '#fee2e2', color: '#991b1b', padding: '0.15rem 0.5rem', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 600, whiteSpace: 'nowrap' };
  return { background: 'var(--color-surface-elevated)', color: 'var(--color-text-muted)', padding: '0.15rem 0.5rem', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 600, whiteSpace: 'nowrap' };
}

export default function GoalsTab({ dossierId }) {
  const [goals, setGoals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [selectedGoalId, setSelectedGoalId] = useState(null);

  useEffect(() => {
    loadGoals();
  }, [dossierId]);

  async function loadGoals() {
    setLoading(true);
    setError('');
    try {
      const data = await api.getGoals(dossierId);
      setGoals(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleGoalCreated(newGoal) {
    setGoals((prev) => [...prev, newGoal]);
    setShowCreate(false);
    setSelectedGoalId(newGoal.id);
  }

  function handleGoalUpdated(updated) {
    setGoals((prev) => prev.map((g) => (g.id === updated.id ? updated : g)));
  }

  function handleGoalDeleted() {
    setGoals((prev) => prev.filter((g) => g.id !== selectedGoalId));
    setSelectedGoalId(null);
  }

  if (selectedGoalId) {
    return (
      <GoalDetail
        dossierId={dossierId}
        goalId={selectedGoalId}
        onBack={() => setSelectedGoalId(null)}
        onGoalUpdated={handleGoalUpdated}
        onGoalDeleted={handleGoalDeleted}
      />
    );
  }

  if (loading) return <div className="loading">Loading…</div>;

  return (
    <div>
      {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      <div className="section-header" style={{ marginBottom: '1.25rem' }}>
        <h2 style={{ margin: 0 }}>Goals</h2>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          New goal
        </button>
      </div>

      {goals.length === 0 ? (
        <div className="empty-state">
          <p>No goals yet. Create your first financial goal to track progress.</p>
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            New goal
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {goals.map((goal) => {
            const progressPct = Math.min(100, (goal.total_current_progress / goal.target_value) * 100);
            const infeasible = goal.feasible === false;
            return (
              <div
                key={goal.id}
                className="month-row"
                style={{ flexDirection: 'column', alignItems: 'stretch', cursor: 'pointer', padding: '1rem' }}
                onClick={() => setSelectedGoalId(goal.id)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.6rem' }}>
                  <span style={{ fontWeight: 600, flex: 1 }}>{goal.name}</span>
                  <span style={stateBadgeStyle(goal.state)}>
                    {goal.state.charAt(0).toUpperCase() + goal.state.slice(1)}
                  </span>
                  {infeasible && goal.state === 'active' && (
                    <span style={{ background: '#fef3c7', color: '#92400e', padding: '0.15rem 0.5rem', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      ⚠ Infeasible
                    </span>
                  )}
                </div>

                {/* Progress bar */}
                <div style={{ marginBottom: '0.6rem' }}>
                  <div style={{ height: '8px', background: 'var(--color-border)', borderRadius: '999px', overflow: 'hidden' }}>
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
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.8rem', color: 'var(--color-text-muted)', flexWrap: 'wrap' }}>
                  <span>
                    <strong style={{ color: 'var(--color-text)' }}>{formatEur(goal.total_current_progress)}</strong>
                    {' '}/ {formatEur(goal.target_value)}
                  </span>
                  <span>Target: {formatYM(goal.target_date)}</span>
                  {goal.contribution_mode !== 'ad_hoc' && (
                    <span>Expected: {formatEur(goal.expected_monthly_contribution)}/mo</span>
                  )}
                  {goal.remaining_amount > 0 && (
                    <span>Remaining: {formatEur(goal.remaining_amount)}</span>
                  )}
                </div>

                {infeasible && goal.state === 'active' && (
                  <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#b45309', fontWeight: 500 }}>
                    ⚠ Goal cannot be reached with current settings.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showCreate && (
        <GoalFormModal
          dossierId={dossierId}
          goal={null}
          onSave={handleGoalCreated}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
