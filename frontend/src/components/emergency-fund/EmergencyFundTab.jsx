import { useState, useEffect, useCallback, useRef } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCheck, faTriangleExclamation, faListCheck, faPlus, faPencil, faTrash, faXmark } from '@fortawesome/free-solid-svg-icons';
import { api } from '../../services/api';
import ConfirmModal from '../ConfirmModal';
import Checkbox from '../ui/Checkbox';
import Toast from '../ui/Toast';

function formatEur(value) {
  if (value == null) return '—';
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value) + ' €';
}

function ProgressBar({ current, target }) {
  const pct = target > 0 ? Math.min(100, (current / target) * 100) : 0;
  const color =
    pct >= 100 ? 'var(--color-success)' :
    pct >= 50  ? 'var(--color-warning)' :
    'var(--color-danger)';
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
        <span>{pct.toFixed(1)}% funded</span>
        <span>{formatEur(current)} / {formatEur(target)}</span>
      </div>
      <div style={{ height: 10, background: 'var(--border-default)', borderRadius: 'var(--radius-full)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 'var(--radius-full)', transition: 'width 0.3s ease' }} />
      </div>
    </div>
  );
}

function StatRow({ label, value, valueStyle }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border-default)' }}>
      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', ...valueStyle }}>{value}</span>
    </div>
  );
}

