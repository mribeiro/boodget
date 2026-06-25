import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function formatEur(value) {
  if (value == null) return '-';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value) + ' €';
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-sm)',
      padding: '8px 12px',
      fontSize: 13,
      boxShadow: 'var(--shadow-lg)',
    }}>
      <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-primary)' }}>{label}</div>
      {payload.map((entry) => (
        <div key={entry.dataKey} style={{ color: entry.stroke }}>
          {entry.dataKey === 'total' ? 'Total: ' : entry.dataKey === 'idle' ? 'Idle: ' : 'Stocks: '}
          {formatEur(entry.value)}
        </div>
      ))}
    </div>
  );
}

export default function CapitalChart({ months }) {
  const data = [...months]
    .reverse()
    .filter((m) => m.filled && m.capital_total != null)
    .map((m) => ({
      label: `${MONTH_NAMES[m.month - 1]} ${m.year}`,
      total: m.capital_total,
      idle: m.idle_total ?? undefined,
      stocks: m.stocks_total ?? undefined,
    }));

  if (data.length < 1) return null;

  return (
    <div className="chart-container">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
        <h2 style={{ margin: 0 }}>Total Capital Evolution</h2>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
            axisLine={{ stroke: 'var(--border-default)' }}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(v) =>
              new Intl.NumberFormat('en-US', { notation: 'compact' }).format(v) + ' €'
            }
            tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
            axisLine={false}
            tickLine={false}
            width={80}
          />
          <Tooltip content={<CustomTooltip />} />
          <Line
            type="monotone"
            dataKey="total"
            stroke="var(--color-brand)"
            strokeWidth={2.5}
            dot={{ fill: 'var(--color-brand)', stroke: 'var(--bg-card)', strokeWidth: 2, r: 4 }}
            activeDot={{ r: 6 }}
          />
          <Line
            type="monotone"
            dataKey="idle"
            stroke="var(--color-success)"
            strokeWidth={2}
            dot={{ fill: 'var(--color-success)', stroke: 'var(--bg-card)', strokeWidth: 2, r: 3 }}
            activeDot={{ r: 5 }}
            connectNulls={false}
          />
          <Line
            type="monotone"
            dataKey="stocks"
            stroke="var(--color-warning)"
            strokeWidth={2}
            dot={{ fill: 'var(--color-warning)', stroke: 'var(--bg-card)', strokeWidth: 2, r: 3 }}
            activeDot={{ r: 5 }}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
