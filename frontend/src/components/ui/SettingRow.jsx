import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPencil } from '@fortawesome/free-solid-svg-icons';

/**
 * One label/value row in a settings section.
 *
 * Implements the layout SPECIFICATION_UI.md §12.2 has always specified but which
 * nothing previously honoured: label left at 60%, control right at 40%, stacking
 * to label-above-full-width control below 768px. Every section used to hand-roll
 * the same `display:flex` + `flex:1` label object — ten byte-identical copies —
 * which is why value rendering, spacing and empty states had all drifted apart.
 *
 * Two shapes:
 *
 *   value + optional suffix, with a pencil that opens an editor
 *     <SettingRow label="Notify me" value={3} suffix="day(s) before" onEdit={open} />
 *
 *   an arbitrary control (select, inline input, …) via children
 *     <SettingRow label="Default model"><select …/></SettingRow>
 *
 * `value` of null/undefined/'' renders `emptyLabel` in the muted italic empty
 * treatment, so "not set" looks the same in every section.
 */
export default function SettingRow({
  label,
  value,
  suffix,
  emptyLabel = 'Not set',
  onEdit,
  editLabel,
  children,
}) {
  const isEmpty = value == null || value === '';
  return (
    <div className="setting-row">
      <span className="setting-row__label">{label}</span>
      <div className="setting-row__control">
        {children ?? (
          <>
            <span className={`setting-row__value${isEmpty ? ' setting-row__value--empty' : ''}`}>
              {isEmpty ? emptyLabel : value}
            </span>
            {suffix && <span className="setting-row__suffix">{suffix}</span>}
          </>
        )}
        {onEdit && (
          <button
            className="btn-secondary btn-icon"
            onClick={onEdit}
            aria-label={editLabel ?? `Edit ${label}`}
          >
            <FontAwesomeIcon icon={faPencil} />
          </button>
        )}
      </div>
    </div>
  );
}
