import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faArrowLeft, faPencil, faTrash, faPlus, faTriangleExclamation,
  faGasPump, faBolt, faCarBattery, faReceipt, faCalendarDays, faTable,
  faChevronDown, faChevronRight,
} from '@fortawesome/free-solid-svg-icons';
import { api } from '../../services/api';
import { formatNumber } from '../../utils/numbers';
import CarFormModal from './CarFormModal';
import CarMonthFormModal from './CarMonthFormModal';
import ConfirmModal from '../ConfirmModal';
import CollapsibleSection from '../ui/CollapsibleSection';
import Badge from '../ui/Badge';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const FUEL_LABELS = { electric: 'Electric', hybrid: 'Hybrid', gas: 'Gas' };
const FUEL_ICONS = { electric: faBolt, hybrid: faCarBattery, gas: faGasPump };

function formatEur(value) {
  if (value == null || isNaN(value)) return '—';
  return formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function formatKm(value) {
  if (value == null) return '—';
  return formatNumber(value, { maximumFractionDigits: 0 }) + ' km';
}

function StatRow({ label, value, valueStyle }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.35rem 0', fontSize: 13.5 }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontWeight: 600, ...valueStyle }}>{value}</span>
    </div>
  );
}

function LineItemRow({ name, amount, status }) {
  const unknown = amount == null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.3rem 0', fontSize: 13 }}>
      <span style={{ color: 'var(--text-secondary)' }}>{name}</span>
      <span style={{ fontWeight: 600, color: unknown ? 'var(--text-muted)' : undefined }} title={unknown ? statusTitle(status) : undefined}>
        {unknown ? '—' : formatEur(amount)}
      </span>
    </div>
  );
}

function statusTitle(status) {
  if (status === 'no_cycle') return 'No cycle covers this month yet';
  if (status === 'no_cycle_item') return 'No matching item found in that cycle';
  return undefined;
}

