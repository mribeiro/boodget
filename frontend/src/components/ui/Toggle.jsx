/**
 * Custom toggle switch — same controlled/accessible pattern as Checkbox.jsx,
 * for boolean settings that read better as an on/off switch than a checkbox
 * (e.g. a per-row "can receive transfers" flag).
 *
 * Usage:
 *   <Toggle checked={value} onChange={handler} />
 */
export default function Toggle({ checked, onChange, title, style, disabled }) {
  return (
    <span
      className={`toggle-switch${checked ? ' checked' : ''}${disabled ? ' disabled' : ''}`}
      role="switch"
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      title={title}
      style={{ opacity: disabled ? 0.35 : 1, cursor: disabled ? 'default' : 'pointer', ...style }}
      onClick={disabled ? undefined : onChange}
      onKeyDown={disabled ? undefined : (e) => (e.key === ' ' || e.key === 'Enter') && (e.preventDefault(), onChange(e))}
    />
  );
}
