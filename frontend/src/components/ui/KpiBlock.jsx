import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

/**
 * KpiBlock — a metric card used in KPI strips across all screens.
 *
 * Props:
 *   label    — string label above the value
 *   value    — the main displayed value (string or node)
 *   icon     — optional FA icon object shown next to the label
 *   highlight — 'neutral' | 'success' | 'danger' | 'warning'
 *   large    — if true, the value text is larger and the block takes 2× flex space
 *   note     — small italic note below the value
 */
export default function KpiBlock({ label, value, icon, highlight = 'neutral', large = false, note }) {
  const color =
    highlight === 'success' ? 'var(--color-success)' :
    highlight === 'danger'  ? 'var(--color-danger)'  :
    highlight === 'warning' ? 'var(--color-warning)'  :
    'var(--text-primary)';

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius)',
      padding: '10px 14px',
      minWidth: 80,
      flex: large ? 2 : 1,
      gridColumn: large ? 'span 2' : undefined,
    }}>
      <div style={{
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '.08em',
        textTransform: 'uppercase',
        color: 'var(--text-muted)',
        marginBottom: 4,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
      }}>
        {icon && <FontAwesomeIcon icon={icon} style={{ fontSize: 9 }} />}
        {label}
      </div>
      <div style={{
        fontSize: large ? 16 : 14,
        fontWeight: 800,
        color,
        fontVariantNumeric: 'tabular-nums',
      }}>
        {value}
      </div>
      {note && (
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3, fontStyle: 'italic' }}>
          {note}
        </div>
      )}
    </div>
  );
}
