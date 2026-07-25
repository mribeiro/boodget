import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

/**
 * Custom checkbox — mobile-friendly, dark-mode-aware, fully controlled.
 *
 * Usage:
 *   <Checkbox checked={value} onChange={handler} />
 *   <Checkbox checked={value} onChange={handler} label="Enable feature" />
 *
 * Note: onChange receives the underlying DOM event (from onClick/onKeyDown), NOT a
 * boolean — it is always truthy. Compute the next checked value yourself from current
 * state, e.g. onChange={() => setChecked(!checked)}.
 *
 * When `label` is set the interactive element is an outer `.checkbox-field` wrapping
 * the 20px `.checkbox-custom` box plus the text, so the whole field is one tap target.
 * The label must NOT live inside `.checkbox-custom` — that box is pinned to 20px, so
 * text placed in it overflows and collides with whatever sits alongside.
 */
export default function Checkbox({ checked, onChange, label, title, style, labelStyle, disabled }) {
  const interaction = {
    role: 'checkbox',
    'aria-checked': checked,
    'aria-disabled': disabled || undefined,
    tabIndex: disabled ? -1 : 0,
    title,
    onClick: disabled ? undefined : onChange,
    onKeyDown: disabled ? undefined : (e) => (e.key === ' ' || e.key === 'Enter') && onChange(e),
  };
  const cursorStyle = { opacity: disabled ? 0.35 : 1, cursor: disabled ? 'default' : 'pointer' };
  const boxClass = `checkbox-custom${checked ? ' checked' : ''}${disabled ? ' disabled' : ''}`;
  const tick = checked && <FontAwesomeIcon icon="check" style={{ fontSize: 10 }} />;

  if (!label) {
    return (
      <span {...interaction} className={boxClass} style={{ ...cursorStyle, ...style }}>
        {tick}
      </span>
    );
  }

  return (
    <span
      {...interaction}
      className={`checkbox-field${disabled ? ' disabled' : ''}`}
      style={{ ...cursorStyle, ...style }}
    >
      <span className={boxClass} aria-hidden="true">{tick}</span>
      <span className="checkbox-custom__label" style={labelStyle}>{label}</span>
    </span>
  );
}
