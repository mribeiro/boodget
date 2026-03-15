/**
 * Custom checkbox — mobile-friendly, dark-mode-aware, fully controlled.
 *
 * Usage:
 *   <Checkbox checked={value} onChange={handler} />
 *   <Checkbox checked={value} onChange={handler} label="Enable feature" />
 */
export default function Checkbox({ checked, onChange, label, title, style, labelStyle }) {
  return (
    <span
      className={`checkbox-custom${checked ? ' checked' : ''}`}
      role="checkbox"
      aria-checked={checked}
      tabIndex={0}
      title={title}
      style={style}
      onClick={onChange}
      onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && onChange(e)}
    >
      {checked && '✓'}
      {label && (
        <span className="checkbox-custom__label" style={labelStyle}>{label}</span>
      )}
    </span>
  );
}
