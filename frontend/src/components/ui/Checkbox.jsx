import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

/**
 * Custom checkbox — mobile-friendly, dark-mode-aware, fully controlled.
 *
 * Usage:
 *   <Checkbox checked={value} onChange={handler} />
 *   <Checkbox checked={value} onChange={handler} label="Enable feature" />
 */
export default function Checkbox({ checked, onChange, label, title, style, labelStyle, disabled }) {
  return (
    <span
      className={`checkbox-custom${checked ? ' checked' : ''}${disabled ? ' disabled' : ''}`}
      role="checkbox"
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      title={title}
      style={{ opacity: disabled ? 0.35 : 1, cursor: disabled ? 'default' : 'pointer', ...style }}
      onClick={disabled ? undefined : onChange}
      onKeyDown={disabled ? undefined : (e) => (e.key === ' ' || e.key === 'Enter') && onChange(e)}
    >
      {checked && <FontAwesomeIcon icon="check" style={{ fontSize: 10 }} />}
      {label && (
        <span className="checkbox-custom__label" style={labelStyle}>{label}</span>
      )}
    </span>
  );
}
