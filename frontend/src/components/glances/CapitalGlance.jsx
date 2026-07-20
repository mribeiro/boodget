import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTriangleExclamation, faChartLine, faArrowTrendUp, faArrowTrendDown } from '@fortawesome/free-solid-svg-icons';
import Modal from '../ui/Modal';
import { formatNumber } from '../../utils/numbers';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function formatEur(value) {
  return formatNumber(value, { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' €';
}

// Computes a variation between two totals, distinguishing "no previous
// snapshot" (null) from "previous snapshot was exactly 0" — a 0 → non-zero
// swing is a meaningful event (e.g. first real capital after starting from
// scratch) but has no meaningful percentage, so it's flagged qualitatively
// as "new" instead of being treated the same as "no data".
function computeVariation(current, previous) {
  if (current == null || previous == null) return null;
  if (previous === 0) {
    return current === 0 ? null : { isNew: true, direction: current > 0 ? 1 : -1 };
  }
  return { isNew: false, value: ((current - previous) / Math.abs(previous)) * 100 };
}

function variationSign(variation) {
  return variation.isNew ? variation.direction : variation.value;
}

function variationLabel(variation) {
  return variation.isNew ? 'new' : `${variation.value > 0 ? '+' : ''}${variation.value.toFixed(1)}%`;
}

function colorForVariation(variation) {
  if (variation == null) return 'var(--text-muted)';
  const sign = variationSign(variation);
  return sign > 0 ? 'var(--color-value-positive)' : sign < 0 ? 'var(--color-value-negative)' : 'var(--text-muted)';
}

// Trend arrow/percentage shown next to a row's value. Hidden on mobile (CSS,
// `.glance-variation-badge`) — the narrower two-column card grid doesn't have
// room for it alongside the value; desktop/tablet shows it on all three rows.
function VariationBadge({ variation, color }) {
  if (variation == null) return null;
  return (
    <span className="glance-variation-badge text-xs" style={{ color, whiteSpace: 'nowrap' }}>
      <FontAwesomeIcon icon={variationSign(variation) > 0 ? faArrowTrendUp : faArrowTrendDown} style={{ marginRight: 2 }} />
      {variationLabel(variation)}
    </span>
  );
}

export function GlanceCard({ title, icon, color = 'neutral', onClick, children }) {
  const accentColor =
    color === 'amber' ? 'var(--color-warning)' :
    color === 'red'   ? 'var(--color-danger)'  :
    color === 'green' ? 'var(--color-success)'  :
    'var(--color-brand)';

  const bgStyle =
    color === 'amber' ? { background: 'var(--color-warning-light)' } :
    color === 'red'   ? { background: 'var(--color-danger-light)' }  :
    {};

  const showWarningIcon = color === 'amber' || color === 'red';

  return (
    <div
      className="glance-card card--accent-left"
      style={{ borderLeftColor: accentColor, cursor: onClick ? 'pointer' : 'default', ...bgStyle }}
      onClick={onClick}
    >
      <div className="glance-card-header">
        {icon && (
          <span className="glance-card-icon" style={{ color: accentColor, marginRight: '0.4rem', opacity: 0.75 }}>
            <FontAwesomeIcon icon={icon} />
          </span>
        )}
        <span className="glance-card-title">{title}</span>
        {showWarningIcon && (
          <span className="glance-card-icon" style={{ color: color === 'red' ? 'var(--color-danger)' : 'var(--color-warning)', marginLeft: 'auto' }}>
            <FontAwesomeIcon icon={faTriangleExclamation} />
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

export default function CapitalGlance({ months, settings, today, onClick }) {
  const [showModal, setShowModal] = useState(false);

  const todayDay = today.getDate();
  const todayYear = today.getFullYear();
  const todayMonth = today.getMonth() + 1;

  const filledMonths = months.filter((m) => m.filled);

  if (filledMonths.length === 0) {
    return (
      <GlanceCard title="Capital" icon={faChartLine} color="neutral" onClick={onClick}>
        <p style={msgStyle}>No records yet</p>
      </GlanceCard>
    );
  }

  const currentMonthFilled = filledMonths.find(
    (m) => m.year === todayYear && m.month === todayMonth
  );

  const warningDay = settings.capital_snapshot_warning_day ?? 7;

  if (!currentMonthFilled && todayDay >= warningDay) {
    return (
      <GlanceCard title="Capital" icon={faChartLine} color="amber" onClick={onClick}>
        <p style={msgStyle}>{MONTH_NAMES[todayMonth - 1]} snapshot not yet recorded</p>
      </GlanceCard>
    );
  }

  const latest = filledMonths[0];
  const previous = filledMonths[1] ?? null;

  const variation = computeVariation(latest.capital_total, previous?.capital_total);
  const variationColor = colorForVariation(variation);

  const idleVariation = computeVariation(latest.idle_total, previous?.idle_total);
  const idleVariationColor = colorForVariation(idleVariation);

  const showStocksBlock = latest.stocks_total != null && latest.stocks_total > 0;

  const stocksVariation = computeVariation(latest.stocks_total, previous?.stocks_total);
  const stocksVariationColor = colorForVariation(stocksVariation);

  const overall = (latest.capital_total ?? 0) + (latest.stocks_total ?? 0);
  const savingsPotential = (latest.idle_total ?? 0) + (latest.stocks_total ?? 0);

  const previousSavingsPotential = previous != null ? (previous.idle_total ?? 0) + (previous.stocks_total ?? 0) : null;
  const potentialVariation = computeVariation(savingsPotential, previousSavingsPotential);
  const potentialVariationColor = colorForVariation(potentialVariation);

  return (
    <>
      <GlanceCard title="Capital" icon={faChartLine} color="neutral" onClick={() => setShowModal(true)}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <span className="text-xs" style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>Total</span>
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <VariationBadge variation={variation} color={variationColor} />
            <span className="text-md tabular" style={{ color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
              {latest.capital_total != null ? formatEur(latest.capital_total) : '—'}
            </span>
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <span className="text-xs" style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>Savings</span>
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <VariationBadge variation={idleVariation} color={idleVariationColor} />
            <span className="text-sm tabular" style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{formatEur(latest.idle_total ?? 0)}</span>
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <span className="text-xs" style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>Potential</span>
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <VariationBadge variation={potentialVariation} color={potentialVariationColor} />
            <span className="text-sm tabular" style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{formatEur(savingsPotential)}</span>
          </span>
        </div>
      </GlanceCard>
      {showModal && (
        <Modal title="Capital" onClose={() => setShowModal(false)}>
          <div className="text-2xl tabular" style={{ color: 'var(--text-primary)', marginBottom: 2 }}>
            {latest.capital_total != null ? formatEur(latest.capital_total) : '—'}
          </div>
          {variation != null && (
            <div className="text-sm" style={{ color: variationColor, marginBottom: 2 }}>
              <FontAwesomeIcon icon={variationSign(variation) > 0 ? faArrowTrendUp : faArrowTrendDown} style={{ marginRight: '0.3rem' }} />
              {variationLabel(variation)} vs. {MONTH_NAMES[previous.month - 1].slice(0, 3)}
            </div>
          )}
          {latest.idle_total != null && latest.idle_total > 0 && (
            <div className="text-xs" style={{ marginTop: 4, paddingTop: 4, borderTop: '1px solid var(--border-default)', display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)' }}>
              <span className="tabular">{formatEur(latest.idle_total)} idle</span>
              {idleVariation != null && (
                <span style={{ color: idleVariationColor }}>
                  <FontAwesomeIcon icon={variationSign(idleVariation) > 0 ? faArrowTrendUp : faArrowTrendDown} style={{ marginRight: '0.2rem' }} />
                  {variationLabel(idleVariation)}
                </span>
              )}
            </div>
          )}
          {showStocksBlock && (
            <div className="text-xs" style={{ marginTop: 4, paddingTop: 4, borderTop: '1px solid var(--border-default)', display: 'flex', flexDirection: 'column', gap: 2, color: 'var(--text-muted)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="tabular">{formatEur(latest.stocks_total)} stocks</span>
                {stocksVariation != null && (
                  <span style={{ color: stocksVariationColor }}>
                    <FontAwesomeIcon icon={variationSign(stocksVariation) > 0 ? faArrowTrendUp : faArrowTrendDown} style={{ marginRight: '0.2rem' }} />
                    {variationLabel(stocksVariation)}
                  </span>
                )}
              </div>
              <span className="tabular">{formatEur(overall)} overall · {formatEur(savingsPotential)} savings potential</span>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}

const msgStyle = { margin: 0, fontSize: 13, color: 'var(--text-muted)' };
