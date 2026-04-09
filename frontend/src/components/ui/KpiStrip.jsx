import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
import KpiBlock from './KpiBlock';

/**
 * KpiStrip — adaptive KPI display.
 * - Desktop (>640px): horizontal row of KpiBlock cards.
 * - Mobile (≤640px): collapsible list (one row per KPI).
 *
 * Props:
 *   items   — array of KpiBlock props objects (null/undefined entries are filtered out)
 *   style   — optional wrapper style
 */
export default function KpiStrip({ items, style }) {
  const [open, setOpen] = useState(false);
  const visible = (items || []).filter(Boolean);
  const primary = visible.find((i) => i.large) || visible[0];

  const color = (h) =>
    h === 'success' ? 'var(--color-success)' :
    h === 'danger'  ? 'var(--color-danger)'  :
    h === 'warning' ? 'var(--color-warning)'  :
    'var(--text-primary)';

  return (
    <div style={style}>
      {/* Desktop */}
      <div className="cycle-kpi-row kpi-strip--desktop">
        {visible.map((item, i) => <KpiBlock key={i} {...item} />)}
      </div>

      {/* Mobile */}
      <div className="kpi-strip--mobile">
        <button className="kpi-strip-toggle" onClick={() => setOpen((v) => !v)}>
          <div>
            <span className="kpi-strip-toggle-label">{primary?.label}</span>
            <span className="kpi-strip-toggle-value" style={{ color: color(primary?.highlight) }}>
              {primary?.value}
            </span>
          </div>
          <FontAwesomeIcon
            icon={faChevronDown}
            style={{ color: 'var(--text-muted)', fontSize: 13, transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : 'none' }}
          />
        </button>
        <div
          className="kpi-strip-list"
          style={{
            maxHeight: open ? `${visible.length * 52}px` : 0,
            overflow: 'hidden',
            transition: 'max-height 0.28s cubic-bezier(.4,0,.2,1)',
            borderTop: open ? undefined : 'none',
          }}
        >
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
  );
}
