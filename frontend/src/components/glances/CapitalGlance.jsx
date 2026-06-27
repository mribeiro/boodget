import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTriangleExclamation, faChartLine, faArrowTrendUp, faArrowTrendDown, faSackDollar } from '@fortawesome/free-solid-svg-icons';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function formatEur(value) {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value) + ' €';
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

  const variation =
    previous && previous.capital_total != null && latest.capital_total != null && previous.capital_total !== 0
      ? ((latest.capital_total - previous.capital_total) / Math.abs(previous.capital_total)) * 100
      : null;

  const variationColor =
    variation == null ? 'var(--text-muted)' :
    variation > 0 ? 'var(--color-value-positive)' :
    variation < 0 ? 'var(--color-value-negative)' :
    'var(--text-muted)';

  const idleVariation =
    previous && previous.idle_total != null && latest.idle_total != null && previous.idle_total !== 0
      ? ((latest.idle_total - previous.idle_total) / Math.abs(previous.idle_total)) * 100
      : null;

  const idleVariationColor =
    idleVariation == null ? 'var(--text-muted)' :
    idleVariation > 0 ? 'var(--color-value-positive)' :
    idleVariation < 0 ? 'var(--color-value-negative)' :
    'var(--text-muted)';

  const showStocksBlock = latest.stocks_total != null && latest.stocks_total > 0;

  const stocksVariation =
    previous && previous.stocks_total != null && previous.stocks_total !== 0
      ? ((latest.stocks_total - previous.stocks_total) / Math.abs(previous.stocks_total)) * 100
      : null;

  const stocksVariationColor =
    stocksVariation == null ? 'var(--text-muted)' :
    stocksVariation > 0 ? 'var(--color-value-positive)' :
    stocksVariation < 0 ? 'var(--color-value-negative)' :
    'var(--text-muted)';

  const overall = (latest.capital_total ?? 0) + (latest.stocks_total ?? 0);
  const savingsPotential = (latest.idle_total ?? 0) + (latest.stocks_total ?? 0);

  return (
    <GlanceCard title="Capital" icon={faChartLine} color="neutral" onClick={onClick}>
      <div className="text-2xl tabular" style={{ color: 'var(--text-primary)', marginBottom: 2 }}>
        {latest.capital_total != null ? formatEur(latest.capital_total) : '—'}
      </div>
      {variation != null && (
        <div className="text-sm" style={{ color: variationColor, marginBottom: 2 }}>
          <FontAwesomeIcon icon={variation > 0 ? faArrowTrendUp : faArrowTrendDown} style={{ marginRight: '0.3rem' }} />
          {variation > 0 ? '+' : ''}{variation.toFixed(1)}% vs. {MONTH_NAMES[previous.month - 1].slice(0, 3)}
        </div>
      )}
      {latest.idle_total != null && latest.idle_total > 0 && (
        <div className="text-xs" style={{ marginTop: 4, paddingTop: 4, borderTop: '1px solid var(--border-default)', display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)' }}>
          <span className="tabular">{formatEur(latest.idle_total)} idle</span>
          {idleVariation != null && (
            <span style={{ color: idleVariationColor }}>
              <FontAwesomeIcon icon={idleVariation > 0 ? faArrowTrendUp : faArrowTrendDown} style={{ marginRight: '0.2rem' }} />
              {idleVariation > 0 ? '+' : ''}{idleVariation.toFixed(1)}%
            </span>
          )}
        </div>
      )}
      {showStocksBlock && (
        <div className="text-xs" style={{ marginTop: 4, paddingTop: 4, borderTop: '1px solid var(--border-default)', display: 'flex', flexDirection: 'column', gap: 2, color: 'var(--text-muted)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <FontAwesomeIcon icon={faSackDollar} style={{ opacity: 0.6 }} />
            <span className="tabular">{formatEur(latest.stocks_total)} stocks</span>
            {stocksVariation != null && (
              <span style={{ color: stocksVariationColor }}>
                <FontAwesomeIcon icon={stocksVariation > 0 ? faArrowTrendUp : faArrowTrendDown} style={{ marginRight: '0.2rem' }} />
                {stocksVariation > 0 ? '+' : ''}{stocksVariation.toFixed(1)}%
              </span>
            )}
          </div>
          <span className="tabular">{formatEur(overall)} overall</span>
          <span className="tabular">{formatEur(savingsPotential)} savings potential</span>
        </div>
      )}
    </GlanceCard>
  );
}

const msgStyle = { margin: 0, fontSize: 13, color: 'var(--text-muted)' };
