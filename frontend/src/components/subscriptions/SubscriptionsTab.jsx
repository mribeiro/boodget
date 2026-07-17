import { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faPencil, faTrash, faCheck, faTriangleExclamation, faEye, faEyeSlash, faBan, faArrowRotateLeft, faXmark, faChevronRight } from '@fortawesome/free-solid-svg-icons';
import { api } from '../../services/api';
import { parseDecimalInput, formatNumber } from '../../utils/numbers';
import ConfirmModal from '../ConfirmModal';
import KpiStrip from '../ui/KpiStrip';
import Toast from '../ui/Toast';

function formatEur(value) {
  if (value == null) return '—';
  return formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

// Same wraparound convention as sortTemplateExpenses (ExpenseTemplate.jsx) / CycleEditor.jsx:
// days >= cycle_start_day first (asc), then days < cycle_start_day (asc). No billing day sorts last.
function sortSubscriptions(subs, cycleStartDay) {
  const start = cycleStartDay ?? 25;
  const withDay = subs.filter((s) => s.billing_day != null);
  const noDay = subs.filter((s) => s.billing_day == null);
  const firstHalf = withDay.filter((s) => s.billing_day >= start).sort((a, b) => a.billing_day - b.billing_day);
  const secondHalf = withDay.filter((s) => s.billing_day < start).sort((a, b) => a.billing_day - b.billing_day);
  return [...firstHalf, ...secondHalf, ...noDay];
}

// Groups active subscriptions by their linked distribution and compares the total against that
// distribution's budgeted value — mirrors the Loans linked-expense coverage check (0.005 epsilon).
function computeCoverageByDistribution(subscriptions) {
  const map = new Map();
  for (const s of subscriptions) {
    if (s.status !== 'active' || !s.linked_distribution) continue;
    const d = s.linked_distribution;
    if (!map.has(d.id)) map.set(d.id, { name: d.name, value: d.value, total: 0 });
    map.get(d.id).total += s.monthly_cost;
  }
  for (const entry of map.values()) {
    entry.covered = entry.value >= entry.total - 0.005;
    entry.difference = entry.value - entry.total;
  }
  return map;
}

function CoveragePill({ coverage }) {
  if (!coverage) return null;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.3rem',
        padding: '2px 8px',
        borderRadius: 'var(--radius-full)',
        fontSize: 10,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        background: coverage.covered ? 'var(--color-success-light)' : 'var(--color-danger-light)',
        color: coverage.covered ? 'var(--color-success-text)' : 'var(--color-danger-text)',
        border: `1px solid ${coverage.covered ? 'var(--color-success-border)' : 'var(--color-danger-border)'}`,
      }}
    >
      {coverage.covered ? (
        <><FontAwesomeIcon icon={faCheck} style={{ fontSize: 8 }} />Covered</>
      ) : (
        <><FontAwesomeIcon icon={faTriangleExclamation} style={{ fontSize: 8 }} />Over by {formatEur(Math.abs(coverage.difference))}</>
      )}
    </span>
  );
}

