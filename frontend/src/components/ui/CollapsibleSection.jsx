import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronDown } from '@fortawesome/free-solid-svg-icons';

/**
 * CollapsibleSection — a card with a clickable header that expands/collapses.
 *
 * Props:
 *   title      — section heading
 *   icon       — FA icon object shown in the header
 *   accent     — CSS colour string for the left border + icon tint
 *   count      — optional item count badge
 *   collapsed  — boolean
 *   onToggle   — () => void
 *   children   — expanded content
 *   noPad      — if true, removes inner padding (caller controls padding)
 */
export default function CollapsibleSection({
  title, icon, accent, count, collapsed, onToggle, children, noPad = false,
}) {
  return (
    <div style={{
      background: 'var(--bg-card)',
      borderRadius: 'var(--radius)',
      border: '1px solid var(--border-default)',
      overflow: 'hidden',
      marginBottom: '1rem',
    }}>
      <button
        onClick={onToggle}
        style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '14px 16px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--text-primary)',
          borderBottom: collapsed ? 'none' : '1px solid var(--border-default)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {accent && <div style={{ width: 3, height: 16, borderRadius: 2, background: accent, flexShrink: 0 }} />}
          {icon && <FontAwesomeIcon icon={icon} style={{ fontSize: 13, color: accent || 'var(--text-muted)' }} />}
          <span style={{ fontSize: 14, fontWeight: 700 }}>{title}</span>
          {count != null && (
            <span style={{
              fontSize: 11, fontWeight: 700,
              color: accent || 'var(--text-muted)',
              background: accent ? `color-mix(in srgb, ${accent} 12%, transparent)` : 'var(--bg-surface)',
              padding: '2px 7px', borderRadius: 8,
            }}>{count}</span>
          )}
        </div>
        <FontAwesomeIcon
          icon={faChevronDown}
          style={{
            fontSize: 12,
            color: 'var(--text-muted)',
            transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
            transition: 'transform 0.3s ease',
          }}
        />
      </button>
      {!collapsed && (
        <div style={noPad ? {} : { padding: '14px 16px' }}>
          {children}
        </div>
      )}
    </div>
  );
}
