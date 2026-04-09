import { useState, useEffect, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFolderOpen, faCopy, faTrash, faChevronRight, faChevronDown } from '@fortawesome/free-solid-svg-icons';
import { api } from '../../services/api';
import ConfirmModal from '../ConfirmModal';

// ── Utilities ────────────────────────────────────────────────────────────────

let _idCounter = 0;
function newId() {
  return `wb-${++_idCounter}-${Math.random().toString(36).slice(2, 7)}`;
}

function fmt(v) {
  if (v == null || isNaN(v)) return '—';
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v) + ' €';
}

function fmtPct(v, total) {
  if (!total || isNaN(v)) return '—';
  return (((v / total) * 100).toFixed(1)) + '%';
}

const sum = (arr, fn) => arr.reduce((s, x) => s + (fn(x) || 0), 0);

const CLASS_COLORS = {
  must: { background: '#fef3c7', color: '#92400e' },
  want: { background: '#dbeafe', color: '#1e40af' },
};

function ClassBadge({ classification }) {
  if (!classification) return (
    <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: 'var(--radius)', background: '#fff8e1', color: '#b45309', border: '1px solid #fde68a' }}>
      ! unset
    </span>
  );
  const c = CLASS_COLORS[classification];
  return (
    <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: 'var(--radius)', background: c.background, color: c.color }}>
      {classification === 'must' ? 'Must' : 'Want'}
    </span>
  );
}

