import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronDown, faChevronRight } from '@fortawesome/free-solid-svg-icons';

/**
 * CollapsibleSection — a card with a clickable header that expands/collapses.
 *
 * The sub-group level of the three collapsible headers (see SPECIFICATION_UI.md
 * §6.8): 14px/700, no fill, sitting inside a card rather than being one.
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
    <div className="collapsible-section">
      <button
        type="button"
        className={`collapsible-section-header${collapsed ? '' : ' open'}`}
        aria-expanded={!collapsed}
        onClick={onToggle}
      >
        <span className="collapsible-section-header__title">
          {accent && <span className="collapsible-section-header__accent" style={{ background: accent }} />}
          {icon && <FontAwesomeIcon icon={icon} style={{ fontSize: 13, color: accent || 'var(--text-muted)' }} />}
          <span>{title}</span>
          {count != null && (
            <span
              className="collapsible-section-header__count"
              style={{
                color: accent || 'var(--text-muted)',
                background: accent ? `color-mix(in srgb, ${accent} 12%, transparent)` : 'var(--bg-surface)',
              }}
            >
              {count}
            </span>
          )}
        </span>
        <FontAwesomeIcon icon={collapsed ? faChevronRight : faChevronDown} className="collapsible-chevron" />
      </button>
      <div className={`collapsible-body${collapsed ? '' : ' open'}`}>
        <div>
          <div className={noPad ? undefined : 'collapsible-section__body'}>{children}</div>
        </div>
      </div>
    </div>
  );
}
