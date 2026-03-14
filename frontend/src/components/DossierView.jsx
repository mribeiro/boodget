import { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { api } from '../services/api';
import { AuthContext, AppContext } from '../App';
import CapitalChart from './CapitalChart';
import CapitalCompareTable from './CapitalCompareTable';
import AccountManager from './AccountManager';
import ShareManager from './ShareManager';
import ExpensesTab from './expenses/ExpensesTab';
import DossierSettingsTab from './DossierSettingsTab';
import WorkbenchTab from './workbench/WorkbenchTab';
import GoalsTab from './goals/GoalsTab';
import GlancesPanel from './glances/GlancesPanel';

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
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value) + ' €';
}

export default function DossierView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useContext(AuthContext);
  const { setCurrentDossier } = useContext(AppContext);
  const autoOpened = location.state?.autoOpened === true;

  const [dossier, setDossier] = useState(null);
  const [months, setMonths] = useState([]);
  const [activeTab, setActiveTab] = useState(location.state?.tab ?? 'capital');
  const [showAccountManager, setShowAccountManager] = useState(false);
  const [showShareManager, setShowShareManager] = useState(false);
  const [showAddMonth, setShowAddMonth] = useState(false);
  const [compareView, setCompareView] = useState(false);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    Promise.all([api.getDossier(id), api.getMonths(id)])
      .then(([d, m]) => {
        setDossier(d);
        setMonths(m);
        setCurrentDossier(d);
      })
      .catch(() => setError('Failed to load dossier'));
  }, [id]);

  async function handleExport() {
    setExporting(true);
    try {
      const data = await api.exportDossier(id);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${dossier.name.replace(/[^a-z0-9]/gi, '_')}_export.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  }

  async function handleDeleteDossier() {
    if (!confirm(`Delete dossier "${dossier.name}"? This cannot be undone.`)) return;
    try {
      await api.deleteDossier(id);
      navigate('/');
    } catch (err) {
      setError(err.message);
    }
  }

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
    <div>
      {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      <div className="page-header">
        {!autoOpened && (
          <button className="btn-ghost" onClick={() => navigate('/')}>
            &larr; Back
          </button>
        )}
        <h1 style={{ flex: 1 }}>{dossier.name}</h1>
        <div className="page-header-actions">
          <button className="btn-secondary" onClick={() => setShowAccountManager(true)}>
            Accounts
          </button>
          <button className="btn-secondary" onClick={handleExport} disabled={exporting}>
            {exporting ? 'Exporting…' : 'Export'}
          </button>
          {dossier.is_creator ? (
            <>
              <button className="btn-secondary" onClick={() => setShowShareManager(true)}>
                Share
              </button>
              <button className="btn-danger" onClick={handleDeleteDossier}>
                Delete
              </button>
            </>
          ) : null}
        </div>
      </div>

      <GlancesPanel
        dossierId={id}
        months={months}
        onNavigate={setActiveTab}
      />

      <div className="tabs tabs--dossier">
        {[
          { key: 'capital',   icon: '€',  label: 'Capital' },
          { key: 'expenses',  icon: '📅', label: 'Monthly Expenses' },
          { key: 'workbench', icon: '⚖',  label: 'Workbench' },
          { key: 'goals',     icon: '◎',  label: 'Goals' },
          { key: 'settings',  icon: '⚙',  label: 'Settings' },
        ].map(({ key, icon, label }) => (
          <button
            key={key}
            className={`tab-btn${activeTab === key ? ' active' : ''}`}
            onClick={() => setActiveTab(key)}
          >
            <span className="tab-btn-icon">{icon}</span>
            <span className="tab-btn-label">{label}</span>
          </button>
        ))}
      </div>

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
                  Add month
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
                {/* Top placeholder: nudge to fill the newest month if it's unfilled */}
                {!months[0].filled && (
                  <div
                    className="month-row month-row-placeholder"
                    onClick={() => navigate(`/dossiers/${id}/months/${months[0].id}`)}
                  >
                    <span className="month-row-name">Fill {monthLabel(months[0].year, months[0].month)}</span>
                  </div>
                )}

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
                      <div style={{ display: 'flex', gap: '2rem', alignItems: 'center', flex: 1, justifyContent: 'flex-end' }}>
                        {m.filled && (
                          <div style={{ textAlign: 'right' }}>
                            {m.capital_total != null && (
                              <div style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
                                {formatEur(m.capital_total)}
                                {capitalDiff != null && (
                                  <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: capitalDiff > 0 ? 'var(--color-success)' : capitalDiff < 0 ? 'var(--color-danger)' : 'var(--color-text-muted)' }}>
                                    {capitalDiff > 0 ? '+' : ''}{formatEur(capitalDiff)}
                                  </span>
                                )}
                              </div>
                            )}
                            {m.idle_total != null && (
                              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.15rem' }}>
                                Idle: {formatEur(m.idle_total)}
                                {idleDiff != null && (
                                  <span style={{ marginLeft: '0.4rem', color: idleDiff > 0 ? 'var(--color-success)' : idleDiff < 0 ? 'var(--color-danger)' : 'var(--color-text-muted)' }}>
                                    {idleDiff > 0 ? '+' : ''}{formatEur(idleDiff)}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                        <span className={`badge ${m.filled ? 'badge-filled' : 'badge-empty'}`}>
                          {m.filled ? 'Filled' : 'Not filled'}
                        </span>
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

      {activeTab === 'workbench' && (
        <WorkbenchTab dossierId={id} />
      )}

      {activeTab === 'goals' && (
        <GoalsTab dossierId={id} />
      )}

      {activeTab === 'settings' && (
        <DossierSettingsTab dossierId={id} />
      )}

      {showAddMonth && (
        <AddMonthModal
          existingMonths={months}
          onAdd={handleAddMonth}
          onClose={() => setShowAddMonth(false)}
          error={error}
          setError={setError}
        />
      )}

      {showAccountManager && (
        <AccountManager dossierId={id} onClose={() => setShowAccountManager(false)} />
      )}

      {showShareManager && (
        <ShareManager dossierId={id} onClose={() => setShowShareManager(false)} />
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
            &times;
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
