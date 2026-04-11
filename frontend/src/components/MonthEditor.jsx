import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft, faArrowsRotate, faRotateLeft, faFloppyDisk, faChevronRight } from '@fortawesome/free-solid-svg-icons';
import { api } from '../services/api';
import ConfirmModal from './ConfirmModal';
import KpiStrip from './ui/KpiStrip';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function monthLabel(year, month) {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

export default function MonthEditor() {
  const { id: dossierId, monthId } = useParams();
  const navigate = useNavigate();

  const [monthData, setMonthData] = useState(null);
  const [values, setValues] = useState({});   // accountId -> value (string)
  const [comments, setComments] = useState({}); // accountId -> comment
  const [overallComment, setOverallComment] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [confirmState, setConfirmState] = useState(null);

  function toggleRow(id) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  useEffect(() => {
    window.scrollTo(0, 0);
    api
      .getMonth(dossierId, monthId)
      .then((data) => {
        setMonthData(data);
        setOverallComment(data.comment || '');
        const v = {};
        const c = {};
        for (const entry of data.entries) {
          v[entry.id] = entry.value != null ? String(entry.value) : '';
          c[entry.id] = entry.comment || '';
        }
        setValues(v);
        setComments(c);
      })
      .catch(() => setError('Failed to load month data'));
  }, [dossierId, monthId]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      const entries = (monthData?.entries || []).map((entry) => ({
        accountId: entry.id,
        value: values[entry.id] !== '' ? parseFloat(values[entry.id]) : null,
        comment: comments[entry.id] || null,
      }));
      await api.saveMonth(dossierId, monthId, { entries, comment: overallComment || null });
      navigate(`/dossiers/${dossierId}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSyncAccounts() {
    setError('');
    setSuccess('');
    try {
      await api.syncMonthAccounts(dossierId, monthId);
      const data = await api.getMonth(dossierId, monthId);
      setMonthData(data);
      const v = { ...values };
      const c = { ...comments };
      for (const entry of data.entries) {
        if (!(entry.id in v)) {
          v[entry.id] = '';
          c[entry.id] = '';
        }
      }
      setValues(v);
      setComments(c);
      setSuccess('New accounts added to this month');
    } catch (err) {
      setError(err.message);
    }
  }

  function handleReset() {
    setConfirmState({
      title: 'Reset month',
      message: 'Reset this month? All values and comments will be cleared.',
      confirmLabel: 'Reset',
      danger: true,
      onConfirm: async () => {
        setError('');
        setSuccess('');
        try {
          await api.resetMonth(dossierId, monthId);
          const data = await api.getMonth(dossierId, monthId);
          setMonthData(data);
          setOverallComment('');
          const v = {};
          const c = {};
          for (const entry of data.entries) {
            v[entry.id] = '';
            c[entry.id] = '';
          }
          setValues(v);
          setComments(c);
          setSuccess('Month has been reset');
        } catch (err) {
          setError(err.message);
        }
      },
    });
  }

  function focusValueAt(index) {
    document.querySelector(`[data-value-idx="${index}"]`)?.focus();
  }

  function handleValueKeyDown(e, index) {
    if (e.key === 'Enter') {
      e.preventDefault();
      focusValueAt(index + 1);
    }
  }

  function handleCommentKeyDown(e, index) {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      focusValueAt(index + 1);
    }
  }

  if (!monthData) return <div className="loading">Loading...</div>;

  const entryIndexMap = Object.fromEntries(monthData.entries.map((entry, i) => [entry.id, i]));

  // Group entries by group_name
  const groups = monthData.entries.reduce((acc, entry) => {
    if (!acc[entry.group_name]) acc[entry.group_name] = [];
    acc[entry.group_name].push(entry);
    return acc;
  }, {});

  return (
    <div>
      <div className="page-header">
        <button className="btn-ghost" onClick={() => navigate(`/dossiers/${dossierId}`)}>
          <FontAwesomeIcon icon={faArrowLeft} style={{ marginRight: '0.4rem' }} />Back
        </button>
        <h1 style={{ flex: 1 }}>
          {monthLabel(monthData.year, monthData.month)}
          {monthData.filled ? (
            <span className="badge badge-filled" style={{ marginLeft: '0.75rem', verticalAlign: 'middle' }}>
              Filled
            </span>
          ) : (
            <span className="badge badge-empty" style={{ marginLeft: '0.75rem', verticalAlign: 'middle' }}>
              Not filled
            </span>
          )}
        </h1>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}
      {success && <div className="alert alert-success" style={{ marginBottom: '1rem' }}>{success}</div>}
      {monthData && monthData.missing_accounts > 0 && (
        <div className="alert alert-error" style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>
            {monthData.missing_accounts} account{monthData.missing_accounts > 1 ? 's' : ''} exist{monthData.missing_accounts === 1 ? 's' : ''} that {monthData.missing_accounts === 1 ? 'is' : 'are'} not part of this month yet.
          </span>
          <button className="btn-secondary" style={{ marginLeft: '1rem', whiteSpace: 'nowrap' }} onClick={handleSyncAccounts}>
            <FontAwesomeIcon icon={faArrowsRotate} style={{ marginRight: '0.4rem' }} />Add to month
          </button>
        </div>
      )}

      {/* ── KPI strip ── */}
      {monthData && monthData.entries.length > 0 && (() => {
        const filledCount = monthData.entries.filter((e) => values[e.id] !== '').length;
        const total = monthData.entries.reduce((s, e) => {
          const v = parseFloat(values[e.id]);
          return s + (isNaN(v) ? 0 : v);
        }, 0);
        const deltaSum = monthData.entries.reduce((s, e) => {
          if (e.prev_value == null) return s;
          const v = parseFloat(values[e.id]);
          if (isNaN(v)) return s;
          return s + (v - e.prev_value);
        }, 0);
        const hasDelta = monthData.entries.some((e) => e.prev_value != null && values[e.id] !== '');
        const idleEntries = monthData.entries.filter((e) => e.is_idle_money);
        const idleTotal = idleEntries.reduce((s, e) => {
          const v = parseFloat(values[e.id]);
          return s + (isNaN(v) ? 0 : v);
        }, 0);
        const idleDelta = idleEntries.reduce((s, e) => {
          if (e.prev_value == null) return s;
          const v = parseFloat(values[e.id]);
          if (isNaN(v)) return s;
          return s + (v - e.prev_value);
        }, 0);
        const hasIdleDelta = idleEntries.some((e) => e.prev_value != null && values[e.id] !== '');
        const hasIdleFilled = idleEntries.some((e) => values[e.id] !== '');
        const fmt = (n) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + ' €';
        return (
          <KpiStrip style={{ marginBottom: '1.25rem' }} items={[
            { label: 'Filled', value: `${filledCount} / ${monthData.entries.length}`, highlight: filledCount === monthData.entries.length ? 'success' : 'neutral' },
            { label: 'Total', value: filledCount > 0 ? fmt(total) : '—', large: true },
            hasDelta ? { label: 'Net change', value: `${deltaSum >= 0 ? '+' : ''}${fmt(deltaSum)}`, highlight: deltaSum > 0 ? 'success' : deltaSum < 0 ? 'danger' : 'neutral' } : null,
            idleEntries.length > 0 && hasIdleFilled ? { label: 'Idle', value: fmt(idleTotal) } : null,
            idleEntries.length > 0 && hasIdleDelta ? { label: 'Idle change', value: `${idleDelta >= 0 ? '+' : ''}${fmt(idleDelta)}`, highlight: idleDelta > 0 ? 'success' : idleDelta < 0 ? 'danger' : 'neutral' } : null,
          ]} />
        );
      })()}

      <form onSubmit={handleSubmit}>
        <div className="month-editor">
          {monthData.entries.length === 0 ? (
            <div className="empty-state">
              <p>No accounts were configured when this month was created.</p>
              <p>Go back and add accounts to the dossier, then create a new month.</p>
            </div>
          ) : (
            <>
              <div className="overall-comment">
                <label htmlFor="overall-comment">Overall comment (optional)</label>
                <textarea
                  id="overall-comment"
                  value={overallComment}
                  onChange={(e) => setOverallComment(e.target.value)}
                  placeholder="Notes about this month..."
                  rows={2}
                />
              </div>

              <div className="mobile-cards table-container" style={{ border: 'none', borderRadius: 0 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Account</th>
                      <th>Type</th>
                      <th style={{ textAlign: 'center' }}>Idle</th>
                      <th style={{ textAlign: 'right' }}>Value (€)</th>
                      <th>Comment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(groups).map(([groupName, entries]) => (
                      <React.Fragment key={groupName}>
                        <tr className="group-header">
                          <td colSpan={5}>{groupName}</td>
                        </tr>
                        {entries.map((entry) => (
                          <tr key={entry.id} className={expandedRows.has(entry.id) ? 'mobile-expanded' : ''}>
                            <td className="mobile-card-title" onClick={() => toggleRow(entry.id)}>
                              <span>
                                {entry.name}
                                {entry.archived ? (
                                  <span
                                    className="badge"
                                    style={{
                                      marginLeft: '0.5rem',
                                      background: '#f1f5f9',
                                      color: 'var(--color-text-muted)',
                                      fontSize: '0.7rem',
                                    }}
                                  >
                                    Archived
                                  </span>
                                ) : null}
                              </span>
                              <button className="card-expand-btn" tabIndex={-1}><FontAwesomeIcon icon={faChevronRight} /></button>
                            </td>
                            <td data-label="Type" className="mobile-detail text-muted" style={{ fontSize: '0.8rem' }}>
                              {entry.type}
                            </td>
                            <td data-label="Idle" className="mobile-detail" style={{ textAlign: 'center' }}>
                              {entry.is_idle_money ? (
                                <span style={{ color: 'var(--color-text-muted)' }}>Yes</span>
                              ) : <span style={{ color: 'var(--color-text-muted)' }}>No</span>}
                            </td>
                            <td data-label="Value">
                              {entry.prev_value != null && (
                                <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginBottom: '0.2rem', textAlign: 'right' }}>
                                  {entry.prev_value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </div>
                              )}
                              <input
                                type="number" inputMode="decimal"
                                step="0.01"
                                min="0"
                                placeholder="0.00"
                                className="value-input"
                                data-value-idx={entryIndexMap[entry.id]}
                                value={values[entry.id] ?? ''}
                                onChange={(e) =>
                                  setValues((v) => ({ ...v, [entry.id]: e.target.value }))
                                }
                                onKeyDown={(e) => handleValueKeyDown(e, entryIndexMap[entry.id])}
                              />
                              {(() => {
                                if (entry.prev_value == null) return null;
                                const current = values[entry.id] !== '' ? parseFloat(values[entry.id]) : null;
                                if (current == null) return null;
                                const diff = current - entry.prev_value;
                                const color = diff > 0 ? 'var(--color-success, #16a34a)' : diff < 0 ? 'var(--color-danger)' : 'var(--color-text-muted)';
                                const sign = diff > 0 ? '+' : '';
                                return (
                                  <div style={{ fontSize: '0.72rem', color, marginTop: '0.2rem', textAlign: 'right' }}>
                                    {sign}{diff.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </div>
                                );
                              })()}
                            </td>
                            <td data-label="Comment" className="mobile-detail">
                              <input
                                type="text"
                                placeholder="Optional comment"
                                className="comment-input"
                                value={comments[entry.id] ?? ''}
                                onChange={(e) =>
                                  setComments((c) => ({ ...c, [entry.id]: e.target.value }))
                                }
                                onKeyDown={(e) => handleCommentKeyDown(e, entryIndexMap[entry.id])}
                              />
                            </td>
                          </tr>
                        ))}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {monthData.entries.length > 0 && (
            <div className="month-editor-footer">
              <button type="button" className="btn-secondary" onClick={handleReset}>
                <FontAwesomeIcon icon={faRotateLeft} style={{ marginRight: '0.4rem' }} />Reset
              </button>
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? 'Saving...' : <><FontAwesomeIcon icon={faFloppyDisk} style={{ marginRight: '0.4rem' }} />Save</>}
              </button>
            </div>
          )}
        </div>
      </form>
      {confirmState && <ConfirmModal {...confirmState} onCancel={() => setConfirmState(null)} />}
    </div>
  );
}
