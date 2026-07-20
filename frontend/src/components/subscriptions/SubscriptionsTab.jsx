import { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faPencil, faTrash, faCheck, faTriangleExclamation, faEye, faEyeSlash, faBan, faArrowRotateLeft, faXmark, faClock } from '@fortawesome/free-solid-svg-icons';
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

  useEffect(() => {
    load();
  }, [dossierId, showCancelled]);

  function showToast(msg) {
    setToast({ msg, show: true });
    setTimeout(() => setToast((t) => ({ ...t, show: false })), 2000);
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
      message: `Cancel "${sub.name}"? It will stop counting toward totals and coverage, and drop out of the list unless "Show cancelled" is on. Nothing is lost — you can reactivate it any time.`,
      confirmLabel: 'Cancel subscription',
      danger: false,
      onConfirm: () => handleToggleStatus(sub),
    });
  }

  function handleDelete(sub) {
    setConfirmState({
      title: 'Delete subscription',
      message: `Permanently delete "${sub.name}" and its history? This cannot be undone. If you just want to pause it, use Cancel instead.`,
      confirmLabel: 'Delete permanently',
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {sorted.map((sub) => {
            const cancelled = sub.status === 'cancelled';
            const coverage = sub.linked_distribution ? coverageByDistribution.get(sub.linked_distribution.id) : null;
            return (
              <div
                key={sub.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.3rem',
                  padding: '0.6rem 0.75rem',
                  background: 'var(--bg-card)',
                  borderRadius: 'var(--radius)',
                  border: '1px solid var(--border-default)',
                  opacity: cancelled ? 0.5 : 1,
                  transition: 'opacity 0.25s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.4rem' }}>
                    <span style={{
                      fontWeight: 500,
                      textDecoration: cancelled ? 'line-through' : 'none',
                      color: cancelled ? 'var(--text-muted)' : 'var(--text-primary)',
                      transition: 'color 0.25s ease',
                    }}>
                      {sub.name}
                    </span>
                    {cancelled && (
                      <span style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem', borderRadius: '999px', background: 'var(--bg-surface)', color: 'var(--text-muted)', border: '1px solid var(--border-default)', fontWeight: 500, whiteSpace: 'nowrap' }}>
                        Cancelled
                      </span>
                    )}
                    {sub.billing_day != null && (
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        <FontAwesomeIcon icon={faClock} style={{ fontSize: '0.65rem', marginRight: 2 }} />
                        day {sub.billing_day}
                      </span>
                    )}
                  </div>
                  {sub.linked_distribution && <CoveragePill coverage={coverage} />}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {sub.linked_distribution ? sub.linked_distribution.name : ' '}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', flexShrink: 0 }}>
                    <span style={{ fontSize: '0.875rem', fontWeight: 500, color: cancelled ? 'var(--text-muted)' : 'var(--text-primary)', transition: 'color 0.25s ease', marginRight: '0.25rem' }}>
                      {formatEur(sub.monthly_cost)}
                    </span>
                    <button
                      onClick={() => { setEditingItem(sub); setShowModal(true); }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.8rem', padding: '0 0.25rem', flexShrink: 0 }}
                      title="Edit"
                    >
                      <FontAwesomeIcon icon={faPencil} />
                    </button>
                    {cancelled ? (
                      <button
                        onClick={() => handleToggleStatus(sub)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.8rem', padding: '0 0.25rem', flexShrink: 0 }}
                        title="Reactivate"
                      >
                        <FontAwesomeIcon icon={faArrowRotateLeft} />
                      </button>
                    ) : (
                      <button
                        onClick={() => handleCancel(sub)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.8rem', padding: '0 0.25rem', flexShrink: 0 }}
                        title="Cancel"
                      >
                        <FontAwesomeIcon icon={faBan} />
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(sub)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.8rem', padding: '0 0.25rem', flexShrink: 0 }}
                      title="Delete"
                    >
                      <FontAwesomeIcon icon={faTrash} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
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
