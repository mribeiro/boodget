import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { parseDecimalInput } from '../../utils/numbers';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faXmark } from '@fortawesome/free-solid-svg-icons';
import { api } from '../../services/api';
import {
  computeCycleStartDate, computeTheoreticalCycleEndDate,
  formatCycleLabel, formatDateRange, fromIsoDate,
  nextYearMonth, prevYearMonth,
} from '../../utils/cycleDates';

export default function CycleList({ dossierId }) {
  const navigate = useNavigate();
  const [cycles, setCycles] = useState([]);
  const [cycleStartDay, setCycleStartDay] = useState(25);
  const [weekendAdjustment, setWeekendAdjustment] = useState('none');
  // null = no modal; { year, month } = modal open with pre-filled values
  const [modalPreset, setModalPreset] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    load();
  }, [dossierId]);

  async function load() {
    try {
      const [data, settings] = await Promise.all([
        api.getCycles(dossierId),
        api.getDossierSettings(dossierId),
      ]);
      // Sort newest-first
      data.sort((a, b) => b.year - a.year || b.month - a.month);
      setCycles(data);
      setCycleStartDay(settings.cycle_start_day ?? 25);
      setWeekendAdjustment(settings.cycle_start_weekend_adjustment ?? 'none');
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleCreate(data) {
    try {
      const cycle = await api.createCycle(dossierId, data);
      navigate(`/dossiers/${dossierId}/cycles/${cycle.id}`);
    } catch (err) {
      throw err;
    }
  }

  const newest = cycles[0];
  const oldest = cycles[cycles.length - 1];

  return (
    <div>
      {error && <div className="alert alert-error" style={{ marginBottom: '0.75rem' }}>{error}</div>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <span style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
          {cycles.length === 0 ? 'No cycles yet.' : `${cycles.length} cycle${cycles.length !== 1 ? 's' : ''}`}
        </span>
        <button
          className="btn-primary"
          onClick={() => setModalPreset({})}
          style={{ fontSize: '0.875rem' }}
        >
          <FontAwesomeIcon icon={faPlus} style={{ marginRight: '0.4rem' }} />Open new cycle
        </button>
      </div>

      {cycles.length === 0 ? null : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
          {/* Top placeholder: next month after the newest cycle. Forward-looking (no cycle
              exists yet), so it uses the dossier's live settings. */}
          {(() => {
            const next = nextYearMonth(newest.year, newest.month);
            const endDate = computeTheoreticalCycleEndDate(next.year, next.month, cycleStartDay, weekendAdjustment);
            return (
              <div
                className="month-row month-row-placeholder"
                onClick={() => setModalPreset(next)}
                style={{ marginBottom: '0.25rem' }}
              >
                <span className="month-row-name">Open {formatCycleLabel(endDate)}</span>
              </div>
            );
          })()}

          {cycles.map((cycle) => {
            const endDate = cycle.actual_end_date
              ? fromIsoDate(cycle.actual_end_date)
              : new Date(cycle.year, cycle.month, (cycle.cycle_start_day ?? cycleStartDay) - 1);
            return (
              <div
                key={cycle.id}
                className="month-row"
                onClick={() => navigate(`/dossiers/${dossierId}/cycles/${cycle.id}`)}
                style={{ cursor: 'pointer', marginBottom: '0.25rem' }}
              >
                <span className="month-row-name">{formatCycleLabel(endDate)}</span>
                <span
                  className={`badge ${cycle.is_closed ? 'badge-filled' : 'badge-empty'}`}
                  style={{ marginLeft: 'auto' }}
                >
                  {cycle.is_closed ? 'Closed' : 'Open'}
                </span>
              </div>
            );
          })}

          {/* Bottom placeholder: previous month before the oldest cycle. Forward-looking. */}
          {(() => {
            const prev = prevYearMonth(oldest.year, oldest.month);
            const endDate = computeTheoreticalCycleEndDate(prev.year, prev.month, cycleStartDay, weekendAdjustment);
            return (
              <div
                className="month-row month-row-placeholder"
                onClick={() => setModalPreset(prev)}
              >
                <span className="month-row-name">Open {formatCycleLabel(endDate)}</span>
              </div>
            );
          })()}
        </div>
      )}

      {modalPreset !== null && (
        <OpenCycleModal
          existingCycles={cycles}
          cycleStartDay={cycleStartDay}
          weekendAdjustment={weekendAdjustment}
          initialYear={modalPreset.year}
          initialMonth={modalPreset.month}
          onCreate={handleCreate}
          onClose={() => setModalPreset(null)}
        />
      )}
    </div>
  );
}

function OpenCycleModal({ existingCycles, cycleStartDay, weekendAdjustment, initialYear, initialMonth, onCreate, onClose }) {
  const now = new Date();
  const defaultYear = initialYear ?? now.getFullYear();
  const defaultMonth = initialMonth ?? (now.getMonth() + 1);
  const [year, setYear] = useState(defaultYear);
  const [month, setMonth] = useState(defaultMonth);
  const [salary, setSalary] = useState('');
  const [previousBalance, setPreviousBalance] = useState('');
  const [previousBalanceTouched, setPreviousBalanceTouched] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const baseYear = now.getFullYear();
  const minYear = Math.min(baseYear - 3, defaultYear);
  const maxYear = Math.max(baseYear + 3, defaultYear);
  const years = Array.from({ length: maxYear - minYear + 1 }, (_, i) => minYear + i);

  function isTaken(y, m) {
    return existingCycles.some((c) => c.year === y && c.month === m);
  }

  // Suggest the previous cycle's closing balance as an editable starting point,
  // whenever that previous cycle exists, is closed, and has a final real balance.
  useEffect(() => {
    if (previousBalanceTouched) return;
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const prevCycle = existingCycles.find((c) => c.year === prevYear && c.month === prevMonth);
    if (prevCycle && prevCycle.is_closed && prevCycle.final_real_balance != null) {
      setPreviousBalance(String(prevCycle.final_real_balance));
    } else {
      setPreviousBalance('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (isTaken(year, month)) { setError('A cycle for this month already exists'); return; }
    if (!salary || isNaN(parseDecimalInput(salary))) { setError('Salary is required'); return; }
    if (previousBalance === '' || isNaN(parseDecimalInput(previousBalance))) { setError('Previous balance is required'); return; }
    setSaving(true);
    try {
      await onCreate({ year, month, salary: parseDecimalInput(salary), previous_balance: parseDecimalInput(previousBalance) });
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  const taken = isTaken(year, month);
  const startDate = computeCycleStartDate(year, month, cycleStartDay, weekendAdjustment);
  const endDate = computeTheoreticalCycleEndDate(year, month, cycleStartDay, weekendAdjustment);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Open New Cycle</h2>
          <button className="close-btn" onClick={onClose}><FontAwesomeIcon icon={faXmark} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="alert alert-error">{error}</div>}
            <div style={{ display: 'flex', gap: '1rem' }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Cycle</label>
                <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
                    const mEndDate = computeTheoreticalCycleEndDate(year, m, cycleStartDay, weekendAdjustment);
                    const endLabel = mEndDate.toLocaleString('en-US', { month: 'long', year: 'numeric' });
                    return (
                      <option key={m} value={m} disabled={isTaken(year, m)}>
                        {endLabel}{isTaken(year, m) ? ' (exists)' : ''}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Year</label>
                <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
                  {years.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: '-0.25rem', marginBottom: '0.75rem' }}>
              {formatDateRange(startDate, endDate)}
            </div>
            {taken && <div className="alert alert-error">This month already has a cycle.</div>}
            <div className="form-group">
              <label>Salary received (€)</label>
              <input type="text" inputMode="decimal" value={salary} onChange={(e) => setSalary(e.target.value)} placeholder="0.00" />
            </div>
            <div className="form-group">
              <label>Previous balance (€)</label>
              <input
                type="text" inputMode="decimal" value={previousBalance}
                onChange={(e) => { setPreviousBalanceTouched(true); setPreviousBalance(e.target.value); }}
                placeholder="0.00"
              />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving || taken}>
              {saving ? 'Opening…' : 'Open & go to cycle'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