export default function CarDetail() {
  const { id: dossierId, carId } = useParams();
  const navigate = useNavigate();

  const [car, setCar] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showEdit, setShowEdit] = useState(false);
  const [showSnapshotForm, setShowSnapshotForm] = useState(false);
  const [editingSnapshot, setEditingSnapshot] = useState(null);
  const [confirmState, setConfirmState] = useState(null);

  const [breakdownCollapsed, setBreakdownCollapsed] = useState(false);
  const [linkedCollapsed, setLinkedCollapsed] = useState(false);
  const [yearlyCollapsed, setYearlyCollapsed] = useState(false);
  const [snapshotsCollapsed, setSnapshotsCollapsed] = useState(false);
  const [expandedMonths, setExpandedMonths] = useState(new Set());

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dossierId, carId]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const c = await api.getCar(dossierId, carId);
      setCar(c);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function toggleMonth(id) {
    setExpandedMonths((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function handleDelete() {
    setConfirmState({
      title: 'Delete car',
      message: `Delete car "${car.name}"? This also deletes all its snapshots and unlinks any assigned expenses. This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: async () => {
        try {
          await api.deleteCar(dossierId, car.id);
          navigate(`/dossiers/${dossierId}`, { state: { tab: 'car-expenses' } });
        } catch (err) {
          setError(err.message);
        }
      },
    });
  }

  function handleDeleteSnapshot(snapshot) {
    setConfirmState({
      title: 'Delete snapshot',
      message: `Delete the ${MONTH_NAMES[snapshot.month - 1]} ${snapshot.year} snapshot? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: async () => {
        try {
          await api.deleteCarMonth(dossierId, car.id, snapshot.id);
          await load();
        } catch (err) {
          setError(err.message);
        }
      },
    });
  }

  if (loading) return <div className="loading">Loading…</div>;
  if (error && !car) return <div className="alert alert-error">{error}</div>;
  if (!car) return null;

  const latest = car.months[0] ?? null;
  const hasLinkedItems = car.linked_monthly_items.length + car.linked_annual_items.length > 0;

  return (
    <div>
      <div className="page-header" style={{ marginBottom: 'var(--space-6)' }}>
        <button className="btn-ghost" onClick={() => navigate(`/dossiers/${dossierId}`, { state: { tab: 'car-expenses' } })}>
          <FontAwesomeIcon icon={faArrowLeft} />
        </button>
        <h1 style={{ flex: 1, margin: 0 }}>{car.name}</h1>
      </div>

      <div className="cycle-toolbar">
        <div className="cycle-toolbar-group" />
        <div className="cycle-toolbar-group">
          <button className="cycle-toolbar-btn btn-secondary" onClick={() => setShowEdit(true)}>
            <FontAwesomeIcon icon={faPencil} /><span className="cycle-toolbar-label">Edit</span>
          </button>
          <button className="cycle-toolbar-btn btn-danger" onClick={handleDelete}>
            <FontAwesomeIcon icon={faTrash} /><span className="cycle-toolbar-label">Delete</span>
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      {latest?.mileage_anomaly && (
        <div className="alert alert-warning" style={{ marginBottom: '1rem' }}>
          <FontAwesomeIcon icon={faTriangleExclamation} style={{ marginRight: '0.4rem' }} />
          The odometer reading for {MONTH_NAMES[latest.month - 1]} {latest.year} is lower than the previous one.
        </div>
      )}

      {!hasLinkedItems && (
        <div className="alert alert-warning" style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          <span style={{ flex: 1, minWidth: 220 }}>
            No expenses assigned to this car yet — its cost only reflects fuel/energy. Assign expenses from the Monthly
            or Annual Expenses tabs using the Car column.
          </span>
        </div>
      )}

      <div className="card card--flat" style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <Badge variant="neutral">
            <FontAwesomeIcon icon={FUEL_ICONS[car.fuel_type]} style={{ marginRight: '0.3rem', fontSize: 10 }} />
            {FUEL_LABELS[car.fuel_type] || car.fuel_type}
          </Badge>
          {(car.make || car.model || car.license_plate) && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {[car.make, car.model, car.license_plate].filter(Boolean).join(' · ')}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Odometer</div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{formatKm(latest?.mileage_km ?? car.initial_mileage_km)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Km this year</div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{formatKm(car.summary.ytd.km_driven)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Avg monthly (12m)</div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{formatEur(car.summary.avg_monthly_cost)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Cost this year</div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{formatEur(car.summary.ytd.total_cost)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Latest month cost</div>
            <div style={{ fontSize: 26, fontWeight: 700 }}>{formatEur(latest?.total_cost)}</div>
          </div>
        </div>
      </div>

      <div className="cycle-editor-columns">
        <div className="cycle-editor-left">
          <CollapsibleSection
            title={latest ? `Cost breakdown — ${MONTH_NAMES[latest.month - 1]} ${latest.year}` : 'Cost breakdown'}
            icon={faReceipt}
            accent="var(--color-brand)"
            collapsed={breakdownCollapsed}
            onToggle={() => setBreakdownCollapsed((v) => !v)}
          >
            {!latest ? (
              <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>No snapshots yet.</p>
            ) : (
              <>
                <div style={{ marginBottom: '0.5rem' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.03em', marginBottom: '0.2rem' }}>Energy</div>
                  {(car.fuel_type === 'gas' || car.fuel_type === 'hybrid') && (
                    <LineItemRow name="Fuel" amount={latest.fuel_cost} />
                  )}
                  {(car.fuel_type === 'electric' || car.fuel_type === 'hybrid') && (
                    <LineItemRow name="Electricity" amount={latest.electric_cost} />
                  )}
                </div>
                {latest.monthly_expenses.length > 0 && (
                  <div style={{ marginBottom: '0.5rem' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.03em', marginBottom: '0.2rem' }}>Monthly expenses</div>
                    {latest.monthly_expenses.map((item) => (
                      <LineItemRow key={item.template_item_id} name={item.name} amount={item.amount} status={item.status} />
                    ))}
                  </div>
                )}
                {latest.annual_expenses.length > 0 && (
                  <div style={{ marginBottom: '0.5rem' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.03em', marginBottom: '0.2rem' }}>Annual expenses</div>
                    {latest.annual_expenses.map((item) => (
                      <LineItemRow key={item.template_item_id} name={item.name} amount={item.amount} status={item.status} />
                    ))}
                  </div>
                )}
                <div style={{ borderTop: '1px solid var(--border-default)', marginTop: '0.5rem', paddingTop: '0.5rem' }}>
                  <StatRow label="Total" value={formatEur(latest.total_cost)} valueStyle={{ fontSize: 15 }} />
                </div>
                {latest.unknown_count > 0 && (
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: '0.4rem' }}>
                    {latest.unknown_count} item{latest.unknown_count === 1 ? '' : 's'} pending cycle data — counted as 0 in the total above.
                  </div>
                )}
              </>
            )}
          </CollapsibleSection>
        </div>

        <div className="cycle-editor-right">
          <CollapsibleSection
            title="Linked expenses"
            icon={faCalendarDays}
            accent="var(--text-muted)"
            collapsed={linkedCollapsed}
            onToggle={() => setLinkedCollapsed((v) => !v)}
          >
            {!hasLinkedItems ? (
              <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
                None yet. Assign a Fixed/Budget item or an annual expense to this car from their own tabs.
              </p>
            ) : (
              <>
                {car.linked_monthly_items.length > 0 && (
                  <div style={{ marginBottom: '0.5rem' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.03em', marginBottom: '0.2rem' }}>Monthly</div>
                    {car.linked_monthly_items.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => navigate(`/dossiers/${dossierId}`, { state: { tab: 'expenses' } })}
                        style={{ display: 'flex', justifyContent: 'space-between', width: '100%', padding: '0.3rem 0', fontSize: 13, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', textAlign: 'left' }}
                      >
                        <span>{item.name} <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>({item.type})</span></span>
                        <span style={{ fontWeight: 600 }}>{formatEur(item.value)}</span>
                      </button>
                    ))}
                  </div>
                )}
                {car.linked_annual_items.length > 0 && (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.03em', marginBottom: '0.2rem' }}>Annual</div>
                    {car.linked_annual_items.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => navigate(`/dossiers/${dossierId}`, { state: { tab: 'annual-expenses' } })}
                        style={{ display: 'flex', justifyContent: 'space-between', width: '100%', padding: '0.3rem 0', fontSize: 13, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', textAlign: 'left' }}
                      >
                        <span>{item.name}</span>
                        <span style={{ fontWeight: 600 }}>{formatEur(item.value)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </CollapsibleSection>

          <CollapsibleSection
            title="Yearly totals"
            icon={faTable}
            accent="var(--text-muted)"
            collapsed={yearlyCollapsed}
            onToggle={() => setYearlyCollapsed((v) => !v)}
          >
            {car.summary.per_year.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>No snapshots yet.</p>
            ) : (
              car.summary.per_year.map((y) => (
                <StatRow key={y.year} label={String(y.year)} value={formatEur(y.total_cost)} />
              ))
            )}
          </CollapsibleSection>
        </div>
      </div>

      <CollapsibleSection
        title="Monthly snapshots"
        icon={faCalendarDays}
        accent="var(--text-muted)"
        collapsed={snapshotsCollapsed}
        onToggle={() => setSnapshotsCollapsed((v) => !v)}
      >
        <div style={{ marginBottom: '0.75rem' }}>
          <button className="btn-secondary" onClick={() => { setEditingSnapshot(null); setShowSnapshotForm(true); }}>
            <FontAwesomeIcon icon={faPlus} style={{ marginRight: '0.4rem' }} />New snapshot
          </button>
        </div>

        {car.months.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>No snapshots yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 460 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.35rem 0', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.03em', borderBottom: '1px solid var(--border-default)' }}>
                <span style={{ width: 14 }} />
                <span style={{ flex: 1.4 }}>Month</span>
                <span style={{ flex: 1, textAlign: 'right' }}>Km</span>
                <span style={{ flex: 1, textAlign: 'right' }}>Energy</span>
                <span style={{ flex: 1, textAlign: 'right' }}>Total</span>
                <span style={{ flex: '0 0 70px' }} />
              </div>
              {car.months.map((m) => {
                const expanded = expandedMonths.has(m.id);
                return (
                  <div key={m.id} style={{ borderBottom: '1px solid var(--border-default)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.5rem 0', fontSize: 13.5 }}>
                      <FontAwesomeIcon
                        icon={expanded ? faChevronDown : faChevronRight}
                        style={{ fontSize: 11, color: 'var(--text-muted)', width: 14, cursor: 'pointer' }}
                        onClick={() => toggleMonth(m.id)}
                      />
                      <span style={{ flex: 1.4, minWidth: 0, fontWeight: 600, cursor: 'pointer' }} onClick={() => toggleMonth(m.id)}>
                        {MONTH_NAMES[m.month - 1]} {m.year}
                        {m.unknown_count > 0 && (
                          <FontAwesomeIcon icon={faTriangleExclamation} title="Some items are pending cycle data" style={{ marginLeft: 6, fontSize: 10, color: 'var(--color-warning)' }} />
                        )}
                      </span>
                      <span style={{ flex: 1, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatKm(m.km_driven)}</span>
                      <span style={{ flex: 1, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatEur(m.energy_cost)}</span>
                      <span style={{ flex: 1, textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{formatEur(m.total_cost)}</span>
                      <span style={{ flex: '0 0 70px', display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                        <button
                          type="button"
                          onClick={() => { setEditingSnapshot(m); setShowSnapshotForm(true); }}
                          title="Edit"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}
                        >
                          <FontAwesomeIcon icon={faPencil} style={{ fontSize: 12 }} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteSnapshot(m)}
                          title="Delete"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-danger-text)', padding: 2 }}
                        >
                          <FontAwesomeIcon icon={faTrash} style={{ fontSize: 12 }} />
                        </button>
                      </span>
                    </div>
                    {expanded && (
                      <div style={{ marginLeft: 22, paddingBottom: 8 }}>
                        <StatRow label="Odometer" value={formatKm(m.mileage_km)} />
                        <StatRow label="Baseline" value={`${formatKm(m.baseline_mileage_km)} (${m.baseline_source === 'car_initial' ? 'initial mileage' : 'previous snapshot'})`} />
                        {(car.fuel_type === 'gas' || car.fuel_type === 'hybrid') && <LineItemRow name="Fuel" amount={m.fuel_cost} />}
                        {(car.fuel_type === 'electric' || car.fuel_type === 'hybrid') && <LineItemRow name="Electricity" amount={m.electric_cost} />}
                        {m.monthly_expenses.map((item) => (
                          <LineItemRow key={item.template_item_id} name={item.name} amount={item.amount} status={item.status} />
                        ))}
                        {m.annual_expenses.map((item) => (
                          <LineItemRow key={item.template_item_id} name={item.name} amount={item.amount} status={item.status} />
                        ))}
                        {m.notes && (
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: '0.35rem', fontStyle: 'italic' }}>{m.notes}</div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CollapsibleSection>

      {showEdit && (
        <CarFormModal
          dossierId={dossierId}
          car={car}
          onSave={(updated) => { setCar((prev) => ({ ...prev, ...updated })); setShowEdit(false); load(); }}
          onClose={() => setShowEdit(false)}
        />
      )}
      {showSnapshotForm && (
        <CarMonthFormModal
          dossierId={dossierId}
          car={car}
          months={car.months}
          snapshot={editingSnapshot}
          onSave={() => { setShowSnapshotForm(false); setEditingSnapshot(null); load(); }}
          onClose={() => { setShowSnapshotForm(false); setEditingSnapshot(null); }}
        />
      )}
      {confirmState && <ConfirmModal {...confirmState} onCancel={() => setConfirmState(null)} />}
      <div className="cycle-toolbar-spacer" />
    </div>
  );
}