export default function SubscriptionsTab({ dossierId }) {
  const [subscriptions, setSubscriptions] = useState([]);
  const [distributions, setDistributions] = useState([]);
  const [cycleStartDay, setCycleStartDay] = useState(25);
  const [showCancelled, setShowCancelled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [confirmState, setConfirmState] = useState(null);
  const [toast, setToast] = useState({ msg: '', show: false });
  const [expandedRows, setExpandedRows] = useState(new Set());

  useEffect(() => {
    load();
  }, [dossierId, showCancelled]);

  function showToast(msg) {
    setToast({ msg, show: true });
    setTimeout(() => setToast((t) => ({ ...t, show: false })), 2000);
  }

  function toggleRow(id) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [subs, template, settings] = await Promise.all([
        api.getSubscriptions(dossierId, showCancelled),
        api.getExpenseTemplate(dossierId),
        api.getDossierSettings(dossierId),
      ]);
      setSubscriptions(subs);
      setDistributions(template.filter((i) => i.section === 'distribution'));
      setCycleStartDay(settings.cycle_start_day ?? 25);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(data, itemId) {
    if (itemId) {
      const updated = await api.updateSubscription(dossierId, itemId, data);
      setSubscriptions((prev) => prev.map((s) => (s.id === itemId ? updated : s)));
      showToast('Subscription updated');
    } else {
      const created = await api.createSubscription(dossierId, data);
      setSubscriptions((prev) => [...prev, created]);
      showToast('Subscription added');
    }
    setShowModal(false);
    setEditingItem(null);
  }

  async function handleToggleStatus(sub) {
    try {
      const nextStatus = sub.status === 'active' ? 'cancelled' : 'active';
      const updated = await api.updateSubscription(dossierId, sub.id, { status: nextStatus });
      if (nextStatus === 'cancelled' && !showCancelled) {
        setSubscriptions((prev) => prev.filter((s) => s.id !== sub.id));
      } else {
        setSubscriptions((prev) => prev.map((s) => (s.id === sub.id ? updated : s)));
      }
      showToast(nextStatus === 'cancelled' ? 'Subscription cancelled' : 'Subscription reactivated');
    } catch (err) {
      setError(err.message);
    }
  }

  function handleCancel(sub) {
    setConfirmState({
      title: 'Cancel subscription',
      message: `Cancel "${sub.name}"? It will stop counting toward totals and coverage. You can reactivate it later.`,
      confirmLabel: 'Cancel subscription',
      danger: true,
      onConfirm: () => handleToggleStatus(sub),
    });
  }

  function handleDelete(sub) {
    setConfirmState({
      title: 'Delete subscription',
      message: `Permanently delete "${sub.name}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: async () => {
        try {
          await api.deleteSubscription(dossierId, sub.id);
          setSubscriptions((prev) => prev.filter((s) => s.id !== sub.id));
          showToast('Subscription deleted');
        } catch (err) {
          setError(err.message);
        }
      },
    });
  }

  if (loading) return <div className="loading">Loading…</div>;

  const activeSubs = subscriptions.filter((s) => s.status === 'active');
  const totalMonthlyCost = activeSubs.reduce((sum, s) => sum + s.monthly_cost, 0);
  const coverageByDistribution = computeCoverageByDistribution(subscriptions);
  const sorted = sortSubscriptions(subscriptions, cycleStartDay);

  return (
    <div>
      {error && <div className="alert alert-error" style={{ marginBottom: 'var(--space-4)' }}>{error}</div>}

      <div className="section-header" style={{ marginBottom: 'var(--space-5)' }}>
        <h2 style={{ margin: 0 }}>Subscriptions</h2>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button className="btn-secondary" onClick={() => setShowCancelled((v) => !v)}>
            <FontAwesomeIcon icon={showCancelled ? faEyeSlash : faEye} style={{ marginRight: '0.4rem' }} />
            {showCancelled ? 'Hide cancelled' : 'Show cancelled'}
          </button>
          <button className="btn-primary" onClick={() => { setEditingItem(null); setShowModal(true); }}>
            <FontAwesomeIcon icon={faPlus} style={{ marginRight: '0.4rem' }} />Add subscription
          </button>
        </div>
      </div>

      {subscriptions.length > 0 && (
        <KpiStrip defaultOpen style={{ marginBottom: 'var(--space-5)' }} items={[
          { label: 'Monthly total', value: formatEur(totalMonthlyCost), large: true },
          { label: 'Active subscriptions', value: String(activeSubs.length) },
        ]} />
      )}

      {subscriptions.length === 0 ? (
        <div className="empty-state">
          <p>No subscriptions tracked yet. Add one to keep an eye on recurring personal costs.</p>
          <button className="btn-primary" onClick={() => { setEditingItem(null); setShowModal(true); }}>
            Add subscription
          </button>
        </div>
      ) : (
        <div className="mobile-cards table-container">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}>
                <th style={{ padding: '0.5rem' }}>Name</th>
                <th style={{ padding: '0.5rem', textAlign: 'right' }}>Monthly cost</th>
                <th style={{ padding: '0.5rem' }}>Billing day</th>
                <th style={{ padding: '0.5rem' }}>Linked distribution</th>
                <th style={{ padding: '0.5rem' }}></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((sub) => {
                const cancelled = sub.status === 'cancelled';
                const coverage = sub.linked_distribution ? coverageByDistribution.get(sub.linked_distribution.id) : null;
                return (
                  <tr
                    key={sub.id}
                    className={expandedRows.has(sub.id) ? 'mobile-expanded' : ''}
                    style={{
                      borderTop: '1px solid var(--border-default)',
                      opacity: cancelled ? 0.55 : 1,
                    }}
                  >
                    <td className="mobile-card-title" style={{ padding: '0.5rem' }} onClick={() => toggleRow(sub.id)}>
                      <span style={{ textDecoration: cancelled ? 'line-through' : 'none' }}>{sub.name}</span>
                      {cancelled && (
                        <span style={{ marginLeft: '0.4rem', fontSize: '0.65rem', padding: '0.1rem 0.4rem', borderRadius: '999px', background: 'var(--bg-surface)', color: 'var(--text-muted)', border: '1px solid var(--border-default)', fontWeight: 500 }}>
                          Cancelled
                        </span>
                      )}
                      <span className="mobile-card-inline-value">{formatEur(sub.monthly_cost)}</span>
                      <button className="card-expand-btn" tabIndex={-1}><FontAwesomeIcon icon={faChevronRight} /></button>
                    </td>
                    <td data-label="Monthly cost" className="mobile-summary-in-title" style={{ padding: '0.5rem', textAlign: 'right' }}>{formatEur(sub.monthly_cost)}</td>
                    <td data-label="Billing day" className="mobile-detail" style={{ padding: '0.5rem', color: 'var(--text-muted)' }}>
                      {sub.billing_day ?? '—'}
                    </td>
                    <td data-label="Linked distribution" className="mobile-detail" style={{ padding: '0.5rem' }}>
                      {sub.linked_distribution ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                          <span>{sub.linked_distribution.name}</span>
                          <CoveragePill coverage={coverage} />
                        </div>
                      ) : '—'}
                    </td>
                    <td data-label="" className="mobile-detail" style={{ padding: '0.5rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        className="btn-secondary"
                        onClick={() => { setEditingItem(sub); setShowModal(true); }}
                        style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', marginRight: '0.25rem' }}
                      >
                        <FontAwesomeIcon icon={faPencil} style={{ marginRight: '0.35rem' }} />Edit
                      </button>
                      {cancelled ? (
                        <button
                          className="btn-secondary"
                          onClick={() => handleToggleStatus(sub)}
                          style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', marginRight: '0.25rem' }}
                        >
                          <FontAwesomeIcon icon={faArrowRotateLeft} style={{ marginRight: '0.35rem' }} />Reactivate
                        </button>
                      ) : (
                        <button
                          className="btn-secondary"
                          onClick={() => handleCancel(sub)}
                          style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', marginRight: '0.25rem' }}
                        >
                          <FontAwesomeIcon icon={faBan} style={{ marginRight: '0.35rem' }} />Cancel
                        </button>
                      )}
                      <button
                        className="btn-danger"
                        onClick={() => handleDelete(sub)}
                        style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                      >
                        <FontAwesomeIcon icon={faTrash} style={{ marginRight: '0.35rem' }} />Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <SubscriptionFormModal
          item={editingItem}
          distributions={distributions}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setEditingItem(null); }}
        />
      )}
      {confirmState && <ConfirmModal {...confirmState} onCancel={() => setConfirmState(null)} />}
      <Toast message={toast.msg} visible={toast.show} />
    </div>
  );
}

function SubscriptionFormModal({ item, distributions, onSave, onClose }) {
  const [name, setName] = useState(item?.name ?? '');
  const [monthlyCost, setMonthlyCost] = useState(item?.monthly_cost != null ? String(item.monthly_cost) : '');
  const [billingDay, setBillingDay] = useState(item?.billing_day != null ? String(item.billing_day) : '');
  const [distributionId, setDistributionId] = useState(item?.linked_distribution?.id ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!name.trim()) { setError('Name is required'); return; }
    const cost = parseDecimalInput(monthlyCost);
    if (isNaN(cost) || cost < 0) { setError('Monthly cost must be a non-negative number'); return; }
    let day = null;
    if (billingDay.trim() !== '') {
      day = Number(billingDay);
      if (!Number.isInteger(day) || day < 1 || day > 31) { setError('Billing day must be 1–31'); return; }
    }
    setSaving(true);
    try {
      await onSave(
        {
          name: name.trim(),
          monthly_cost: cost,
          billing_day: day,
          distribution_template_item_id: distributionId || null,
        },
        item?.id
      );
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{item ? 'Edit' : 'Add'} Subscription</h2>
          <button className="close-btn" onClick={onClose}><FontAwesomeIcon icon={faXmark} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="alert alert-error">{error}</div>}
            <div className="form-group">
              <label>Name</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Claude" />
            </div>
            <div className="form-group">
              <label>Monthly cost (€)</label>
              <input type="text" inputMode="decimal" value={monthlyCost} onChange={(e) => setMonthlyCost(e.target.value)} placeholder="0.00" />
            </div>
            <div className="form-group">
              <label>Billing day (1–31, optional)</label>
              <input type="number" inputMode="numeric" min={1} max={31} value={billingDay} onChange={(e) => setBillingDay(e.target.value)} placeholder="e.g. 15" />
            </div>
            <div className="form-group">
              <label>Linked distribution (optional)</label>
              <select value={distributionId} onChange={(e) => setDistributionId(e.target.value)}>
                <option value="">— None —</option>
                {distributions.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
                Multiple subscriptions can share the same distribution — their costs are summed and
                compared against the distribution's budgeted amount.
              </div>
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
