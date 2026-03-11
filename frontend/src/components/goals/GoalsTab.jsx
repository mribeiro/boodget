import { useState, useEffect } from 'react';
import { api } from '../../services/api';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function formatTargetDate(year, month) {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

function formatCurrency(value) {
  return value == null ? '—' : value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const CURRENT_YEAR = new Date().getFullYear();

const DEFAULT_FORM = {
  name: '',
  target_year: CURRENT_YEAR + 2,
  target_month: 1,
  target_value: '',
  extra_initial_amount: '',
  monthly_mode: 'distributions',
  monthly_amount: '',
  account_ids: [],
  distribution_template_item_ids: [],
};

export default function GoalsTab({ dossierId }) {
  const [goals, setGoals] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [distributions, setDistributions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalPreset, setModalPreset] = useState(null); // null=closed | {}=new | {...goal}=edit
  const [form, setForm] = useState(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null); // goalId

  useEffect(() => {
    load();
  }, [dossierId]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [g, accts, tpl] = await Promise.all([
        api.getGoals(dossierId),
        api.getAccounts(dossierId, true), // includeArchived
        api.getExpenseTemplate(dossierId),
      ]);
      setGoals(g);
      setAccounts(accts);
      setDistributions(tpl.filter((i) => i.section === 'distribution'));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function openNew() {
    setForm(DEFAULT_FORM);
    setFormError('');
    setModalPreset({});
  }

  function openEdit(goal) {
    setForm({
      name: goal.name,
      target_year: goal.target_year,
      target_month: goal.target_month,
      target_value: String(goal.target_value),
      extra_initial_amount: goal.extra_initial_amount ? String(goal.extra_initial_amount) : '',
      monthly_mode: goal.monthly_amount !== null && goal.monthly_amount !== undefined ? 'manual' : 'distributions',
      monthly_amount: goal.monthly_amount !== null && goal.monthly_amount !== undefined ? String(goal.monthly_amount) : '',
      account_ids: goal.account_ids || [],
      distribution_template_item_ids: goal.distribution_template_item_ids || [],
    });
    setFormError('');
    setModalPreset(goal);
  }

  function closeModal() {
    setModalPreset(null);
    setFormError('');
  }

  function toggleId(arr, id) {
    return arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id];
  }

  async function handleSave() {
    setFormError('');
    if (!form.name.trim()) return setFormError('Name is required.');
    const targetYear = Number(form.target_year);
    const targetMonth = Number(form.target_month);
    const targetValue = Number(form.target_value);
    if (!Number.isInteger(targetYear) || targetYear < 2000) return setFormError('Invalid target year.');
    if (targetMonth < 1 || targetMonth > 12) return setFormError('Invalid target month.');
    if (isNaN(targetValue) || targetValue < 0) return setFormError('Target value must be a non-negative number.');
    if (form.monthly_mode === 'manual') {
      const ma = Number(form.monthly_amount);
      if (isNaN(ma) || ma < 0) return setFormError('Monthly amount must be a non-negative number.');
    }

    const payload = {
      name: form.name.trim(),
      target_year: targetYear,
      target_month: targetMonth,
      target_value: targetValue,
      extra_initial_amount: Number(form.extra_initial_amount) || 0,
      monthly_amount: form.monthly_mode === 'manual' ? Number(form.monthly_amount) : null,
      account_ids: form.account_ids,
      distribution_template_item_ids: form.monthly_mode === 'distributions' ? form.distribution_template_item_ids : [],
    };

    setSaving(true);
    try {
      if (modalPreset && modalPreset.id) {
        await api.updateGoal(dossierId, modalPreset.id, payload);
      } else {
        await api.createGoal(dossierId, payload);
      }
      await load();
      closeModal();
    } catch (e) {
      setFormError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(goalId) {
    try {
      await api.deleteGoal(dossierId, goalId);
      setConfirmDelete(null);
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  if (loading) return <div style={{ padding: '2rem', color: 'var(--color-text-muted)' }}>Loading goals…</div>;
  if (error) return <div className="alert alert-error" style={{ margin: '1rem' }}>{error}</div>;

  const isEditing = modalPreset && modalPreset.id;

  return (
    <div style={{ padding: '1.5rem 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h2 style={{ margin: 0 }}>Goals</h2>
        <button className="btn-primary" onClick={openNew}>+ Add Goal</button>
      </div>

      {goals.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--color-text-muted)' }}>
          <p>No goals yet. Create one to track your savings targets.</p>
          <button className="btn-primary" onClick={openNew}>Add first goal</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {goals.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              onEdit={() => openEdit(goal)}
              onDelete={() => setConfirmDelete(goal.id)}
            />
          ))}
        </div>
      )}

      {/* Add/Edit Modal */}
      {modalPreset !== null && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" style={{ maxWidth: '540px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{isEditing ? 'Edit Goal' : 'New Goal'}</h2>
              <button className="close-btn" onClick={closeModal}>&times;</button>
            </div>
            <div className="modal-body">
              {formError && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{formError}</div>}

              <div className="form-group">
                <label>Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Emergency Fund"
                />
              </div>

              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Target year</label>
                  <input
                    type="number"
                    value={form.target_year}
                    onChange={(e) => setForm((f) => ({ ...f, target_year: Number(e.target.value) }))}
                    min={CURRENT_YEAR}
                    max={2100}
                  />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Target month</label>
                  <select
                    value={form.target_month}
                    onChange={(e) => setForm((f) => ({ ...f, target_month: Number(e.target.value) }))}
                  >
                    {MONTH_NAMES.map((name, i) => (
                      <option key={i + 1} value={i + 1}>{name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Target value</label>
                  <input
                    type="number"
                    value={form.target_value}
                    onChange={(e) => setForm((f) => ({ ...f, target_value: e.target.value }))}
                    min={0}
                    placeholder="0.00"
                  />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Extra initial amount</label>
                  <input
                    type="number"
                    value={form.extra_initial_amount}
                    onChange={(e) => setForm((f) => ({ ...f, extra_initial_amount: e.target.value }))}
                    min={0}
                    placeholder="0.00"
                  />
                </div>
              </div>

              {/* Accounts */}
              <div className="form-group">
                <label>Contributing accounts</label>
                {accounts.length === 0 ? (
                  <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>No accounts in this dossier.</div>
                ) : (
                  <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: '0.5rem', maxHeight: '140px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                    {accounts.map((acc) => (
                      <label key={acc.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 'normal' }}>
                        <input
                          type="checkbox"
                          checked={form.account_ids.includes(acc.id)}
                          onChange={() => setForm((f) => ({ ...f, account_ids: toggleId(f.account_ids, acc.id) }))}
                        />
                        <span>{acc.group_name} / {acc.name}</span>
                        {acc.archived ? <span style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>(archived)</span> : null}
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* Monthly contribution mode */}
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Monthly contribution</label>
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <button
                    type="button"
                    style={{
                      padding: '0.3rem 0.75rem',
                      borderRadius: 'var(--radius)',
                      border: '1px solid var(--color-border)',
                      background: form.monthly_mode === 'distributions' ? 'var(--color-primary)' : 'var(--color-surface)',
                      color: form.monthly_mode === 'distributions' ? '#fff' : 'var(--color-text)',
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                    }}
                    onClick={() => setForm((f) => ({ ...f, monthly_mode: 'distributions' }))}
                  >
                    From distributions
                  </button>
                  <button
                    type="button"
                    style={{
                      padding: '0.3rem 0.75rem',
                      borderRadius: 'var(--radius)',
                      border: '1px solid var(--color-border)',
                      background: form.monthly_mode === 'manual' ? 'var(--color-primary)' : 'var(--color-surface)',
                      color: form.monthly_mode === 'manual' ? '#fff' : 'var(--color-text)',
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                    }}
                    onClick={() => setForm((f) => ({ ...f, monthly_mode: 'manual' }))}
                  >
                    Manual amount
                  </button>
                </div>

                {form.monthly_mode === 'distributions' ? (
                  distributions.length === 0 ? (
                    <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>No distribution template items defined.</div>
                  ) : (
                    <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: '0.5rem', maxHeight: '120px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                      {distributions.map((dist) => (
                        <label key={dist.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 'normal' }}>
                          <input
                            type="checkbox"
                            checked={form.distribution_template_item_ids.includes(dist.id)}
                            onChange={() => setForm((f) => ({ ...f, distribution_template_item_ids: toggleId(f.distribution_template_item_ids, dist.id) }))}
                          />
                          <span style={{ flex: 1 }}>{dist.name}</span>
                          <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>{formatCurrency(dist.value)}</span>
                        </label>
                      ))}
                    </div>
                  )
                ) : (
                  <input
                    type="number"
                    value={form.monthly_amount}
                    onChange={(e) => setForm((f) => ({ ...f, monthly_amount: e.target.value }))}
                    min={0}
                    placeholder="0.00"
                  />
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={closeModal} disabled={saving}>Cancel</button>
              <button className="btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : isEditing ? 'Save changes' : 'Create goal'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Delete goal?</h2>
              <button className="close-btn" onClick={() => setConfirmDelete(null)}>&times;</button>
            </div>
            <div className="modal-body">
              <p style={{ margin: 0 }}>This action cannot be undone.</p>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn-danger" onClick={() => handleDelete(confirmDelete)}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function GoalCard({ goal, onEdit, onDelete }) {
  const progressPct = Math.min(100, Math.max(0, goal.progress_pct || 0));
  const isComplete = progressPct >= 100;

  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: '1rem 1.25rem', background: 'var(--color-surface)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: '1rem' }}>{goal.name}</div>
          <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
            Target: {formatTargetDate(goal.target_year, goal.target_month)}
            {goal.months_remaining > 0
              ? ` · ${goal.months_remaining} month${goal.months_remaining !== 1 ? 's' : ''} remaining`
              : ' · Target date reached'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0, marginLeft: '1rem' }}>
          <button className="btn-secondary" style={{ fontSize: '0.8rem', padding: '0.25rem 0.6rem' }} onClick={onEdit}>Edit</button>
          <button className="btn-danger" style={{ fontSize: '0.8rem', padding: '0.25rem 0.6rem' }} onClick={onDelete}>Delete</button>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ background: 'var(--color-border)', borderRadius: '4px', height: '8px', overflow: 'hidden', margin: '0.6rem 0' }}>
        <div style={{
          width: `${progressPct}%`,
          background: isComplete ? 'var(--color-success, #22c55e)' : 'var(--color-primary)',
          height: '100%',
          transition: 'width 0.3s ease',
        }} />
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem', marginTop: '0.5rem' }}>
        <StatBox label="Current" value={formatCurrency(goal.current_value)} />
        <StatBox label="Target" value={formatCurrency(goal.target_value)} />
        <StatBox label="Monthly contrib." value={formatCurrency(goal.monthly_contribution)} />
        <StatBox
          label="Monthly required"
          value={goal.monthly_required !== null ? formatCurrency(goal.monthly_required) : '—'}
          highlight={goal.monthly_required !== null && goal.monthly_contribution < goal.monthly_required}
        />
      </div>
    </div>
  );
}

function StatBox({ label, value, highlight }) {
  return (
    <div style={{ background: 'var(--color-background, var(--color-bg))', borderRadius: 'var(--radius)', padding: '0.4rem 0.5rem' }}>
      <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginBottom: '0.1rem' }}>{label}</div>
      <div style={{ fontSize: '0.9rem', fontWeight: 600, color: highlight ? 'var(--color-danger, #ef4444)' : 'inherit' }}>{value}</div>
    </div>
  );
}
