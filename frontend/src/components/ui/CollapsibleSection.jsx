import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronDown, faChevronRight } from '@fortawesome/free-solid-svg-icons';

/**
 * CollapsibleShell — internal primitive shared by CollapsibleSection and
 * SettingsCard. Owns the button/aria-expanded/chevron/body-animation
 * mechanics; everything level-specific (container look, header markup,
 * body padding) is left to the caller.
 *
 * Props:
 *   containerClassName — class(es) for the outer wrapper
 *   containerStyle      — optional inline style for the outer wrapper
 *   headerClassName     — class for the header button (level-specific styling)
 *   open                — boolean
 *   onToggle            — () => void
 *   header              — header content (rendered before the chevron)
 *   children            — expanded body content
 */
export function CollapsibleShell({
  containerClassName, containerStyle, headerClassName, open, onToggle, header, children,
}) {
  return (
    <div className={containerClassName} style={containerStyle}>
      <button
        type="button"
        className={`${headerClassName}${open ? ' open' : ''}`}
        aria-expanded={open}
        onClick={onToggle}
      >
        {header}
        <FontAwesomeIcon icon={open ? faChevronDown : faChevronRight} className="collapsible-chevron" />
      </button>
      <div className={`collapsible-body${open ? ' open' : ''}`}>
        <div>{children}</div>
      </div>
    </div>
  );
}

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
    <CollapsibleShell
      containerClassName="collapsible-section"
      headerClassName="collapsible-section-header"
      open={!collapsed}
      onToggle={onToggle}
      header={(
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
      )}
    >
      <div className={noPad ? undefined : 'collapsible-section__body'}>{children}</div>
    </CollapsibleShell>
  );
}
