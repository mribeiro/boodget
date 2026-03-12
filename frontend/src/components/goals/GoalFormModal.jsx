import { useState, useEffect } from 'react';
import { api } from '../../services/api';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function targetDateOptions() {
  const now = new Date();
  const options = [];
  for (let i = 1; i <= 60; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
    options.push({ value: ym, label });
  }
  return options;
}

export default function GoalFormModal({ dossierId, goal, onSave, onClose }) {
  const isEdit = !!goal;
  const now = new Date();
  const defaultTargetDate = `${now.getFullYear() + 1}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const [name, setName] = useState(goal?.name ?? '');
  const [targetValue, setTargetValue] = useState(goal?.target_value ?? '');
  const [targetDate, setTargetDate] = useState(goal?.target_date ?? defaultTargetDate);
  const [contributionMode, setContributionMode] = useState(goal?.contribution_mode ?? 'via_distributions');
  const [manualMonthlyValue, setManualMonthlyValue] = useState(goal?.manual_monthly_value ?? '');
  const [extraValue, setExtraValue] = useState(goal?.extra_value != null ? String(goal.extra_value) : '');
  const [extraValueImpactMode, setExtraValueImpactMode] = useState(
    goal?.extra_value_impact_mode ?? 'reduce_monthly_amount'
  );
  const [selectedAccountIds, setSelectedAccountIds] = useState(goal?.account_ids ?? []);
  const [selectedDistIds, setSelectedDistIds] = useState(goal?.distribution_template_ids ?? []);

  const [accounts, setAccounts] = useState([]);
  const [distributions, setDistributions] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      api.getAccounts(dossierId),
      api.getExpenseTemplate(dossierId),
    ]).then(([accts, template]) => {
      setAccounts(accts);
      setDistributions(template.filter((t) => t.section === 'distribution'));
    }).catch(() => setError('Failed to load data'));
  }, [dossierId]);

  function toggleAccount(id) {
    setSelectedAccountIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function toggleDist(id) {
    setSelectedDistIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!name.trim()) { setError('Name is required'); return; }
    if (!targetValue || isNaN(Number(targetValue)) || Number(targetValue) <= 0) {
      setError('Target value must be a positive number');
      return;
    }
    const hasExtra = extraValue !== '' && extraValue != null && Number(extraValue) > 0;
    const payload = {
      name: name.trim(),
      target_value: Number(targetValue),
      target_date: targetDate,
      contribution_mode: contributionMode,
      manual_monthly_value: contributionMode === 'manual' ? Number(manualMonthlyValue) : undefined,
      extra_value: hasExtra ? Number(extraValue) : null,
      extra_value_impact_mode: hasExtra ? extraValueImpactMode : null,
      account_ids: selectedAccountIds,
      distribution_template_ids: contributionMode === 'via_distributions' ? selectedDistIds : [],
    };

    setSaving(true);
    try {
      let result;
      if (isEdit) {
        result = await api.updateGoal(dossierId, goal.id, payload);
      } else {
        result = await api.createGoal(dossierId, payload);
      }
      onSave(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const targetDateOpts = targetDateOptions();
  const hasExtra = extraValue !== '' && extraValue != null && Number(extraValue) > 0;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: '560px', width: '100%' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{isEdit ? 'Edit Goal' : 'New Goal'}</h2>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {error && <div className="alert alert-error">{error}</div>}

            <div className="form-group">
              <label>Name</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Emergency fund" />
            </div>

            <div style={{ display: 'flex', gap: '1rem' }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Target value (€)</label>
                <input type="number" value={targetValue} onChange={(e) => setTargetValue(e.target.value)} min="0" step="0.01" placeholder="0.00" />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Target date</label>
                <select value={targetDate} onChange={(e) => setTargetDate(e.target.value)}>
                  {targetDateOpts.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-group">
              <label>Monthly contribution mode</label>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {[
                  { value: 'via_distributions', label: 'Via distributions' },
                  { value: 'manual', label: 'Manual' },
                  { value: 'ad_hoc', label: 'Ad-hoc' },
                ].map((opt) => (
                  <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer', fontWeight: 'normal' }}>
                    <input
                      type="radio"
                      name="contribution_mode"
                      value={opt.value}
                      checked={contributionMode === opt.value}
                      onChange={() => setContributionMode(opt.value)}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>

            {contributionMode === 'manual' && (
              <div className="form-group">
                <label>Monthly contribution amount (€)</label>
                <input
                  type="number"
                  value={manualMonthlyValue}
                  onChange={(e) => setManualMonthlyValue(e.target.value)}
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                />
              </div>
            )}

            {contributionMode === 'via_distributions' && (
              <div className="form-group">
                <label>Contributing distributions</label>
                {distributions.length === 0 ? (
                  <div style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
                    No distribution items in the monthly template yet.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    {distributions.map((d) => (
                      <label key={d.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontWeight: 'normal' }}>
                        <input
                          type="checkbox"
                          checked={selectedDistIds.includes(d.id)}
                          onChange={() => toggleDist(d.id)}
                        />
                        {d.name}
                        <span style={{ marginLeft: 'auto', color: 'var(--color-text-muted)' }}>
                          {d.value.toLocaleString('en-US', { minimumFractionDigits: 2 })} €
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="form-group">
              <label>Contributing accounts (optional)</label>
              {accounts.length === 0 ? (
                <div style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>No accounts in this dossier.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  {accounts.map((a) => (
                    <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontWeight: 'normal' }}>
                      <input
                        type="checkbox"
                        checked={selectedAccountIds.includes(a.id)}
                        onChange={() => toggleAccount(a.id)}
                      />
                      {a.group_name} — {a.name}
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '1rem' }}>
              <div className="form-group">
                <label>Extra value already in hand (€, optional)</label>
                <input
                  type="number"
                  value={extraValue}
                  onChange={(e) => setExtraValue(e.target.value)}
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                />
              </div>

              {hasExtra && (
                <div className="form-group">
                  <label>How should the extra value affect the projection?</label>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {[
                      { value: 'reduce_monthly_amount', label: 'Reduce monthly amount' },
                      { value: 'anticipate_end_date', label: 'Anticipate end date' },
                    ].map((opt) => (
                      <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer', fontWeight: 'normal' }}>
                        <input
                          type="radio"
                          name="extra_value_impact_mode"
                          value={opt.value}
                          checked={extraValueImpactMode === opt.value}
                          onChange={() => setExtraValueImpactMode(opt.value)}
                        />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create goal'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
