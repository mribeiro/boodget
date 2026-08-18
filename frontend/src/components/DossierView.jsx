import { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faArrowLeft,
  faCalendarPlus,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import { api } from '../services/api';
import { publishPageContext, clearPageContext } from '../utils/pageContext';
import { AuthContext, AppContext } from '../App';
import CapitalChart from './CapitalChart';
import CapitalCompareTable from './CapitalCompareTable';
import ExpensesTab from './expenses/ExpensesTab';
import DossierSettingsTab from './DossierSettingsTab';
import WorkbenchTab from './workbench/WorkbenchTab';
import GoalsTab from './goals/GoalsTab';
import LoansTab from './loans/LoansTab';
import SubscriptionsTab from './subscriptions/SubscriptionsTab';
import EmergencyFundTab from './emergency-fund/EmergencyFundTab';
import AnnualExpensesTab from './annual-expenses/AnnualExpensesTab';
import AIAdvisorTab from './ai-advisor/AIAdvisorTab';
import GlancesPanel from './glances/GlancesPanel';
import { formatNumber } from '../utils/numbers';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function monthLabel(year, month) {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

function prevMonth(year, month) {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

function formatEur(value) {
  if (value == null) return null;
  return formatNumber(value, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + ' €';
}

export default function DossierView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useContext(AuthContext);
  const { setCurrentDossier, activeTab, setActiveTab } = useContext(AppContext);
  const autoOpened = location.state?.autoOpened === true;

  const [dossier, setDossier] = useState(null);
  const [months, setMonths] = useState([]);
  const [showAddMonth, setShowAddMonth] = useState(false);
  const [compareView, setCompareView] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.getDossier(id), api.getMonths(id)])
      .then(([d, m]) => {
        setDossier(d);
        setMonths(m);
        setCurrentDossier(d);
      })
      .catch(() => setError('Failed to load dossier'));
  }, [id]);

  useEffect(() => {
    setActiveTab(location.state?.tab ?? 'capital');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const aiEnabled = dossier ? dossier.ai_enabled !== 0 : true;

  useEffect(() => {
    if (!aiEnabled && activeTab === 'ai-advisor') setActiveTab('capital');
  }, [aiEnabled, activeTab]);

  // The Capital tab's content is inlined here rather than a separate component (unlike every
  // other tab), so it needs its own activeTab-gated publish/clear instead of the usual
  // mount/unmount pair a dedicated tab component gets for free from the key={activeTab} remount.
  useEffect(() => {
    if (activeTab !== 'capital' || !dossier) return;
    publishPageContext({
      label: 'Capital',
      data: {
        months: months.slice(0, 12).map((m) => ({
          year: m.year, month: m.month, filled: m.filled,
          capital_total: m.capital_total, idle_total: m.idle_total,
        })),
      },
    });
    return () => clearPageContext();
  }, [activeTab, months, dossier]);

  async function handleAddMonth({ year, month }) {
    try {
      const m = await api.createMonth(id, { year, month });
      setMonths((prev) => [m, ...prev].sort((a, b) => b.year - a.year || b.month - a.month));
      setShowAddMonth(false);
      navigate(`/dossiers/${id}/months/${m.id}`);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handlePlaceholderClick(year, month) {
    const existing = months.find((m) => m.year === year && m.month === month);
    if (existing) {
      navigate(`/dossiers/${id}/months/${existing.id}`);
      return;
    }
    try {
      const m = await api.createMonth(id, { year, month });
      setMonths((prev) => [m, ...prev].sort((a, b) => b.year - a.year || b.month - a.month));
      navigate(`/dossiers/${id}/months/${m.id}`);
    } catch (err) {
      setError(err.message);
    }
  }

  if (!dossier) return <div className="loading">Loading...</div>;

  return (
    <div className="page-fade-in">
      {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      <div className="page-header">
        {!autoOpened && (
          <button className="btn-ghost" onClick={() => navigate('/')}>
            <FontAwesomeIcon icon={faArrowLeft} />
          </button>
        )}
        <h1 style={{ flex: 1 }}>{dossier.name}</h1>
      </div>

      <GlancesPanel
        dossierId={id}
        months={months}
        onNavigate={setActiveTab}
      />

      <div key={activeTab} className="tab-content">
      {activeTab === 'capital' && (
        <div>
          <CapitalChart months={months} />

          <div className="months-section">
            <div className="section-header">
              <h2>Monthly Records</h2>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <div style={{ display: 'flex', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                  <button
                    style={{ borderRadius: 0, background: !compareView ? 'var(--color-primary)' : 'var(--color-surface)', color: !compareView ? '#fff' : 'var(--color-text-muted)', padding: '0.4rem 0.75rem', fontSize: '0.8rem' }}
                    onClick={() => setCompareView(false)}
                  >
                    List
                  </button>
                  <button
                    style={{ borderRadius: 0, background: compareView ? 'var(--color-primary)' : 'var(--color-surface)', color: compareView ? '#fff' : 'var(--color-text-muted)', borderLeft: '1px solid var(--color-border)', padding: '0.4rem 0.75rem', fontSize: '0.8rem' }}
                    onClick={() => setCompareView(true)}
                  >
                    Compare
                  </button>
                </div>
                <button className="btn-primary" onClick={() => setShowAddMonth(true)}>
                  <FontAwesomeIcon icon={faCalendarPlus} style={{ marginRight: '0.4rem' }} />Add month
                </button>
              </div>
            </div>

            {compareView ? (
              <CapitalCompareTable dossierId={id} />
            ) : months.length === 0 ? (
              <div className="empty-state">
                <p>No monthly records yet.</p>
                <button className="btn-primary" onClick={() => setShowAddMonth(true)}>
                  Add first month
                </button>
              </div>
            ) : (
              <div className="months-list">
                {months.flatMap((m, i) => {
                  const older = months[i + 1];
                  const newer = months[i - 1];
                  const hasPrev = older?.filled && m.filled && m.capital_total != null && older.capital_total != null;
                  const capitalDiff = hasPrev ? m.capital_total - older.capital_total : null;
                  const idleDiff = (hasPrev && m.idle_total != null && older.idle_total != null)
                    ? m.idle_total - older.idle_total : null;
                  const gapAbove = newer
                    ? (newer.year - m.year) * 12 + (newer.month - m.month) - 1
                    : 0;
                  const result = [];
                  if (gapAbove > 0) {
                    result.push(
                      <div key={`gap-${m.id}`} style={{ textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.72rem', padding: '0.1rem 0.5rem', letterSpacing: '0.05em' }}>
                        · · · {gapAbove} {gapAbove === 1 ? 'month' : 'months'} not recorded · · ·
                      </div>
                    );
                  }
                  result.push(
                    <div
                      key={m.id}
                      className="month-row"
                      onClick={() => navigate(`/dossiers/${id}/months/${m.id}`)}
                    >
                      <span className="month-row-name">{monthLabel(m.year, m.month)}</span>
                      <div style={{ textAlign: 'right' }}>
                        {m.filled && m.capital_total != null ? (
                          <>
                            <div style={{ fontSize: '0.875rem', color: 'var(--text-primary)' }}>
                              {formatEur(m.capital_total)}
                              {capitalDiff != null && (
                                <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: capitalDiff > 0 ? 'var(--color-success)' : capitalDiff < 0 ? 'var(--color-danger)' : 'var(--text-muted)' }}>
                                  {capitalDiff > 0 ? '+' : ''}{formatEur(capitalDiff)}
                                </span>
                              )}
                            </div>
                            {m.idle_total != null && (
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                                Idle: {formatEur(m.idle_total)}
                                {idleDiff != null && (
                                  <span style={{ marginLeft: '0.4rem', color: idleDiff > 0 ? 'var(--color-success)' : idleDiff < 0 ? 'var(--color-danger)' : 'var(--text-muted)' }}>
                                    {idleDiff > 0 ? '+' : ''}{formatEur(idleDiff)}
                                  </span>
                                )}
                              </div>
                            )}
                          </>
                        ) : (
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>not filled</span>
                        )}
                      </div>
                    </div>
                  );
                  return result;
                })}

                {/* Bottom placeholder: add the month before the oldest */}
                {(() => {
                  const oldest = months[months.length - 1];
                  const prev = prevMonth(oldest.year, oldest.month);
                  return (
                    <div
                      className="month-row month-row-placeholder"
                      onClick={() => handlePlaceholderClick(prev.year, prev.month)}
                    >
                      <span className="month-row-name">Fill {monthLabel(prev.year, prev.month)}</span>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'expenses' && (
        <ExpensesTab dossierId={id} />
      )}

      {activeTab === 'annual-expenses' && (
        <AnnualExpensesTab dossierId={id} />
      )}

      {activeTab === 'workbench' && (
        <WorkbenchTab dossierId={id} />
      )}

      {activeTab === 'goals' && (
        <GoalsTab dossierId={id} />
      )}

      {activeTab === 'loans' && (
        <LoansTab dossierId={id} />
      )}

      {activeTab === 'subscriptions' && (
        <SubscriptionsTab dossierId={id} />
      )}

      {activeTab === 'emergency-fund' && (
        <EmergencyFundTab dossierId={id} />
      )}

      {activeTab === 'ai-advisor' && aiEnabled && (
        <AIAdvisorTab dossierId={id} dossierName={dossier.name} />
      )}

      {activeTab === 'settings' && (
        <DossierSettingsTab dossierId={id} dossier={dossier} />
      )}
      </div>

      {showAddMonth && (
        <AddMonthModal
          existingMonths={months}
          onAdd={handleAddMonth}
          onClose={() => setShowAddMonth(false)}
          error={error}
          setError={setError}
        />
      )}

    </div>
  );
}

function AddMonthModal({ existingMonths, onAdd, onClose, error, setError }) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [localError, setLocalError] = useState('');

  const years = Array.from({ length: 7 }, (_, i) => currentYear - 3 + i);

  function isTaken(y, m) {
    return existingMonths.some((em) => em.year === y && em.month === m);
  }

  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const selectedMonthTaken = isTaken(year, month);

  async function handleSubmit(e) {
    e.preventDefault();
    setLocalError('');
    if (selectedMonthTaken) {
      setLocalError('This month already exists in the dossier');
      return;
    }
    onAdd({ year, month });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Add Month</h2>
          <button className="close-btn" onClick={onClose}>
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {(localError || error) && (
              <div className="alert alert-error">{localError || error}</div>
            )}
            <div style={{ display: 'flex', gap: '1rem' }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Month</label>
                <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                  {months.map((m) => (
                    <option key={m} value={m} disabled={isTaken(year, m)}>
                      {new Date(year, m - 1).toLocaleString('en-US', { month: 'long' })}
                      {isTaken(year, m) ? ' (added)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Year</label>
                <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
                  {years.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {selectedMonthTaken && (
              <div className="alert alert-error">
                {new Date(year, month - 1).toLocaleString('en-US', { month: 'long' })} {year} is
                already added.
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={selectedMonthTaken}>
              Add &amp; open
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
