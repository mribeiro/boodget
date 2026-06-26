import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSackDollar, faArrowTrendUp, faArrowTrendDown } from '@fortawesome/free-solid-svg-icons';
import { GlanceCard } from './CapitalGlance';

function formatEur(value) {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value) + ' €';
}

export default function StocksGlance({ months, onClick }) {
  const filledMonths = months.filter((m) => m.filled);
  const latest = filledMonths[0];
  const previous = filledMonths[1] ?? null;

  if (!latest || !latest.stocks_total || latest.stocks_total <= 0) return null;

  const variation =
    previous && previous.stocks_total != null && previous.stocks_total !== 0
      ? ((latest.stocks_total - previous.stocks_total) / Math.abs(previous.stocks_total)) * 100
      : null;

  const variationColor =
    variation == null ? 'var(--text-muted)' :
    variation > 0 ? 'var(--color-value-positive)' :
    variation < 0 ? 'var(--color-value-negative)' :
    'var(--text-muted)';

  const overall = (latest.capital_total ?? 0) + latest.stocks_total;
  const savingsPotential = (latest.capital_total ?? 0) - (latest.idle_total ?? 0) + latest.stocks_total;

  return (
    <GlanceCard title="Stocks" icon={faSackDollar} color="neutral" onClick={onClick}>
      <div className="text-2xl tabular" style={{ color: 'var(--text-primary)', marginBottom: 2 }}>
        {formatEur(latest.stocks_total)}
      </div>
      {variation != null && (
        <div className="text-sm" style={{ color: variationColor, marginBottom: 2 }}>
          <FontAwesomeIcon icon={variation > 0 ? faArrowTrendUp : faArrowTrendDown} style={{ marginRight: '0.3rem' }} />
          {variation > 0 ? '+' : ''}{variation.toFixed(1)}%
        </div>
      )}
      <div className="text-xs" style={{ marginTop: 4, paddingTop: 4, borderTop: '1px solid var(--border-default)', display: 'flex', flexDirection: 'column', gap: 2, color: 'var(--text-muted)' }}>
        <span className="tabular">{formatEur(overall)} overall</span>
        <span className="tabular">{formatEur(savingsPotential)} savings potential</span>
      </div>
    </GlanceCard>
  );
}
