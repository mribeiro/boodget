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
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: '6px',
        padding: '0.6rem 0.9rem',
        fontSize: '0.875rem',
        boxShadow: 'var(--shadow-md)',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>{label}</div>
      {payload.map((entry) => (
        <div key={entry.dataKey} style={{ color: entry.stroke }}>
          {entry.dataKey === 'total' ? 'Total: ' : 'Idle: '}
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
    }));

  if (data.length < 1) return null;

  return (
    <div className="chart-container">
      <h2>Capital Evolution</h2>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }}
            axisLine={{ stroke: 'var(--color-border)' }}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(v) =>
              new Intl.NumberFormat('en-US', { notation: 'compact' }).format(v) + ' €'
            }
            tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }}
            axisLine={false}
            tickLine={false}
            width={80}
          />
          <Tooltip content={<CustomTooltip />} />
          <Line
            type="monotone"
            dataKey="total"
            stroke="var(--color-primary)"
            strokeWidth={2.5}
            dot={{ fill: 'var(--color-primary)', r: 4 }}
            activeDot={{ r: 6 }}
          />
          <Line
            type="monotone"
            dataKey="idle"
            stroke="#22c55e"
            strokeWidth={2.5}
            dot={{ fill: '#22c55e', r: 4 }}
            activeDot={{ r: 6 }}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
