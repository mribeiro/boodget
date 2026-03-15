import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faXmark } from '@fortawesome/free-solid-svg-icons';
import { api } from '../../services/api';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function cycleLabel(year, month) {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

function cycleDateRange(year, month, startDay) {
  const start = new Date(year, month - 1, startDay);
  const end = new Date(year, month, startDay - 1);
  const fmtDate = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${fmtDate(start)} – ${fmtDate(end)}`;
}

function nextMonth(year, month) {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

function prevMonth(year, month) {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

export default function CycleList({ dossierId }) {
  const navigate = useNavigate();
  const [cycles, setCycles] = useState([]);
  const [cycleStartDay, setCycleStartDay] = useState(25);
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
          {/* Top placeholder: next month after the newest cycle */}
          {(() => {
            const next = nextMonth(newest.year, newest.month);
            return (
              <div
                className="month-row month-row-placeholder"
                onClick={() => setModalPreset(next)}
                style={{ marginBottom: '0.25rem' }}
              >
                <span className="month-row-name">Open {cycleLabel(next.year, next.month)}</span>
              </div>
            );
          })()}

          {cycles.map((cycle) => (
            <div
              key={cycle.id}
              className="month-row"
              onClick={() => navigate(`/dossiers/${dossierId}/cycles/${cycle.id}`)}
              style={{ cursor: 'pointer', marginBottom: '0.25rem' }}
            >
              <span className="month-row-name">{cycleLabel(cycle.year, cycle.month)}</span>
              <span
                className={`badge ${cycle.is_closed ? 'badge-filled' : 'badge-empty'}`}
                style={{ marginLeft: 'auto' }}
              >
                {cycle.is_closed ? 'Closed' : 'Open'}
              </span>
            </div>
          ))}

          {/* Bottom placeholder: previous month before the oldest cycle */}
          {(() => {
            const prev = prevMonth(oldest.year, oldest.month);
            return (
              <div
                className="month-row month-row-placeholder"
                onClick={() => setModalPreset(prev)}
              >
                <span className="month-row-name">Open {cycleLabel(prev.year, prev.month)}</span>
              </div>
            );
          })()}
        </div>
      )}

      {modalPreset !== null && (
        <OpenCycleModal
          existingCycles={cycles}
          cycleStartDay={cycleStartDay}
          initialYear={modalPreset.year}
          initialMonth={modalPreset.month}
          onCreate={handleCreate}
          onClose={() => setModalPreset(null)}
        />
      )}
    </div>
  );
}

function OpenCycleModal({ existingCycles, cycleStartDay, initialYear, initialMonth, onCreate, onClose }) {
  const now = new Date();
  const defaultYear = initialYear ?? now.getFullYear();
  const defaultMonth = initialMonth ?? (now.getMonth() + 1);
  const [year, setYear] = useState(defaultYear);
  const [month, setMonth] = useState(defaultMonth);
  const [salary, setSalary] = useState('');
  const [previousBalance, setPreviousBalance] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const baseYear = now.getFullYear();
  const minYear = Math.min(baseYear - 3, defaultYear);
  const maxYear = Math.max(baseYear + 3, defaultYear);
  const years = Array.from({ length: maxYear - minYear + 1 }, (_, i) => minYear + i);

  function isTaken(y, m) {
    return existingCycles.some((c) => c.year === y && c.month === m);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (isTaken(year, month)) { setError('A cycle for this month already exists'); return; }
    if (!salary || isNaN(Number(salary))) { setError('Salary is required'); return; }
    if (previousBalance === '' || isNaN(Number(previousBalance))) { setError('Previous balance is required'); return; }
    setSaving(true);
    try {
      await onCreate({ year, month, salary: Number(salary), previous_balance: Number(previousBalance) });
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  const taken = isTaken(year, month);

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
                <label>Month</label>
                <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={m} disabled={isTaken(year, m)}>
                      {new Date(year, m - 1).toLocaleString('en-US', { month: 'long' })}
                      {isTaken(year, m) ? ' (exists)' : ''}
                    </option>
                  ))}
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
              {cycleDateRange(year, month, cycleStartDay)}
            </div>
            {taken && <div className="alert alert-error">This month already has a cycle.</div>}
            <div className="form-group">
              <label>Salary received (€)</label>
              <input type="number" min={0} step="0.01" value={salary} onChange={(e) => setSalary(e.target.value)} placeholder="0.00" />
            </div>
            <div className="form-group">
              <label>Previous balance (€)</label>
              <input type="number" step="0.01" value={previousBalance} onChange={(e) => setPreviousBalance(e.target.value)} placeholder="0.00" />
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
