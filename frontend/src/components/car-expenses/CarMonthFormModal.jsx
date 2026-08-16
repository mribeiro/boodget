import { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark } from '@fortawesome/free-solid-svg-icons';
import { api } from '../../services/api';
import { parseDecimalInput, formatNumber } from '../../utils/numbers';
import { computeEnergyCost } from '../../utils/carMath';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function formatEur(value) {
  if (value == null || isNaN(value)) return '—';
  return formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function periodKey(year, month) {
  return year * 12 + month;
}

// Most recent snapshot strictly before (year, month), excluding the one being edited.
function findBaselineSnapshot(months, year, month, excludeId) {
  const targetKey = periodKey(year, month);
  let best = null;
  for (const m of months || []) {
    if (m.id === excludeId) continue;
    const key = periodKey(m.year, m.month);
    if (key < targetKey && (!best || key > periodKey(best.year, best.month))) best = m;
  }
  return best;
}

export default function CarMonthFormModal({ dossierId, car, months, snapshot, onSave, onClose }) {
  const isEdit = !!snapshot;
  const now = new Date();
  const defaultPrev = now.getMonth() === 0 ? { year: now.getFullYear() - 1, month: 12 } : { year: now.getFullYear(), month: now.getMonth() };

  const [year, setYear] = useState(snapshot?.year ?? defaultPrev.year);
  const [month, setMonth] = useState(snapshot?.month ?? defaultPrev.month);
  const [mileage, setMileage] = useState(snapshot?.mileage_km != null ? String(snapshot.mileage_km) : '');
  const [avgL, setAvgL] = useState(snapshot?.avg_l_per_100km != null ? String(snapshot.avg_l_per_100km) : '');
  const [costL, setCostL] = useState(snapshot?.cost_per_l != null ? String(snapshot.cost_per_l) : '');
  const [avgKwh, setAvgKwh] = useState(snapshot?.avg_kwh_per_100km != null ? String(snapshot.avg_kwh_per_100km) : '');
  const [costKwh, setCostKwh] = useState(snapshot?.cost_per_kwh != null ? String(snapshot.cost_per_kwh) : '');
  const [notes, setNotes] = useState(snapshot?.notes ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [prefilledFrom, setPrefilledFrom] = useState(null);

  const fuelApplies = car.fuel_type === 'gas' || car.fuel_type === 'hybrid';
  const elecApplies = car.fuel_type === 'electric' || car.fuel_type === 'hybrid';

  // Prefill the averages/prices from the most recent prior snapshot as soon as a create-mode
  // period is chosen — an editable suggestion, not enforced, same precedent as a cycle's
  // "previous balance" prefill from the prior closed cycle.
  useEffect(() => {
    if (isEdit) return;
    const baseline = findBaselineSnapshot(months, year, month, null);
    if (!baseline) { setPrefilledFrom(null); return; }
    setAvgL((prev) => (prev === '' && baseline.avg_l_per_100km != null ? String(baseline.avg_l_per_100km) : prev));
    setCostL((prev) => (prev === '' && baseline.cost_per_l != null ? String(baseline.cost_per_l) : prev));
    setAvgKwh((prev) => (prev === '' && baseline.avg_kwh_per_100km != null ? String(baseline.avg_kwh_per_100km) : prev));
    setCostKwh((prev) => (prev === '' && baseline.cost_per_kwh != null ? String(baseline.cost_per_kwh) : prev));
    setPrefilledFrom(baseline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month]);

  const baselineSnapshot = findBaselineSnapshot(months, year, month, snapshot?.id);
  const baselineMileage = baselineSnapshot ? baselineSnapshot.mileage_km : car.initial_mileage_km;
  const parsedMileage = parseDecimalInput(mileage);
  const kmDriven = !isNaN(parsedMileage) ? Math.max(0, parsedMileage - baselineMileage) : 0;
  const mileageAnomaly = !isNaN(parsedMileage) && parsedMileage < baselineMileage;

  const preview = computeEnergyCost({
    fuelType: car.fuel_type,
    kmDriven,
    avgLPer100km: avgL === '' ? null : parseDecimalInput(avgL),
    costPerL: costL === '' ? null : parseDecimalInput(costL),
    avgKwhPer100km: avgKwh === '' ? null : parseDecimalInput(avgKwh),
    costPerKwh: costKwh === '' ? null : parseDecimalInput(costKwh),
  });

  function parseOptional(value, label) {
    if (value === '') return { value: null };
    const parsed = parseDecimalInput(value);
    if (isNaN(parsed) || parsed < 0) return { error: `${label} must be a non-negative number` };
    return { value: parsed };
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (isNaN(parsedMileage) || parsedMileage < 0) { setError('Mileage must be a non-negative number'); return; }

    const avgLResult = parseOptional(avgL, 'Average L/100km');
    if (avgLResult.error) { setError(avgLResult.error); return; }
    const costLResult = parseOptional(costL, 'Cost per liter');
    if (costLResult.error) { setError(costLResult.error); return; }
    const avgKwhResult = parseOptional(avgKwh, 'Average kWh/100km');
    if (avgKwhResult.error) { setError(avgKwhResult.error); return; }
    const costKwhResult = parseOptional(costKwh, 'Cost per kWh');
    if (costKwhResult.error) { setError(costKwhResult.error); return; }

    const payload = {
      mileage_km: parsedMileage,
      avg_l_per_100km: avgLResult.value,
      cost_per_l: costLResult.value,
      avg_kwh_per_100km: avgKwhResult.value,
      cost_per_kwh: costKwhResult.value,
      notes: notes.trim() || null,
    };
    if (!isEdit) {
      payload.year = year;
      payload.month = month;
    }

    setSaving(true);
    try {
      const result = isEdit
        ? await api.updateCarMonth(dossierId, car.id, snapshot.id, payload)
        : await api.createCarMonth(dossierId, car.id, payload);
      onSave(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const years = Array.from({ length: 7 }, (_, i) => now.getFullYear() - 5 + i);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: '520px', width: '100%' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{isEdit ? 'Edit Snapshot' : 'New Snapshot'}</h2>
          <button className="close-btn" onClick={onClose}><FontAwesomeIcon icon={faXmark} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {error && <div className="alert alert-error">{error}</div>}

            <div className="form-group">
              <label>Month</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <select value={month} onChange={(e) => setMonth(Number(e.target.value))} disabled={isEdit} style={{ flex: '1 1 auto', minWidth: 0 }}>
                  {MONTH_NAMES.map((m, i) => (
                    <option key={i + 1} value={i + 1}>{m}</option>
                  ))}
                </select>
                <select value={year} onChange={(e) => setYear(Number(e.target.value))} disabled={isEdit} style={{ flex: '0 0 100px', minWidth: 0 }}>
                  {years.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
              {isEdit && (
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  The period can't be changed — delete and recreate the snapshot instead.
                </div>
              )}
            </div>

            <div className="form-group">
              <label>Mileage (km)</label>
              <input type="text" inputMode="decimal" value={mileage} onChange={(e) => setMileage(e.target.value)} placeholder="e.g. 86050" />
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                Previous reading: {formatNumber(baselineMileage, { maximumFractionDigits: 0 })} km
                {baselineSnapshot ? ` (${MONTH_NAMES[baselineSnapshot.month - 1]} ${baselineSnapshot.year})` : ' (initial mileage)'}
                {!isNaN(parsedMileage) && ` — ${formatNumber(kmDriven, { maximumFractionDigits: 0 })} km driven`}
              </div>
              {mileageAnomaly && (
                <div className="alert alert-warning" style={{ marginTop: '0.4rem', fontSize: '0.78rem' }}>
                  This reading is lower than the previous one — km driven will be treated as 0.
                </div>
              )}
            </div>

            {fuelApplies && (
              <div style={{ display: 'flex', gap: '1rem' }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Avg. L/100km</label>
                  <input type="text" inputMode="decimal" value={avgL} onChange={(e) => setAvgL(e.target.value)} placeholder="e.g. 6,2" />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Cost per liter (€)</label>
                  <input type="text" inputMode="decimal" value={costL} onChange={(e) => setCostL(e.target.value)} placeholder="e.g. 1,72" />
                </div>
              </div>
            )}

            {elecApplies && (
              <div style={{ display: 'flex', gap: '1rem' }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Avg. kWh/100km</label>
                  <input type="text" inputMode="decimal" value={avgKwh} onChange={(e) => setAvgKwh(e.target.value)} placeholder="e.g. 16,8" />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Cost per kWh (€)</label>
                  <input type="text" inputMode="decimal" value={costKwh} onChange={(e) => setCostKwh(e.target.value)} placeholder="e.g. 0,18" />
                </div>
              </div>
            )}

            {!isEdit && prefilledFrom && (
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                Averages carried over from {MONTH_NAMES[prefilledFrom.month - 1]} {prefilledFrom.year} — adjust if they changed.
              </div>
            )}

            <div className="form-group">
              <label>Notes <span style={{ fontWeight: 'normal', color: 'var(--text-muted)' }}>(optional)</span></label>
              <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. long road trip this month" />
            </div>

            <div className="card card--flat" style={{ padding: 'var(--space-3)', textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Estimated energy cost this month</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{formatEur(preview.energy_cost)}</div>
              {preview.energy_incomplete && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  Some averages/prices are missing — this figure is incomplete.
                </div>
              )}
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create snapshot'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
