import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faTriangleExclamation, faGasPump, faBolt, faCarBattery } from '@fortawesome/free-solid-svg-icons';
import { api } from '../../services/api';
import { formatNumber } from '../../utils/numbers';
import CarFormModal from './CarFormModal';
import KpiStrip from '../ui/KpiStrip';
import Badge from '../ui/Badge';

function formatEur(value) {
  if (value == null) return '—';
  return formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function formatKm(value) {
  if (value == null) return '—';
  return formatNumber(value, { maximumFractionDigits: 0 }) + ' km';
}

const FUEL_LABELS = { electric: 'Electric', hybrid: 'Hybrid', gas: 'Gas' };
const FUEL_ICONS = { electric: faBolt, hybrid: faCarBattery, gas: faGasPump };

export default function CarExpensesTab({ dossierId }) {
  const navigate = useNavigate();
  const [cars, setCars] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    loadCars();
  }, [dossierId]);

  async function loadCars() {
    setLoading(true);
    setError('');
    try {
      const data = await api.getCars(dossierId);
      setCars(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleCarCreated(newCar) {
    setCars((prev) => [...prev, newCar]);
    setShowCreate(false);
    navigate(`/dossiers/${dossierId}/cars/${newCar.id}`);
  }

  if (loading) return <div className="loading">Loading…</div>;

  const totalLatestMonthCost = cars.reduce((sum, c) => sum + (c.latest_month?.total_cost || 0), 0);
  const totalYtdCost = cars.reduce((sum, c) => sum + (c.ytd_total_cost || 0), 0);
  const totalKmThisMonth = cars.reduce((sum, c) => sum + (c.latest_month?.km_driven || 0), 0);

  return (
    <div>
      {error && <div className="alert alert-error" style={{ marginBottom: 'var(--space-4)' }}>{error}</div>}

      <div className="section-header" style={{ marginBottom: 'var(--space-5)' }}>
        <h2 style={{ margin: 0 }}>Car Expenses</h2>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          <FontAwesomeIcon icon={faPlus} style={{ marginRight: '0.4rem' }} />New car
        </button>
      </div>

      {cars.length > 0 && (
        <KpiStrip defaultOpen style={{ marginBottom: 'var(--space-5)' }} items={[
          { label: 'Latest month total', value: formatEur(totalLatestMonthCost), large: true },
          { label: 'Cost this year', value: formatEur(totalYtdCost) },
          { label: 'Cars', value: String(cars.length) },
          { label: 'Km this month', value: formatKm(totalKmThisMonth) },
        ]} />
      )}

      {cars.length === 0 ? (
        <div className="empty-state">
          <p>No cars yet. Add one to start tracking what it costs you each month.</p>
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            New car
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {cars.map((car) => (
            <div
              key={car.id}
              className="card card--clickable"
              style={{ padding: 'var(--space-4)' }}
              onClick={() => navigate(`/dossiers/${dossierId}/cars/${car.id}`)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-3)', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600, fontSize: 15 }}>{car.name}</span>
                {(car.make || car.model) && (
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {[car.make, car.model].filter(Boolean).join(' ')}
                  </span>
                )}
                <Badge variant="neutral">
                  <FontAwesomeIcon icon={FUEL_ICONS[car.fuel_type]} style={{ marginRight: '0.3rem', fontSize: 10 }} />
                  {FUEL_LABELS[car.fuel_type] || car.fuel_type}
                </Badge>
                {car.latest_month?.unknown_count > 0 && (
                  <span
                    title={`${car.latest_month.unknown_count} item(s) have no cycle data yet — this month's total is a floor`}
                  >
                    <Badge variant="warning">
                      <FontAwesomeIcon icon={faTriangleExclamation} style={{ marginRight: '0.3rem', fontSize: 9 }} />
                      {car.latest_month.unknown_count} pending
                    </Badge>
                  </span>
                )}
                <span style={{ flex: 1 }} />
                {car.license_plate && (
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{car.license_plate}</span>
                )}
              </div>

              <div style={{ display: 'flex', gap: 'var(--space-4)', fontSize: 12, color: 'var(--text-secondary)', flexWrap: 'nowrap', overflowX: 'auto', whiteSpace: 'nowrap' }}>
                <span className="tabular" style={{ flexShrink: 0 }}>
                  <strong style={{ color: 'var(--text-primary)' }}>{formatEur(car.latest_month?.total_cost)}</strong>
                  {car.latest_month ? '/mo' : ' — no snapshots yet'}
                </span>
                {car.latest_month && (
                  <span className="tabular" style={{ flexShrink: 0 }}>{formatKm(car.latest_month.km_driven)} driven</span>
                )}
                <span className="tabular" style={{ flexShrink: 0 }}>
                  Odometer: {formatKm(car.latest_snapshot?.mileage_km ?? car.initial_mileage_km)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <CarFormModal
          dossierId={dossierId}
          car={null}
          onSave={handleCarCreated}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
