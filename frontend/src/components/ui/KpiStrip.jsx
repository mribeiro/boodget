import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
import KpiBlock from './KpiBlock';

export default function KpiStrip({ items, style, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const visible = (items || []).filter(Boolean);
  const primary = visible.find((i) => i.large) || visible[0];

  const color = (h) =>
    h === 'success' ? 'var(--color-success)' :
    h === 'danger'  ? 'var(--color-danger)'  :
    h === 'warning' ? 'var(--color-warning)'  :
    'var(--text-primary)';

  return (
    <div style={style}>
      {/* Desktop: card grid */}
      <div className="cycle-kpi-row kpi-strip--desktop">
        {visible.map((item, i) => <KpiBlock key={i} {...item} />)}
      </div>

      {/* Mobile: collapsible — styled identically to CollapsibleSection */}
      <div className="kpi-strip--mobile" style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
      }}>
        <button
          onClick={() => setOpen((v) => !v)}
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
            borderBottom: open ? '1px solid var(--border-default)' : 'none',
            transition: 'border-bottom-color 0.25s',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {primary?.icon && (
              <FontAwesomeIcon icon={primary.icon} style={{ fontSize: 13, color: 'var(--text-muted)' }} />
            )}
            <span style={{ fontSize: 14, fontWeight: 700 }}>{primary?.label}</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: color(primary?.highlight) }}>
              {primary?.value}
            </span>
            <span style={{
              fontSize: 11, fontWeight: 700,
              color: 'var(--text-muted)',
              background: 'var(--bg-surface)',
              padding: '2px 7px', borderRadius: 8,
            }}>{visible.length}</span>
          </div>
          <FontAwesomeIcon
            icon={faChevronDown}
            style={{
              fontSize: 12,
              color: 'var(--text-muted)',
              transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
              transition: 'transform 0.25s cubic-bezier(.4,0,.2,1)',
            }}
          />
        </button>

        {/* Same grid animation as CollapsibleSection */}
        <div style={{
          display: 'grid',
          gridTemplateRows: open ? '1fr' : '0fr',
          transition: 'grid-template-rows 0.25s cubic-bezier(.4,0,.2,1)',
        }}>
          <div style={{ overflow: 'hidden' }}>
            {visible.map((item, i) => (
              <div key={i} className="kpi-strip-row">
                <span className="kpi-strip-row-label">
                  {item.icon && <FontAwesomeIcon icon={item.icon} style={{ marginRight: 5 }} />}
                  {item.label}
                </span>
                <span className="kpi-strip-row-value" style={{ color: color(item.highlight) }}>
                  {item.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
