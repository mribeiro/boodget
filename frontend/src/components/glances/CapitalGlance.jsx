const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function formatEur(value) {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value) + ' €';
}

export default function CapitalGlance({ months, settings, today, onClick }) {
  const todayDay = today.getDate();
  const todayYear = today.getFullYear();
  const todayMonth = today.getMonth() + 1;

  const filledMonths = months.filter((m) => m.filled);

  // Empty state
  if (filledMonths.length === 0) {
    return (
      <GlanceCard title="Capital" color="neutral" onClick={onClick}>
        <p style={msgStyle}>No records yet</p>
      </GlanceCard>
    );
  }

  // Check for current month's filled snapshot
  const currentMonthFilled = filledMonths.find(
    (m) => m.year === todayYear && m.month === todayMonth
  );

  const warningDay = settings.capital_snapshot_warning_day ?? 7;

  // Warning state: threshold reached but no filled snapshot for current month
  if (!currentMonthFilled && todayDay >= warningDay) {
    return (
      <GlanceCard title="Capital" color="amber" onClick={onClick}>
        <p style={msgStyle}>{MONTH_NAMES[todayMonth - 1]} snapshot not yet recorded</p>
      </GlanceCard>
    );
  }

  // Normal state: show most recent filled snapshot
  const latest = filledMonths[0]; // already sorted desc by DossierView
  const previous = filledMonths[1] ?? null;

  const variation =
    previous && previous.capital_total != null && latest.capital_total != null && previous.capital_total !== 0
      ? ((latest.capital_total - previous.capital_total) / Math.abs(previous.capital_total)) * 100
      : null;

  const variationColor =
    variation == null ? 'var(--color-text-muted)' : variation > 0 ? '#16a34a' : variation < 0 ? '#dc2626' : 'var(--color-text-muted)';

  return (
    <GlanceCard title="Capital" color="neutral" onClick={onClick}>
      <div style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.2rem' }}>
        {latest.capital_total != null ? formatEur(latest.capital_total) : '—'}
      </div>
      {variation != null && (
        <div style={{ fontSize: '0.8rem', color: variationColor, marginBottom: '0.15rem' }}>
          {variation > 0 ? '↑ +' : variation < 0 ? '↓ ' : ''}{variation.toFixed(1)}% vs. {MONTH_NAMES[(previous.month - 1)].slice(0, 3)}
        </div>
      )}
      {latest.idle_total != null && latest.idle_total > 0 && (
        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
          {formatEur(latest.idle_total)} in idle
        </div>
      )}
    </GlanceCard>
  );
}

function GlanceCard({ title, color, onClick, children }) {
  const borderColor =
    color === 'amber' ? '#f59e0b' : color === 'red' ? '#ef4444' : 'var(--color-border)';
  const bg =
    color === 'amber' ? '#fffbeb' : color === 'red' ? '#fef2f2' : 'var(--color-surface)';

  return (
    <div
      onClick={onClick}
      style={{
        flex: 1,
        minWidth: '160px',
        padding: '0.875rem 1rem',
        borderRadius: 'var(--radius)',
        border: `1px solid ${borderColor}`,
        background: bg,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'box-shadow 0.15s',
      }}
      onMouseEnter={(e) => { if (onClick) e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = ''; }}
    >
      <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-muted)', marginBottom: '0.4rem' }}>
        {title}
      </div>
      {children}
    </div>
  );
}

const msgStyle = { margin: 0, fontSize: '0.875rem', color: 'var(--color-text-muted)' };

export { GlanceCard };