export default function EmergencyFundTab({ dossierId }) {
  const [status, setStatus] = useState(null);
  const [accounts, setAccounts] = useState([]);         // all non-archived dossier accounts
  const [selectedIds, setSelectedIds] = useState([]);   // currently selected account IDs
  const [extraValues, setExtraValues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmState, setConfirmState] = useState(null);
  const [toast, setToast] = useState({ msg: '', show: false });
  const toastTimer = useRef(null);
  function showToast(msg) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, show: true });
    toastTimer.current = setTimeout(() => setToast((t) => ({ ...t, show: false })), 2000);
  }

  // Account picker dialog state
  const [showAccountPicker, setShowAccountPicker] = useState(false);
  const [pickerSelection, setPickerSelection] = useState([]);

  // Extra value form state
  const [showExtraForm, setShowExtraForm] = useState(false);
  const [extraFormName, setExtraFormName] = useState('');
  const [extraFormValue, setExtraFormValue] = useState('');
  const [editingExtra, setEditingExtra] = useState(null);

  const loadAll = useCallback(async () => {
    try {
      const [st, accs, sel, evs] = await Promise.all([
        api.getEmergencyFundStatus(dossierId),
        api.getAccounts(dossierId, false),
        api.getEmergencyFundAccounts(dossierId),
        api.getEmergencyFundExtraValues(dossierId),
      ]);
      setStatus(st);
      setAccounts(accs);
      setSelectedIds(sel);
      setExtraValues(evs);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [dossierId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  async function refreshStatus() {
    try {
      const st = await api.getEmergencyFundStatus(dossierId);
      setStatus(st);
    } catch (e) { /* ignore */ }
  }

  // ── Account picker ─────────────────────────────────────────────────────────

  function openAccountPicker() {
    setPickerSelection([...selectedIds]);
    setShowAccountPicker(true);
  }

  async function saveAccountSelection() {
    try {
      const saved = await api.setEmergencyFundAccounts(dossierId, pickerSelection);
      setSelectedIds(saved);
      setShowAccountPicker(false);
      await refreshStatus();
      showToast('Accounts saved');
    } catch (e) {
      setError(e.message);
    }
  }

  function togglePicker(id) {
    setPickerSelection((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  // ── Extra values ───────────────────────────────────────────────────────────

  function openAddExtra() {
    setEditingExtra(null);
    setExtraFormName('');
    setExtraFormValue('');
    setShowExtraForm(true);
  }

  function openEditExtra(ev) {
    setEditingExtra(ev);
    setExtraFormName(ev.name);
    setExtraFormValue(String(ev.value));
    setShowExtraForm(true);
  }

  async function saveExtraForm(e) {
    e.preventDefault();
    const v = parseFloat(extraFormValue);
    if (!extraFormName.trim() || isNaN(v)) return;
    try {
      if (editingExtra) {
        const updated = await api.updateEmergencyFundExtraValue(dossierId, editingExtra.id, { name: extraFormName.trim(), value: v });
        setExtraValues((prev) => prev.map((x) => x.id === updated.id ? updated : x));
      } else {
        const created = await api.createEmergencyFundExtraValue(dossierId, { name: extraFormName.trim(), value: v });
        setExtraValues((prev) => [...prev, created]);
      }
      setShowExtraForm(false);
      await refreshStatus();
      showToast(editingExtra ? 'Value updated' : 'Value added');
    } catch (err) {
      setError(err.message);
    }
  }

  function deleteExtra(ev) {
    setConfirmState({
      title: 'Delete extra value',
      message: `Delete "${ev.name}"?`,
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: async () => {
        try {
          await api.deleteEmergencyFundExtraValue(dossierId, ev.id);
          setExtraValues((prev) => prev.filter((x) => x.id !== ev.id));
          await refreshStatus();
          showToast('Value deleted');
        } catch (e) {
          setError(e.message);
        }
      },
    });
  }

  if (loading) return <div className="loading">Loading…</div>;

  const isHealthy = status?.status === 'healthy';
  const isNoData  = status?.status === 'no_data';

  return (
    <div>
      {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      {/* ── Summary card ─────────────────────────────────────────────────── */}
      <div className="card card--flat" style={{ marginBottom: 'var(--space-5)' }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, borderBottom: '1px solid var(--border-default)', paddingBottom: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
          Emergency Fund Summary
        </h2>

        {isNoData ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            No expense cycles available. Open at least one cycle to calculate the emergency fund target.
          </p>
        ) : (
          <>
            <div style={{
              display: 'inline-block',
              padding: '4px 12px',
              borderRadius: 'var(--radius-full)',
              fontSize: 12,
              fontWeight: 600,
              marginBottom: 'var(--space-4)',
              background: isHealthy ? 'var(--color-success-light)' : 'var(--color-danger-light)',
              color: isHealthy ? 'var(--color-success-text)' : 'var(--color-danger-text)',
              border: `1px solid ${isHealthy ? 'var(--color-success-border)' : 'var(--color-danger-border)'}`,
            }}>
              {isHealthy
                ? <><FontAwesomeIcon icon={faCheck} style={{ marginRight: '0.35rem' }} />Healthy</>
                : <><FontAwesomeIcon icon={faTriangleExclamation} style={{ marginRight: '0.35rem' }} />Underfunded</>}
            </div>

            <ProgressBar current={status.current_value} target={status.target_value} />

            <div style={{ marginTop: 'var(--space-4)' }}>
              <StatRow label="Current value" value={formatEur(status.current_value)} />
              <StatRow
                label="Target value"
                value={formatEur(status.target_value)}
              />
              <StatRow
                label={isHealthy ? 'Surplus' : 'Deficit'}
                value={isHealthy
                  ? formatEur(status.current_value - status.target_value)
                  : formatEur(status.deficit)}
                valueStyle={{ color: isHealthy ? 'var(--color-success-text)' : 'var(--color-danger-text)' }}
              />
              <StatRow label="Months covered" value={`${status.months_covered}`} />
              <StatRow label="Average monthly expense" value={formatEur(status.average_monthly_expense)} />
              <StatRow label="Extra monthly total" value={formatEur(status.extra_monthly_total)} />
              <StatRow label="Effective monthly base" value={formatEur(status.effective_monthly_base)} />
              <StatRow
                label="Cycles considered"
                value={`${status.cycles_considered} of ${status.cycles_requested}`}
              />
            </div>
          </>
        )}
      </div>

      {/* ── Contributing accounts ─────────────────────────────────────────── */}
      <div className="card card--flat" style={{ marginBottom: 'var(--space-5)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-default)', paddingBottom: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Contributing Accounts</h2>
          <button className="btn-secondary" style={{ fontSize: 13 }} onClick={openAccountPicker}>
            <FontAwesomeIcon icon={faListCheck} style={{ marginRight: '0.4rem' }} />Select accounts
          </button>
        </div>

        {status?.contributing_accounts?.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No accounts selected. Click "Select accounts" to choose which accounts count toward the emergency fund.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Group</th>
                <th>Account</th>
                <th style={{ textAlign: 'right' }}>Current value</th>
              </tr>
            </thead>
            <tbody>
              {status?.contributing_accounts?.map((a) => (
                <tr key={a.account_id}>
                  <td style={{ color: 'var(--text-muted)' }}>{a.group_name}</td>
                  <td>{a.name}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatEur(a.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Extra monthly values ──────────────────────────────────────────── */}
      <div className="card card--flat">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-default)', paddingBottom: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Extra Monthly Values</h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' }}>
              Recurring costs not tracked through expense cycles (e.g. rent, school fees).
            </p>
          </div>
          <button className="btn-primary" style={{ fontSize: 13 }} onClick={openAddExtra}>
            <FontAwesomeIcon icon={faPlus} style={{ marginRight: '0.4rem' }} />Add
          </button>
        </div>

        {extraValues.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No extra values defined.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th style={{ textAlign: 'right' }}>Monthly value</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {extraValues.map((ev) => (
                <tr key={ev.id}>
                  <td>{ev.name}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatEur(ev.value)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn-ghost" style={{ fontSize: 12, padding: '2px 8px' }} onClick={() => openEditExtra(ev)}><FontAwesomeIcon icon={faPencil} style={{ marginRight: '0.3rem' }} />Edit</button>
                    <button className="btn-ghost" style={{ fontSize: 12, padding: '2px 8px', color: 'var(--color-danger)' }} onClick={() => deleteExtra(ev)}><FontAwesomeIcon icon={faTrash} style={{ marginRight: '0.3rem' }} />Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Account picker modal ──────────────────────────────────────────── */}
      {showAccountPicker && (
        <div className="modal-overlay" onClick={() => setShowAccountPicker(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Select Contributing Accounts</h2>
              <button className="close-btn" onClick={() => setShowAccountPicker(false)}><FontAwesomeIcon icon={faXmark} /></button>
            </div>
            <div className="modal-body">
              {accounts.length === 0 ? (
                <p style={{ color: 'var(--text-muted)' }}>No accounts in this dossier.</p>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: 40 }}></th>
                      <th>Group</th>
                      <th>Account</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map((a) => (
                      <tr key={a.id} style={{ cursor: 'pointer' }} onClick={() => togglePicker(a.id)}>
                        <td>
                          <Checkbox
                            checked={pickerSelection.includes(a.id)}
                            onChange={(e) => { e.stopPropagation(); togglePicker(a.id); }}
                          />
                        </td>
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

      {/* ── Extra value form modal ────────────────────────────────────────── */}
      {showExtraForm && (
        <div className="modal-overlay" onClick={() => setShowExtraForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingExtra ? 'Edit Extra Value' : 'Add Extra Monthly Value'}</h2>
              <button className="close-btn" onClick={() => setShowExtraForm(false)}><FontAwesomeIcon icon={faXmark} /></button>
            </div>
            <form onSubmit={saveExtraForm}>
              <div className="modal-body">
                <div className="form-group">
                  <label>Name</label>
                  <input type="text" value={extraFormName} onChange={(e) => setExtraFormName(e.target.value)} placeholder="e.g. Rent, School fees" required />
                </div>
                <div className="form-group">
                  <label>Monthly value (€)</label>
                  <input type="number" value={extraFormValue} onChange={(e) => setExtraFormValue(e.target.value)} placeholder="0.00" step="0.01" min="0" required />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowExtraForm(false)}>Cancel</button>
                <button type="submit" className="btn-primary">{editingExtra ? 'Save' : 'Add'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {confirmState && <ConfirmModal {...confirmState} onCancel={() => setConfirmState(null)} />}
      <Toast message={toast.msg} visible={toast.show} />
    </div>
  );
}