function ClassificationPills({ value, onChange }) {
  const options = [
    { value: 'must', label: 'Must', bg: '#fef3c7', color: '#92400e', border: '#f59e0b' },
    { value: 'want', label: 'Want', bg: '#dbeafe', color: '#1e40af', border: '#3b82f6' },
  ];
  return (
    <div style={{ display: 'flex', gap: '0.25rem' }}>
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(active ? null : opt.value)}
            style={{
              fontSize: '0.7rem',
              padding: '0.15rem 0.5rem',
              borderRadius: '999px',
              border: active ? `1px solid ${opt.border}` : '1px solid var(--color-border)',
              background: active ? opt.bg : 'transparent',
              color: active ? opt.color : 'var(--color-text-muted)',
              cursor: 'pointer',
              fontWeight: active ? 600 : 400,
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function TemplateTag() {
  return (
    <span style={{ fontSize: '0.65rem', padding: '0.1rem 0.35rem', borderRadius: 'var(--radius)', background: 'var(--color-surface)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)', marginLeft: '0.35rem' }}>
      template
    </span>
  );
}

// Build working state from loaded template data
function buildWorkingStateFromTemplates(monthlyTemplate, annualTemplate, distributions) {
  const monthlyExpenses = monthlyTemplate
    .filter((i) => i.section === 'expense')
    .map((i) => ({
      _id: newId(),
      name: i.name,
      value: i.value,
      type: i.type,
      classification: i.classification || null,
      _dayOfPayment: i.day_of_payment,
      isFromTemplate: true,
      templateItemId: i.id,
    }));

  const distItems = distributions.map((i) => ({
    _id: newId(),
    name: i.name,
    value: i.value,
    must_amount: i.must_amount ?? null,
    want_amount: i.want_amount ?? null,
    save_amount: i.save_amount ?? null,
    isFromTemplate: true,
    templateItemId: i.id,
  }));

  const annualItems = annualTemplate.map((i) => ({
    _id: newId(),
    name: i.name,
    value: i.value,
    classification: i.classification || null,
    isFromTemplate: true,
    templateItemId: i.id,
  }));

  return {
    income: [],
    monthlyExpenses,
    annualExpenses: annualItems,
    annualDeductible: 0,
    distributions: distItems,
  };
}

function stateFromSnapshot(data) {
  // Ensure every entry has a fresh _id
  return {
    income: (data.income || []).map((e) => ({ ...e, _id: newId() })),
    monthlyExpenses: (data.monthlyExpenses || []).map((e) => ({ ...e, _id: newId() })),
    annualExpenses: (data.annualExpenses || []).map((e) => ({ ...e, _id: newId() })),
    annualDeductible: data.annualDeductible || 0,
    distributions: (data.distributions || []).map((e) => ({ ...e, _id: newId() })),
  };
}

function stateToSnapshotData(state) {
  const strip = (e) => {
    const { _id, ...rest } = e;
    return rest;
  };
  return {
    income: state.income.map(strip),
    monthlyExpenses: state.monthlyExpenses.map(strip),
    annualExpenses: state.annualExpenses.map(strip),
    annualDeductible: state.annualDeductible || 0,
    distributions: state.distributions.map(strip),
  };
}

// ── Global Summary Computation ───────────────────────────────────────────────

function computeGlobalSummary(state) {
  const totalIncome = sum(state.income, (e) => e.value);

  const monthlyMust = sum(state.monthlyExpenses.filter((e) => e.classification === 'must'), (e) => e.value);
  const monthlyWant = sum(state.monthlyExpenses.filter((e) => e.classification === 'want'), (e) => e.value);

  const annualMustAvg = sum(state.annualExpenses.filter((e) => e.classification === 'must'), (e) => e.value / 12);
  const annualWantAvg = sum(state.annualExpenses.filter((e) => e.classification === 'want'), (e) => e.value / 12);

  const distMust = sum(state.distributions, (e) => e.must_amount || 0);
  const distWant = sum(state.distributions, (e) => e.want_amount || 0);
  const distSave = sum(state.distributions, (e) => e.save_amount || 0);

  const totalMust = monthlyMust + annualMustAvg + distMust;
  const totalWant = monthlyWant + annualWantAvg + distWant;
  const totalSave = distSave;
  const leftover = totalIncome - totalMust - totalWant - totalSave;

  return { totalIncome, totalMust, totalWant, totalSave, leftover };
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function WorkbenchTab({ dossierId }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Working state (ephemeral)
  const [state, setState] = useState(null);
  const [isDirty, setIsDirty] = useState(false);

  // Snapshot management
  const [snapshots, setSnapshots] = useState([]);
  const [loadedSnapshot, setLoadedSnapshot] = useState(null); // { id, name }

  // Template caches (for sync)
  const [monthlyTemplate, setMonthlyTemplate] = useState([]);
  const [annualTemplate, setAnnualTemplate] = useState([]);

  // UI state
  const [savingSnapshot, setSavingSnapshot] = useState(false);
  const [saveNameInput, setSaveNameInput] = useState('');
  const [showSavePrompt, setShowSavePrompt] = useState(false);
  const [confirmState, setConfirmState] = useState(null);

  useEffect(() => {
    loadAll();
  }, [dossierId]);

  async function loadAll() {
    setLoading(true);
    setError('');
    try {
      const [expTemplate, annTemplate, snaps] = await Promise.all([
        api.getExpenseTemplate(dossierId),
        api.getAnnualExpenseTemplate(dossierId),
        api.getWorkbenchSnapshots(dossierId),
      ]);
      setMonthlyTemplate(expTemplate);
      setAnnualTemplate(annTemplate);
      setSnapshots(snaps);

      const monthly = expTemplate.filter((i) => i.section === 'expense');
      const dists = expTemplate.filter((i) => i.section === 'distribution');

      if (snaps.length === 1) {
        setLoadedSnapshot({ id: snaps[0].id, name: snaps[0].name });
        setState(stateFromSnapshot(snaps[0].data));
      } else {
        setState(buildWorkingStateFromTemplates(monthly, annTemplate, dists));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function markDirty() {
    setIsDirty(true);
  }

  // ── State updaters ──

  function updateEntry(section, _id, changes) {
    setState((prev) => ({
      ...prev,
      [section]: prev[section].map((e) => (e._id === _id ? { ...e, ...changes } : e)),
    }));
    markDirty();
  }

  function addEntry(section, entry) {
    setState((prev) => ({ ...prev, [section]: [...prev[section], { ...entry, _id: newId() }] }));
    markDirty();
  }

  function removeEntry(section, _id) {
    setState((prev) => ({ ...prev, [section]: prev[section].filter((e) => e._id !== _id) }));
    markDirty();
  }

  function updateScalar(field, value) {
    setState((prev) => ({ ...prev, [field]: value }));
    markDirty();
  }

  // ── Snapshot operations ──

  function handleLoadSnapshot(snapshot) {
    function doLoad() {
      setLoadedSnapshot({ id: snapshot.id, name: snapshot.name });
      setState(stateFromSnapshot(snapshot.data));
      setIsDirty(false);
    }
    if (isDirty) {
      setConfirmState({
        title: 'Discard changes?',
        message: 'You have unsaved changes in the working state. Load snapshot anyway and discard changes?',
        confirmLabel: 'Load snapshot',
        danger: false,
        onConfirm: doLoad,
      });
      return;
    }
    doLoad();
  }

  function handleNewFromScratch() {
    function doNew() {
      const monthly = monthlyTemplate.filter((i) => i.section === 'expense');
      const dists = monthlyTemplate.filter((i) => i.section === 'distribution');
      setState(buildWorkingStateFromTemplates(monthly, annualTemplate, dists));
      setLoadedSnapshot(null);
      setIsDirty(false);
      setShowSavePrompt(false);
    }
    if (isDirty) {
      setConfirmState({
        title: 'Discard changes?',
        message: 'You have unsaved changes. Discard them and start a new working state?',
        confirmLabel: 'Start fresh',
        danger: false,
        onConfirm: doNew,
      });
      return;
    }
    doNew();
  }

  async function handleSave() {
    if (!loadedSnapshot) {
      // No snapshot loaded — prompt for name
      setSaveNameInput('');
      setShowSavePrompt(true);
      return;
    }
    // Overwrite existing snapshot
    setSavingSnapshot(true);
    try {
      const updated = await api.saveWorkbenchSnapshot(dossierId, loadedSnapshot.id, {
        data: stateToSnapshotData(state),
      });
      setSnapshots((prev) => prev.map((s) => (s.id === updated.id ? { ...updated, data: updated.data } : s)));
      setIsDirty(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingSnapshot(false);
    }
  }

  async function handleCreateSnapshot(name) {
    setSavingSnapshot(true);
    try {
      const created = await api.createWorkbenchSnapshot(dossierId, {
        name,
        data: stateToSnapshotData(state),
      });
      setSnapshots((prev) => [{ ...created, data: created.data }, ...prev]);
      setLoadedSnapshot({ id: created.id, name: created.name });
      setIsDirty(false);
      setShowSavePrompt(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingSnapshot(false);
    }
  }

  async function handleDuplicate(snapshot) {
    try {
      const duped = await api.duplicateWorkbenchSnapshot(dossierId, snapshot.id);
      setSnapshots((prev) => [{ ...duped, data: duped.data }, ...prev]);
    } catch (err) {
      setError(err.message);
    }
  }

  function handleDeleteSnapshot(snapshot) {
    setConfirmState({
      title: 'Delete snapshot',
      message: `Delete snapshot "${snapshot.name}"?`,
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: async () => {
        try {
          await api.deleteWorkbenchSnapshot(dossierId, snapshot.id);
          setSnapshots((prev) => prev.filter((s) => s.id !== snapshot.id));
          if (loadedSnapshot?.id === snapshot.id) {
            setLoadedSnapshot(null);
          }
        } catch (err) {
          setError(err.message);
        }
      },
    });
  }

  // ── Sync operations ──

  async function handleSyncFromTemplate(section) {
    try {
      let templateItems;
      if (section === 'monthly') {
        const fresh = await api.getExpenseTemplate(dossierId);
        setMonthlyTemplate(fresh);
        templateItems = fresh.filter((i) => i.section === 'expense');
        setState((prev) => {
          const adHoc = prev.monthlyExpenses.filter((e) => !e.isFromTemplate);
          const updated = templateItems.map((ti) => {
            const existing = prev.monthlyExpenses.find((e) => e.templateItemId === ti.id);
            return {
              _id: existing?._id || newId(),
              name: ti.name,
              value: ti.value,
              type: ti.type,
              classification: ti.classification || null,
              _dayOfPayment: ti.day_of_payment,
              isFromTemplate: true,
              templateItemId: ti.id,
            };
          });
          return { ...prev, monthlyExpenses: [...updated, ...adHoc] };
        });
      } else if (section === 'annual') {
        const fresh = await api.getAnnualExpenseTemplate(dossierId);
        setAnnualTemplate(fresh);
        setState((prev) => {
          const adHoc = prev.annualExpenses.filter((e) => !e.isFromTemplate);
          const updated = fresh.map((ti) => {
            const existing = prev.annualExpenses.find((e) => e.templateItemId === ti.id);
            return {
              _id: existing?._id || newId(),
              name: ti.name,
              value: ti.value,
              classification: ti.classification || null,
              isFromTemplate: true,
              templateItemId: ti.id,
            };
          });
          return { ...prev, annualExpenses: [...updated, ...adHoc] };
        });
      } else if (section === 'distributions') {
        const fresh = await api.getExpenseTemplate(dossierId);
        const dists = fresh.filter((i) => i.section === 'distribution');
        setState((prev) => {
          const adHoc = prev.distributions.filter((e) => !e.isFromTemplate);
          const updated = dists.map((ti) => {
            const existing = prev.distributions.find((e) => e.templateItemId === ti.id);
            return {
              _id: existing?._id || newId(),
              name: ti.name,
              value: ti.value,
              must_amount: ti.must_amount ?? null,
              want_amount: ti.want_amount ?? null,
              save_amount: ti.save_amount ?? null,
              isFromTemplate: true,
              templateItemId: ti.id,
            };
          });
          return { ...prev, distributions: [...updated, ...adHoc] };
        });
      }
      markDirty();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSyncToTemplate(section, adHocDayOverrides) {
    try {
      if (section === 'monthly') {
        const items = state.monthlyExpenses.map((e) => {
          const dop = e.isFromTemplate
            ? (e._dayOfPayment ?? null)
            : (adHocDayOverrides?.[e._id] ?? null);
          return {
            name: e.name,
            type: e.type,
            value: e.value,
            day_of_payment: e.type === 'Fixed' ? dop : null,
            classification: e.classification || null,
          };
        });
        await api.bulkReplaceExpenseTemplateSection(dossierId, 'expense', items);
        // Refresh template cache and mark entries as from template
        const fresh = await api.getExpenseTemplate(dossierId);
        setMonthlyTemplate(fresh);
        const newExpItems = fresh.filter((i) => i.section === 'expense');
        setState((prev) => {
          const rebuilt = prev.monthlyExpenses.map((e, idx) => ({
            ...e,
            isFromTemplate: true,
            templateItemId: newExpItems[idx]?.id ?? null,
          }));
          return { ...prev, monthlyExpenses: rebuilt };
        });
      } else if (section === 'annual') {
        const items = state.annualExpenses.map((e) => ({
          name: e.name,
          value: e.value,
          classification: e.classification || null,
          day_of_payment: adHocDayOverrides?.[e._id]?.day ?? null,
          month_of_payment: adHocDayOverrides?.[e._id]?.month ?? null,
        }));
        await api.bulkReplaceAnnualExpenseTemplate(dossierId, items);
        const fresh = await api.getAnnualExpenseTemplate(dossierId);
        setAnnualTemplate(fresh);
        setState((prev) => {
          const rebuilt = prev.annualExpenses.map((e, idx) => ({
            ...e,
            isFromTemplate: true,
            templateItemId: fresh[idx]?.id ?? null,
          }));
          return { ...prev, annualExpenses: rebuilt };
        });
      } else if (section === 'distributions') {
        const items = state.distributions.map((e) => ({
          name: e.name,
          value: e.value,
          must_amount: e.must_amount ?? null,
          want_amount: e.want_amount ?? null,
          save_amount: e.save_amount ?? null,
        }));
        await api.bulkReplaceExpenseTemplateSection(dossierId, 'distribution', items);
        const fresh = await api.getExpenseTemplate(dossierId);
        const newDists = fresh.filter((i) => i.section === 'distribution');
        setState((prev) => {
          const rebuilt = prev.distributions.map((e, idx) => ({
            ...e,
            isFromTemplate: true,
            templateItemId: newDists[idx]?.id ?? null,
          }));
          return { ...prev, distributions: rebuilt };
        });
      }
      markDirty();
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }

  // ── Render ──

  if (loading) return <div className="loading">Loading Workbench…</div>;

  const summary = state ? computeGlobalSummary(state) : null;

  return (
    <div>
      {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      {/* Snapshot panel */}
      <SnapshotPanel
        snapshots={snapshots}
        loadedSnapshot={loadedSnapshot}
        isDirty={isDirty}
        savingSnapshot={savingSnapshot}
        showSavePrompt={showSavePrompt}
        saveNameInput={saveNameInput}
        setSaveNameInput={setSaveNameInput}
        setShowSavePrompt={setShowSavePrompt}
        onLoad={handleLoadSnapshot}
        onSave={handleSave}
        onCreate={handleCreateSnapshot}
        onDuplicate={handleDuplicate}
        onDelete={handleDeleteSnapshot}
        onNewFromScratch={handleNewFromScratch}
      />

      {state && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', marginTop: '1.5rem' }}>
          <IncomeSection
            entries={state.income}
            onAdd={(e) => addEntry('income', e)}
            onUpdate={(_id, ch) => updateEntry('income', _id, ch)}
            onRemove={(_id) => removeEntry('income', _id)}
          />

          <MonthlyExpensesSection
            entries={state.monthlyExpenses}
            onAdd={(e) => addEntry('monthlyExpenses', e)}
            onUpdate={(_id, ch) => updateEntry('monthlyExpenses', _id, ch)}
            onRemove={(_id) => removeEntry('monthlyExpenses', _id)}
            onSyncFrom={() => handleSyncFromTemplate('monthly')}
            onSyncTo={handleSyncToTemplate}
          />

          <AnnualExpensesSection
            entries={state.annualExpenses}
            annualDeductible={state.annualDeductible || 0}
            onChangeDeductible={(v) => updateScalar('annualDeductible', v)}
            onAdd={(e) => addEntry('annualExpenses', e)}
            onUpdate={(_id, ch) => updateEntry('annualExpenses', _id, ch)}
            onRemove={(_id) => removeEntry('annualExpenses', _id)}
            onSyncFrom={() => handleSyncFromTemplate('annual')}
            onSyncTo={handleSyncToTemplate}
          />

          <DistributionsSection
            entries={state.distributions}
            onAdd={(e) => addEntry('distributions', e)}
            onUpdate={(_id, ch) => updateEntry('distributions', _id, ch)}
            onRemove={(_id) => removeEntry('distributions', _id)}
            onSyncFrom={() => handleSyncFromTemplate('distributions')}
            onSyncTo={handleSyncToTemplate}
          />

          <GlobalSummarySection summary={summary} />
        </div>
      )}
      {confirmState && <ConfirmModal {...confirmState} onCancel={() => setConfirmState(null)} />}
    </div>
  );
}

// ── Snapshot Panel ───────────────────────────────────────────────────────────

function SnapshotPanel({
  snapshots, loadedSnapshot, isDirty, savingSnapshot,
  showSavePrompt, saveNameInput, setSaveNameInput, setShowSavePrompt,
  onLoad, onSave, onCreate, onDuplicate, onDelete, onNewFromScratch,
}) {
  return (
    <div className="card" style={{ padding: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: snapshots.length > 0 || showSavePrompt ? '0.75rem' : 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <h3 style={{ margin: 0, fontSize: '0.95rem' }}>Workbench</h3>
          {loadedSnapshot ? (
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              {loadedSnapshot.name}{isDirty ? ' *' : ''}
            </span>
          ) : (
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              [working state{isDirty ? ' — unsaved' : ''}]
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {loadedSnapshot && (
            <button
              className="btn-secondary"
              onClick={onNewFromScratch}
              style={{ fontSize: '0.875rem' }}
            >
              New from scratch
            </button>
          )}
          <button
            className="btn-primary"
            onClick={onSave}
            disabled={savingSnapshot || !isDirty}
            style={{ fontSize: '0.875rem' }}
          >
            {savingSnapshot ? 'Saving…' : loadedSnapshot ? 'Save' : 'Save as snapshot…'}
          </button>
        </div>
      </div>

      {showSavePrompt && (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.75rem' }}>
          <input
            type="text"
            value={saveNameInput}
            onChange={(e) => setSaveNameInput(e.target.value)}
            placeholder="Snapshot name"
            style={{ flex: 1 }}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && saveNameInput.trim()) onCreate(saveNameInput.trim());
              if (e.key === 'Escape') setShowSavePrompt(false);
            }}
          />
          <button className="btn-primary" onClick={() => saveNameInput.trim() && onCreate(saveNameInput.trim())} disabled={!saveNameInput.trim()}>
            Create
          </button>
          <button className="btn-secondary" onClick={() => setShowSavePrompt(false)}>Cancel</button>
        </div>
      )}

      {snapshots.length > 0 && (
        <div>
          <div style={{ fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
            Saved snapshots
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            {snapshots.map((s) => (
              <div
                key={s.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.4rem 0.6rem',
                  borderRadius: 'var(--radius)',
                  background: loadedSnapshot?.id === s.id ? 'var(--color-brand-light)' : 'var(--bg-card)',
                  border: `1px solid ${loadedSnapshot?.id === s.id ? 'var(--color-brand)' : 'var(--border-default)'}`,
                }}
              >
                <span style={{ flex: 1, fontSize: '0.875rem', fontWeight: loadedSnapshot?.id === s.id ? 600 : 400 }}>
                  {s.name}
                </span>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  {new Date(s.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
                <button
                  className="btn-secondary"
                  onClick={() => onLoad(s)}
                  style={{ padding: '0.15rem 0.5rem', fontSize: '0.75rem' }}
                >
                  <FontAwesomeIcon icon={faFolderOpen} style={{ marginRight: '0.35rem' }} />Load
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => onDuplicate(s)}
                  style={{ padding: '0.15rem 0.5rem', fontSize: '0.75rem' }}
                >
                  <FontAwesomeIcon icon={faCopy} style={{ marginRight: '0.35rem' }} />Duplicate
                </button>
                <button
                  className="btn-danger"
                  onClick={() => onDelete(s)}
                  style={{ padding: '0.15rem 0.5rem', fontSize: '0.75rem' }}
                >
                  <FontAwesomeIcon icon={faTrash} style={{ marginRight: '0.35rem' }} />Delete
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Section Header ───────────────────────────────────────────────────────────

function SectionHeader({ title, collapsed, onToggle, collapsedSummary, children }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: collapsed ? 0 : '0.75rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', userSelect: 'none' }} onClick={onToggle}>
        <FontAwesomeIcon icon={collapsed ? faChevronRight : faChevronDown} style={{ fontSize: '0.6rem', color: 'var(--color-text-muted)' }} />
        <h3 style={{ margin: 0, fontSize: '0.95rem' }}>{title}</h3>
        {collapsed && collapsedSummary && (
          <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', fontWeight: 400 }}>{collapsedSummary}</span>
        )}
      </div>
      {!collapsed && <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>{children}</div>}
    </div>
  );
}

// ── Income Section ───────────────────────────────────────────────────────────

function IncomeSection({ entries, onAdd, onUpdate, onRemove }) {
  const [showAdd, setShowAdd] = useState(false);
  const [collapsed, setCollapsed] = useState(true);
  const totalIncome = sum(entries, (e) => e.value);

  return (
    <div className="card" style={{ padding: '1rem' }}>
      <SectionHeader title="Income" collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} collapsedSummary={`Total: ${fmt(totalIncome)}`}>
        <button className="btn-primary" onClick={() => setShowAdd(true)} style={{ fontSize: '0.8rem', padding: '0.25rem 0.6rem' }}>
          + Add
        </button>
      </SectionHeader>

      {!collapsed && (
        <>
          {entries.length === 0 ? (
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', margin: 0 }}>No income entries yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              {entries.map((e) => (
                <InlineEditRow
                  key={e._id}
                  name={e.name}
                  value={e.value}
                  onChangeName={(v) => onUpdate(e._id, { name: v })}
                  onChangeValue={(v) => onUpdate(e._id, { value: v })}
                  onRemove={() => onRemove(e._id)}
                />
              ))}
            </div>
          )}

          <div style={{ borderTop: '1px solid var(--color-border)', marginTop: '0.75rem', paddingTop: '0.5rem', display: 'flex', justifyContent: 'flex-end', fontSize: '0.875rem', fontWeight: 600 }}>
            Total income: {fmt(totalIncome)}
          </div>

          {showAdd && (
            <AddEntryModal
              title="Add Income"
              fields={[{ key: 'name', label: 'Name', type: 'text' }, { key: 'value', label: 'Monthly value (€)', type: 'number' }]}
              onSave={(d) => { onAdd({ name: d.name, value: Number(d.value), isFromTemplate: false }); setShowAdd(false); }}
              onClose={() => setShowAdd(false)}
            />
          )}
        </>
      )}
    </div>
  );
}

// ── Monthly Expenses Section ─────────────────────────────────────────────────

function MonthlyExpensesSection({ entries, onAdd, onUpdate, onRemove, onSyncFrom, onSyncTo }) {
  const [showAdd, setShowAdd] = useState(false);
  const [showSyncToModal, setShowSyncToModal] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [collapsed, setCollapsed] = useState(true);

  const totalAll = sum(entries, (e) => e.value);
  const totalMust = sum(entries.filter((e) => e.classification === 'must'), (e) => e.value);
  const totalWant = sum(entries.filter((e) => e.classification === 'want'), (e) => e.value);

  async function doSyncTo(dayOverrides) {
    setSyncing(true);
    setSyncError('');
    try {
      await onSyncTo('monthly', dayOverrides);
      setShowSyncToModal(false);
    } catch (err) {
      setSyncError(err.message);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="card" style={{ padding: '1rem' }}>
      <SectionHeader title="Monthly Expenses" collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} collapsedSummary={`Total: ${fmt(totalAll)} | Must: ${fmt(totalMust)} | Want: ${fmt(totalWant)}`}>
        <button className="btn-secondary" onClick={onSyncFrom} style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}>
          Sync from template
        </button>
        <button className="btn-secondary" onClick={() => setShowSyncToModal(true)} style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}>
          Sync to template
        </button>
        <button className="btn-primary" onClick={() => setShowAdd(true)} style={{ fontSize: '0.8rem', padding: '0.25rem 0.6rem' }}>
          + Add
        </button>
      </SectionHeader>

      {!collapsed && (
        <>
          {entries.length === 0 ? (
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', margin: 0 }}>No monthly expenses.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              {entries.map((e) => (
                <ExpenseEntryRow
                  key={e._id}
                  entry={e}
                  onChangeName={(v) => onUpdate(e._id, { name: v })}
                  onChangeValue={(v) => onUpdate(e._id, { value: v })}
                  onChangeClassification={(v) => onUpdate(e._id, { classification: v })}
                  onRemove={() => onRemove(e._id)}
                />
              ))}
            </div>
          )}

          <SectionSummary rows={[
            { label: 'Total monthly expenses', value: totalAll },
            { label: 'Total Must', value: totalMust },
            { label: 'Total Want', value: totalWant },
          ]} />

      {showAdd && (
        <AddEntryModal
          title="Add Monthly Expense"
          fields={[
            { key: 'name', label: 'Name', type: 'text' },
            { key: 'type', label: 'Type', type: 'select', options: [{ value: 'Fixed', label: 'Fixed' }, { value: 'Budget', label: 'Budget' }] },
            { key: 'value', label: 'Value / Max (€)', type: 'number' },
            { key: 'classification', label: 'Classification', type: 'classification-pills' },
          ]}
          onSave={(d) => {
            onAdd({ name: d.name, value: Number(d.value), type: d.type || 'Fixed', classification: d.classification || null, isFromTemplate: false, templateItemId: null });
            setShowAdd(false);
          }}
          onClose={() => setShowAdd(false)}
        />
      )}

          {showSyncToModal && (
            <SyncToTemplateModal
              title="Sync Monthly Expenses to Template"
              warning="This will discard and replace the entire Monthly Expenses template with the current Workbench entries."
              entries={entries}
              needsDay={(e) => !e.isFromTemplate && e.type === 'Fixed'}
              dayFieldLabel="Day of payment"
              syncing={syncing}
              syncError={syncError}
              onConfirm={doSyncTo}
              onClose={() => { setShowSyncToModal(false); setSyncError(''); }}
            />
          )}
        </>
      )}
    </div>
  );
}

// ── Annual Expenses Section ──────────────────────────────────────────────────

function AnnualExpensesSection({ entries, annualDeductible, onChangeDeductible, onAdd, onUpdate, onRemove, onSyncFrom, onSyncTo }) {
  const [showAdd, setShowAdd] = useState(false);
  const [showSyncToModal, setShowSyncToModal] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [collapsed, setCollapsed] = useState(true);

  const totalAnnual = sum(entries, (e) => e.value);
  const totalMustAnnual = sum(entries.filter((e) => e.classification === 'must'), (e) => e.value);
  const totalWantAnnual = sum(entries.filter((e) => e.classification === 'want'), (e) => e.value);
  const totalMonthlyAvg = totalAnnual / 12;
  const totalMustAvg = totalMustAnnual / 12;
  const totalWantAvg = totalWantAnnual / 12;
  const annualMissing = totalAnnual - (annualDeductible || 0);
  const monthlyMissingAvg = annualMissing / 12;

  async function doSyncTo(overrides) {
    setSyncing(true);
    setSyncError('');
    try {
      await onSyncTo('annual', overrides);
      setShowSyncToModal(false);
    } catch (err) {
      setSyncError(err.message);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="card" style={{ padding: '1rem' }}>
      <SectionHeader title="Annual Expenses" collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} collapsedSummary={`Annual: ${fmt(totalAnnual)} | Avg/mo: ${fmt(totalMonthlyAvg)} | Missing avg: ${fmt(monthlyMissingAvg)}`}>
        <button className="btn-secondary" onClick={onSyncFrom} style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}>
          Sync from template
        </button>
        <button className="btn-secondary" onClick={() => setShowSyncToModal(true)} style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}>
          Sync to template
        </button>
        <button className="btn-primary" onClick={() => setShowAdd(true)} style={{ fontSize: '0.8rem', padding: '0.25rem 0.6rem' }}>
          + Add
        </button>
      </SectionHeader>

      {!collapsed && (
        <>
          {entries.length === 0 ? (
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', margin: 0 }}>No annual expenses.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ color: 'var(--color-text-muted)' }}>
                  <th style={{ padding: '0.25rem 0.4rem', textAlign: 'left', fontWeight: 500 }}>Name</th>
                  <th style={{ padding: '0.25rem 0.4rem', textAlign: 'right', fontWeight: 500 }}>Annual</th>
                  <th style={{ padding: '0.25rem 0.4rem', textAlign: 'right', fontWeight: 500 }}>Monthly avg</th>
                  <th style={{ padding: '0.25rem 0.4rem', fontWeight: 500 }}>Classification</th>
                  <th style={{ padding: '0.25rem 0.4rem' }}></th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <AnnualEntryRow
                    key={e._id}
                    entry={e}
                    onChangeName={(v) => onUpdate(e._id, { name: v })}
                    onChangeValue={(v) => onUpdate(e._id, { value: v })}
                    onChangeClassification={(v) => onUpdate(e._id, { classification: v })}
                    onRemove={() => onRemove(e._id)}
                  />
                ))}
              </tbody>
            </table>
          )}

          <SectionSummary rows={[
            { label: 'Total annual', value: totalAnnual },
            { label: 'Must (annual)', value: totalMustAnnual },
            { label: 'Want (annual)', value: totalWantAnnual },
            { label: 'Monthly avg', value: totalMonthlyAvg },
            { label: 'Must avg/mo', value: totalMustAvg },
            { label: 'Want avg/mo', value: totalWantAvg },
          ]} />

          <div style={{ borderTop: '1px solid var(--color-border)', marginTop: '0.75rem', paddingTop: '0.6rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}>
            <span style={{ color: 'var(--color-text-muted)' }}>Carried over:</span>
            <input
              type="number"
              min={0}
              step="0.01"
              value={annualDeductible || ''}
              onChange={(e) => onChangeDeductible(Number(e.target.value) || 0)}
              placeholder="0.00"
              style={{ width: '8rem', textAlign: 'right', fontSize: '0.875rem' }}
            />
            <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>€</span>
          </div>

          <div style={{ marginTop: '0.5rem', padding: '0.5rem 0.75rem', background: 'var(--color-surface)', borderRadius: 'var(--radius)', border: '1px solid var(--color-border)', display: 'flex', flexWrap: 'wrap', gap: '1.5rem', fontSize: '0.85rem' }}>
            <div>
              <span style={{ color: 'var(--color-text-muted)' }}>Annual missing: </span>
              <strong>{fmt(annualMissing)}</strong>
            </div>
            <div>
              <span style={{ color: 'var(--color-text-muted)' }}>Monthly missing avg: </span>
              <strong>{fmt(monthlyMissingAvg)}</strong>
            </div>
          </div>

          {showAdd && (
            <AddEntryModal
              title="Add Annual Expense"
              fields={[
                { key: 'name', label: 'Name', type: 'text' },
                { key: 'value', label: 'Annual value (€)', type: 'number' },
                { key: 'classification', label: 'Classification', type: 'classification-pills' },
              ]}
              onSave={(d) => {
                onAdd({ name: d.name, value: Number(d.value), classification: d.classification || null, isFromTemplate: false, templateItemId: null });
                setShowAdd(false);
              }}
              onClose={() => setShowAdd(false)}
            />
          )}

          {showSyncToModal && (
            <SyncToTemplateModal
              title="Sync Annual Expenses to Template"
              warning="This will discard and replace the entire Annual Expenses template with the current Workbench entries."
              entries={entries}
              needsDay={(e) => !e.isFromTemplate}
              dayFieldLabel="Day + Month of payment"
              needsDayMonth
              syncing={syncing}
              syncError={syncError}
              onConfirm={doSyncTo}
              onClose={() => { setShowSyncToModal(false); setSyncError(''); }}
            />
          )}
        </>
      )}
    </div>
  );
}

// ── Distributions Section ────────────────────────────────────────────────────

function DistributionsSection({ entries, onAdd, onUpdate, onRemove, onSyncFrom, onSyncTo }) {
  const [showAdd, setShowAdd] = useState(false);
  const [showSyncToModal, setShowSyncToModal] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [collapsed, setCollapsed] = useState(true);
  const [confirmState, setConfirmState] = useState(null);

  const totalDist = sum(entries, (e) => e.value);
  const totalMust = sum(entries, (e) => e.must_amount || 0);
  const totalWant = sum(entries, (e) => e.want_amount || 0);
  const totalSave = sum(entries, (e) => e.save_amount || 0);

  function doSyncTo() {
    setConfirmState({
      title: 'Sync to template',
      message: 'This will discard and replace the entire Distributions template with the current Workbench entries. Proceed?',
      confirmLabel: 'Sync',
      danger: true,
      onConfirm: async () => {
        setSyncing(true);
        setSyncError('');
        try {
          await onSyncTo('distributions', {});
          setShowSyncToModal(false);
        } catch (err) {
          setSyncError(err.message);
        } finally {
          setSyncing(false);
        }
      },
    });
  }

  return (
    <div className="card" style={{ padding: '1rem' }}>
      <SectionHeader title="Distributions" collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} collapsedSummary={`Total: ${fmt(totalDist)} | Must: ${fmt(totalMust)} | Want: ${fmt(totalWant)} | Save: ${fmt(totalSave)}`}>
        <button className="btn-secondary" onClick={onSyncFrom} style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}>
          Sync from template
        </button>
        <button className="btn-secondary" onClick={doSyncTo} style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}>
          Sync to template
        </button>
        <button className="btn-primary" onClick={() => setShowAdd(true)} style={{ fontSize: '0.8rem', padding: '0.25rem 0.6rem' }}>
          + Add
        </button>
      </SectionHeader>

      {!collapsed && (
        <>
          {syncError && <div className="alert alert-error" style={{ marginBottom: '0.5rem', fontSize: '0.8rem' }}>{syncError}</div>}

          {entries.length === 0 ? (
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', margin: 0 }}>No distributions.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {entries.map((e) => (
                <DistributionEntryRow
                  key={e._id}
                  entry={e}
                  onChangeName={(v) => onUpdate(e._id, { name: v })}
                  onChangeValue={(v) => onUpdate(e._id, { value: v })}
                  onChangeDecomp={(f, v) => onUpdate(e._id, { [f]: v === '' ? null : Number(v) })}
                  onRemove={() => onRemove(e._id)}
                />
              ))}
            </div>
          )}

          <SectionSummary rows={[
            { label: 'Total distributions', value: totalDist },
            { label: 'Total Must', value: totalMust },
            { label: 'Total Want', value: totalWant },
            { label: 'Total Save', value: totalSave },
          ]} />

          {showAdd && (
            <AddEntryModal
              title="Add Distribution"
              fields={[
                { key: 'name', label: 'Name', type: 'text' },
                { key: 'value', label: 'Value (€)', type: 'number' },
              ]}
              onSave={(d) => {
                onAdd({ name: d.name, value: Number(d.value), must_amount: null, want_amount: null, save_amount: null, isFromTemplate: false, templateItemId: null });
                setShowAdd(false);
              }}
              onClose={() => setShowAdd(false)}
            />
          )}
        </>
      )}
      {confirmState && <ConfirmModal {...confirmState} onCancel={() => setConfirmState(null)} />}
    </div>
  );
}

// ── Global Summary Section ───────────────────────────────────────────────────

const SUMMARY_COLORS = {
  must: '#f59e0b',
  want: '#3b82f6',
  save: '#22c55e',
  leftover: '#94a3b8',
};

function IncomeStackBar({ totalIncome, totalMust, totalWant, totalSave, leftover }) {
  const segments = [
    { key: 'must', label: 'Must', value: Math.max(0, totalMust), color: SUMMARY_COLORS.must },
    { key: 'want', label: 'Want', value: Math.max(0, totalWant), color: SUMMARY_COLORS.want },
    { key: 'save', label: 'Save', value: Math.max(0, totalSave), color: SUMMARY_COLORS.save },
    { key: 'leftover', label: 'Leftover', value: Math.max(0, leftover), color: SUMMARY_COLORS.leftover },
  ].filter((s) => s.value > 0);

  const total = segments.reduce((acc, s) => acc + s.value, 0);
  if (total <= 0) return null;

  return (
    <div style={{ marginTop: '0.75rem' }}>
      <div style={{ display: 'flex', height: '1.75rem', borderRadius: 'var(--radius)', overflow: 'hidden', gap: '2px' }}>
        {segments.map((seg) => {
          const pct = (seg.value / total) * 100;
          return (
            <div
              key={seg.key}
              title={`${seg.label}: ${fmt(seg.value)} (${pct.toFixed(1)}%)`}
              style={{ flex: pct, background: seg.color, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', minWidth: 0 }}
            >
              {pct > 9 && (
                <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', textShadow: '0 1px 2px rgba(0,0,0,0.35)' }}>
                  {pct.toFixed(0)}%
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: '1rem', marginTop: '0.4rem', flexWrap: 'wrap' }}>
        {segments.map((seg) => {
          const pct = (seg.value / total) * 100;
          return (
            <div key={seg.key} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
              <span style={{ width: '0.55rem', height: '0.55rem', borderRadius: '50%', background: seg.color, flexShrink: 0, display: 'inline-block' }} />
              {seg.label} {pct.toFixed(1)}%
            </div>
          );
        })}
        {leftover < 0 && (
          <div style={{ fontSize: '0.72rem', color: 'var(--color-danger)', marginLeft: 'auto' }}>
            Over budget by {fmt(Math.abs(leftover))}
          </div>
        )}
      </div>
    </div>
  );
}

function GlobalSummarySection({ summary }) {
  const { totalIncome, totalMust, totalWant, totalSave, leftover } = summary;
  const [collapsed, setCollapsed] = useState(true);

  const collapsedSummary = `Income: ${fmt(totalIncome)} | Must: ${fmtPct(totalMust, totalIncome)} | Want: ${fmtPct(totalWant, totalIncome)} | Save: ${fmtPct(totalSave, totalIncome)} | Leftover: ${fmt(leftover)}`;

  return (
    <div className="card" style={{ padding: '1rem' }}>
      <SectionHeader title="Global Summary" collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} collapsedSummary={collapsedSummary} />

      <IncomeStackBar totalIncome={totalIncome} totalMust={totalMust} totalWant={totalWant} totalSave={totalSave} leftover={leftover} />

      {!collapsed && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(10rem, 1fr))', gap: '0.75rem', marginTop: '0.75rem' }}>
          {[
            { label: 'Total Income', value: totalIncome, bold: true },
            { label: 'Total Must', value: totalMust, pct: fmtPct(totalMust, totalIncome) },
            { label: 'Total Want', value: totalWant, pct: fmtPct(totalWant, totalIncome) },
            { label: 'Total Save', value: totalSave, pct: fmtPct(totalSave, totalIncome) },
            { label: 'Leftover', value: leftover, pct: fmtPct(leftover, totalIncome), highlight: leftover < 0 ? 'danger' : leftover > 0 ? 'success' : null },
          ].map(({ label, value, pct, bold, highlight }) => (
            <div key={label} style={{ padding: '0.6rem', background: 'var(--color-surface)', borderRadius: 'var(--radius)', border: '1px solid var(--color-border)' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginBottom: '0.2rem' }}>{label}</div>
              <div style={{
                fontWeight: bold ? 700 : 600,
                fontSize: '0.95rem',
                color: highlight === 'danger' ? 'var(--color-danger)' : highlight === 'success' ? 'var(--color-success)' : 'inherit',
              }}>
                {fmt(value)}
              </div>
              {pct && <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>{pct}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Row Components ───────────────────────────────────────────────────────────

function InlineEditRow({ name, value, onChangeName, onChangeValue, onRemove }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.35rem 0.5rem', background: 'var(--color-surface)', borderRadius: 'var(--radius)', border: '1px solid var(--color-border)' }}>
      <input
        type="text"
        value={name}
        onChange={(e) => onChangeName(e.target.value)}
        style={{ flex: 1, border: 'none', background: 'transparent', padding: '0', fontSize: '0.875rem' }}
        placeholder="Name"
      />
      <input
        type="number"
        min={0}
        step="0.01"
        value={value}
        onChange={(e) => onChangeValue(Number(e.target.value))}
        style={{ width: '7rem', textAlign: 'right', fontSize: '0.875rem' }}
      />
      <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>€</span>
      <button onClick={onRemove} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: '1rem', padding: '0 0.2rem', flexShrink: 0 }} title="Remove">&times;</button>
    </div>
  );
}

function ExpenseEntryRow({ entry, onChangeName, onChangeValue, onChangeClassification, onRemove }) {
  const noClass = !entry.classification;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.35rem 0.5rem',
      background: noClass ? '#fffbeb' : 'var(--color-surface)',
      borderRadius: 'var(--radius)',
      border: `1px solid ${noClass ? '#fde68a' : 'var(--color-border)'}`,
      flexWrap: 'wrap',
    }}>
      <input
        type="text"
        value={entry.name}
        onChange={(e) => onChangeName(e.target.value)}
        style={{ flex: 1, minWidth: '6rem', border: 'none', background: 'transparent', padding: '0', fontSize: '0.875rem' }}
      />
      {entry.isFromTemplate && <TemplateTag />}
      <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>{entry.type}</span>
      <input
        type="number"
        min={0}
        step="0.01"
        value={entry.value}
        onChange={(e) => onChangeValue(Number(e.target.value))}
        style={{ width: '7rem', textAlign: 'right', fontSize: '0.875rem' }}
      />
      <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>€</span>
      <ClassificationPills value={entry.classification} onChange={onChangeClassification} />
      <button onClick={onRemove} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: '1rem', padding: '0 0.2rem', flexShrink: 0 }} title="Remove">&times;</button>
    </div>
  );
}

function AnnualEntryRow({ entry, onChangeName, onChangeValue, onChangeClassification, onRemove }) {
  const noClass = !entry.classification;
  return (
    <tr style={{ borderTop: '1px solid var(--color-border)', background: noClass ? '#fffbeb' : 'transparent' }}>
      <td style={{ padding: '0.3rem 0.4rem' }}>
        <input
          type="text"
          value={entry.name}
          onChange={(e) => onChangeName(e.target.value)}
          style={{ border: 'none', background: 'transparent', padding: 0, fontSize: '0.875rem', width: '100%' }}
        />
        {entry.isFromTemplate && <TemplateTag />}
      </td>
      <td style={{ padding: '0.3rem 0.4rem', textAlign: 'right' }}>
        <input
          type="number"
          min={0}
          step="0.01"
          value={entry.value}
          onChange={(e) => onChangeValue(Number(e.target.value))}
          style={{ width: '7rem', textAlign: 'right', fontSize: '0.875rem' }}
        />
        <span style={{ marginLeft: '0.2rem', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>€</span>
      </td>
      <td style={{ padding: '0.3rem 0.4rem', textAlign: 'right', color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>
        {fmt(entry.value / 12)}
      </td>
      <td style={{ padding: '0.3rem 0.4rem' }}>
        <ClassificationPills value={entry.classification} onChange={onChangeClassification} />
      </td>
      <td style={{ padding: '0.3rem 0.4rem', textAlign: 'right' }}>
        <button onClick={onRemove} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: '1rem', padding: '0 0.2rem' }} title="Remove">&times;</button>
      </td>
    </tr>
  );
}

function DistributionEntryRow({ entry, onChangeName, onChangeValue, onChangeDecomp, onRemove }) {
  const total = (entry.must_amount || 0) + (entry.want_amount || 0) + (entry.save_amount || 0);
  const anySet = entry.must_amount != null || entry.want_amount != null || entry.save_amount != null;
  const mismatch = anySet && Math.abs(total - entry.value) > 0.005;

  return (
    <div style={{
      padding: '0.5rem 0.6rem',
      background: 'var(--color-surface)',
      borderRadius: 'var(--radius)',
      border: `1px solid ${mismatch ? 'var(--color-danger)' : 'var(--color-border)'}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem', flexWrap: 'wrap' }}>
        <input
          type="text"
          value={entry.name}
          onChange={(e) => onChangeName(e.target.value)}
          style={{ flex: 1, minWidth: '6rem', border: 'none', background: 'transparent', padding: 0, fontSize: '0.875rem' }}
        />
        {entry.isFromTemplate && <TemplateTag />}
        <input
          type="number"
          min={0}
          step="0.01"
          value={entry.value}
          onChange={(e) => onChangeValue(Number(e.target.value))}
          style={{ width: '7rem', textAlign: 'right', fontSize: '0.875rem' }}
        />
        <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>€</span>
        <button onClick={onRemove} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: '1rem', padding: '0 0.2rem', flexShrink: 0 }} title="Remove">&times;</button>
      </div>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', fontSize: '0.8rem', flexWrap: 'wrap' }}>
        {[['must_amount', 'Must'], ['want_amount', 'Want'], ['save_amount', 'Save']].map(([field, label]) => (
          <div key={field} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <span style={{ color: 'var(--color-text-muted)' }}>{label}:</span>
            <input
              type="number"
              min={0}
              step="0.01"
              value={entry[field] ?? ''}
              onChange={(e) => onChangeDecomp(field, e.target.value)}
              placeholder="—"
              style={{ width: '5rem', textAlign: 'right', fontSize: '0.8rem', border: mismatch ? '1px solid var(--color-danger)' : '1px solid var(--color-border)' }}
            />
          </div>
        ))}
        {mismatch && (
          <span style={{ color: 'var(--color-danger)', fontSize: '0.75rem' }}>
            sum {fmt(total)} ≠ {fmt(entry.value)}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Section Summary ──────────────────────────────────────────────────────────

function SectionSummary({ rows }) {
  return (
    <div style={{ borderTop: '1px solid var(--color-border)', marginTop: '0.75rem', paddingTop: '0.5rem', display: 'flex', flexWrap: 'wrap', gap: '1.25rem', fontSize: '0.8rem' }}>
      {rows.map(({ label, value }) => (
        <div key={label}>
          <span style={{ color: 'var(--color-text-muted)' }}>{label}: </span>
          <strong>{fmt(value)}</strong>
        </div>
      ))}
    </div>
  );
}

// ── Add Entry Modal ──────────────────────────────────────────────────────────

function AddEntryModal({ title, fields, onSave, onClose }) {
  const [values, setValues] = useState(() =>
    Object.fromEntries(fields.map((f) => [f.key, f.default ?? '']))
  );
  const [error, setError] = useState('');

  function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!values.name?.trim()) { setError('Name is required'); return; }
    if (fields.find((f) => f.key === 'value')) {
      const n = Number(values.value);
      if (isNaN(n) || n < 0) { setError('Value must be a non-negative number'); return; }
    }
    onSave(values);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="alert alert-error">{error}</div>}
            {fields.map((f) => (
              <div key={f.key} className="form-group">
                <label>{f.label}</label>
                {f.type === 'classification-pills' ? (
                  <ClassificationPills
                    value={values[f.key] || null}
                    onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))}
                  />
                ) : f.type === 'select' ? (
                  <select value={values[f.key] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}>
                    {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : (
                  <input
                    type={f.type}
                    min={f.type === 'number' ? 0 : undefined}
                    step={f.type === 'number' ? '0.01' : undefined}
                    value={values[f.key] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                    placeholder={f.placeholder ?? ''}
                    autoFocus={f.key === 'name'}
                  />
                )}
              </div>
            ))}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary">Add</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Sync-to-Template Modal ───────────────────────────────────────────────────

const MONTHS_LIST = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function SyncToTemplateModal({ title, warning, entries, needsDay, dayFieldLabel, needsDayMonth, syncing, syncError, onConfirm, onClose }) {
  const adHocNeedingDay = entries.filter(needsDay);
  const [dayValues, setDayValues] = useState(
    () => Object.fromEntries(adHocNeedingDay.map((e) => [e._id, needsDayMonth ? { day: '', month: '' } : '']))
  );
  const [localError, setLocalError] = useState('');

  function validate() {
    for (const e of adHocNeedingDay) {
      if (needsDayMonth) {
        const d = dayValues[e._id]?.day;
        const m = dayValues[e._id]?.month;
        if (!d || !m) return `Please provide day and month for "${e.name}"`;
        if (isNaN(Number(d)) || Number(d) < 1 || Number(d) > 31) return `Invalid day for "${e.name}"`;
        if (isNaN(Number(m)) || Number(m) < 1 || Number(m) > 12) return `Invalid month for "${e.name}"`;
      } else {
        const d = dayValues[e._id];
        if (!d) return `Please provide day of payment for "${e.name}"`;
        if (isNaN(Number(d)) || Number(d) < 1 || Number(d) > 31) return `Day must be 1–31 for "${e.name}"`;
      }
    }
    return null;
  }

  function handleConfirm() {
    setLocalError('');
    const err = validate();
    if (err) { setLocalError(err); return; }

    const overrides = {};
    for (const e of adHocNeedingDay) {
      if (needsDayMonth) {
        overrides[e._id] = { day: Number(dayValues[e._id].day), month: Number(dayValues[e._id].month) };
      } else {
        overrides[e._id] = Number(dayValues[e._id]);
      }
    }
    onConfirm(overrides);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{warning}</div>
          {(localError || syncError) && <div className="alert alert-error" style={{ marginBottom: '0.75rem' }}>{localError || syncError}</div>}

          {adHocNeedingDay.length > 0 && (
            <div>
              <p style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                The following new entries need {needsDayMonth ? 'a day and month' : 'a day'} of payment:
              </p>
              {adHocNeedingDay.map((e) => (
                <div key={e._id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.875rem', flex: 1 }}>{e.name}</span>
                  {needsDayMonth ? (
                    <>
                      <input
                        type="number"
                        min={1}
                        max={31}
                        value={dayValues[e._id]?.day ?? ''}
                        onChange={(ev) => setDayValues((v) => ({ ...v, [e._id]: { ...v[e._id], day: ev.target.value } }))}
                        placeholder="Day"
                        style={{ width: '4.5rem' }}
                      />
                      <select
                        value={dayValues[e._id]?.month ?? ''}
                        onChange={(ev) => setDayValues((v) => ({ ...v, [e._id]: { ...v[e._id], month: ev.target.value } }))}
                        style={{ fontSize: '0.8rem' }}
                      >
                        <option value="">Month</option>
                        {MONTHS_LIST.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                      </select>
                    </>
                  ) : (
                    <input
                      type="number"
                      min={1}
                      max={31}
                      value={dayValues[e._id] ?? ''}
                      onChange={(ev) => setDayValues((v) => ({ ...v, [e._id]: ev.target.value }))}
                      placeholder="Day (1–31)"
                      style={{ width: '6rem' }}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-danger" onClick={handleConfirm} disabled={syncing}>
            {syncing ? 'Syncing…' : 'Replace template'}
          </button>
        </div>
      </div>
    </div>
  );
}
