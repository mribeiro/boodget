import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
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

function ProgressBar({ pct, state, infeasible }) {
  const fillColor =
    state === 'completed' ? 'var(--color-success)' :
    state === 'failed'    ? 'var(--color-danger)'  :
    infeasible            ? 'var(--color-warning)'  :
    pct < 25              ? 'var(--color-danger)'   :
    pct < 75              ? 'var(--color-warning)'  :
    'var(--color-success)';

  return (
    <div className="progress-track" style={{ marginBottom: 'var(--space-2)' }}>
      <div className="progress-fill" style={{ width: `${pct}%`, background: fillColor }} />
    </div>
  );
}

export default function GoalsTab({ dossierId }) {
  const navigate = useNavigate();
  const [goals, setGoals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);

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
    navigate(`/dossiers/${dossierId}/goals/${newGoal.id}`);
  }

  if (loading) return <div className="loading">Loading…</div>;

  return (
    <div>
      {error && <div className="alert alert-error" style={{ marginBottom: 'var(--space-4)' }}>{error}</div>}

      <div className="section-header" style={{ marginBottom: 'var(--space-5)' }}>
        <h2 style={{ margin: 0 }}>Goals</h2>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          <FontAwesomeIcon icon={faPlus} style={{ marginRight: '0.4rem' }} />New goal
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {goals.map((goal) => {
            const progressPct = Math.min(100, (goal.total_current_progress / goal.target_value) * 100);
            const infeasible = goal.feasible === false;
            const dimmed = goal.state !== 'active';
            const badgeVariant = goal.state === 'completed' ? 'success' : goal.state === 'failed' ? 'danger' : 'brand';
            return (
              <div
                key={goal.id}
                className="card card--clickable"
                style={{ opacity: dimmed ? 0.8 : 1, padding: 'var(--space-4)' }}
                onClick={() => navigate(`/dossiers/${dossierId}/goals/${goal.id}`)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
                  <span style={{ fontWeight: 600, fontSize: 15, flex: 1 }}>{goal.name}</span>
                  <span className={`badge badge-${badgeVariant}`}>
                    {goal.state.charAt(0).toUpperCase() + goal.state.slice(1)}
                  </span>
                  {infeasible && goal.state === 'active' && (
                    <span className="badge badge-warning"><FontAwesomeIcon icon={faTriangleExclamation} style={{ marginRight: '0.3rem' }} />Infeasible</span>
                  )}
                  <span className="text-xs" style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {formatYM(goal.target_date)}
                  </span>
                </div>

                <ProgressBar pct={progressPct} state={goal.state} infeasible={infeasible} />

                <div style={{ display: 'flex', gap: 'var(--space-5)', fontSize: 12, color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
                  <span className="tabular">
                    <strong style={{ color: 'var(--text-primary)' }}>{formatEur(goal.total_current_progress)}</strong>
                    {' / '}{formatEur(goal.target_value)}
                  </span>
                  {goal.contribution_mode !== 'ad_hoc' && (
                    <span className="tabular">Expected: {formatEur(goal.expected_monthly_contribution)}/mo</span>
                  )}
                  {goal.remaining_amount > 0 && (
                    <span className="tabular">Remaining: {formatEur(goal.remaining_amount)}</span>
                  )}
                  <span className="tabular" style={{ marginLeft: 'auto' }}>{progressPct.toFixed(0)}%</span>
                </div>

                {infeasible && goal.state === 'active' && (
                  <div style={{ marginTop: 'var(--space-2)', fontSize: 12, color: 'var(--color-warning-text)', fontWeight: 500 }}>
                    <FontAwesomeIcon icon={faTriangleExclamation} style={{ marginRight: '0.3rem' }} />Goal cannot be reached with current settings.
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
