import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark } from '@fortawesome/free-solid-svg-icons';
import { api } from '../../services/api';
import { parseDecimalInput } from '../../utils/numbers';

export default function CarFormModal({ dossierId, car, onSave, onClose }) {
  const isEdit = !!car;

  const [name, setName] = useState(car?.name ?? '');
  const [licensePlate, setLicensePlate] = useState(car?.license_plate ?? '');
  const [make, setMake] = useState(car?.make ?? '');
  const [model, setModel] = useState(car?.model ?? '');
  const [fuelType, setFuelType] = useState(car?.fuel_type ?? 'gas');
  const [initialMileage, setInitialMileage] = useState(car?.initial_mileage_km != null ? String(car.initial_mileage_km) : '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!name.trim()) { setError('Name is required'); return; }
    if (!['electric', 'hybrid', 'gas'].includes(fuelType)) { setError('Fuel type is required'); return; }

    const mileage = parseDecimalInput(initialMileage);
    if (isNaN(mileage) || mileage < 0) {
      setError(isEdit ? 'Initial mileage must be a non-negative number' : 'Current mileage must be a non-negative number');
      return;
    }

    const payload = {
      name: name.trim(),
      license_plate: licensePlate.trim() || null,
      make: make.trim() || null,
      model: model.trim() || null,
      fuel_type: fuelType,
      initial_mileage_km: mileage,
    };

    setSaving(true);
    try {
      const result = isEdit
        ? await api.updateCar(dossierId, car.id, payload)
        : await api.createCar(dossierId, payload);
      onSave(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: '520px', width: '100%' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{isEdit ? 'Edit Car' : 'New Car'}</h2>
          <button className="close-btn" onClick={onClose}><FontAwesomeIcon icon={faXmark} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {error && <div className="alert alert-error">{error}</div>}

            <div className="form-group">
              <label>Name</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Daily Driver" />
            </div>

            <div style={{ display: 'flex', gap: '1rem' }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Make <span style={{ fontWeight: 'normal', color: 'var(--text-muted)' }}>(optional)</span></label>
                <input type="text" value={make} onChange={(e) => setMake(e.target.value)} placeholder="e.g. Renault" />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Model <span style={{ fontWeight: 'normal', color: 'var(--text-muted)' }}>(optional)</span></label>
                <input type="text" value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g. Clio" />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '1rem' }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label>License plate <span style={{ fontWeight: 'normal', color: 'var(--text-muted)' }}>(optional)</span></label>
                <input type="text" value={licensePlate} onChange={(e) => setLicensePlate(e.target.value)} placeholder="e.g. 12-AB-34" />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Fuel type</label>
                <select value={fuelType} onChange={(e) => setFuelType(e.target.value)}>
                  <option value="gas">Gas</option>
                  <option value="hybrid">Hybrid</option>
                  <option value="electric">Electric</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label>{isEdit ? 'Initial mileage (km)' : 'Current mileage (km)'}</label>
              <input
                type="text"
                inputMode="decimal"
                value={initialMileage}
                onChange={(e) => setInitialMileage(e.target.value)}
                placeholder="e.g. 84200"
              />
              {isEdit && (
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  Only used as the baseline for the first snapshot — later months use the previous snapshot's reading instead.
                </div>
              )}
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create car'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
