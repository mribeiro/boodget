/**
 * Card component
 * variant: '' | 'flat' | 'clickable'
 * accentColor: CSS color string for left accent border (enables card--accent-left)
 */
export default function Card({
  variant = '',
  accentColor,
  children,
  className = '',
  style,
  ...props
}) {
  const classes = [
    'card',
    variant ? `card--${variant}` : '',
    accentColor ? 'card--accent-left' : '',
    className,
  ].filter(Boolean).join(' ');

  const inlineStyle = {
    ...(accentColor ? { borderLeftColor: accentColor } : {}),
    ...style,
  };

  return (
    <div className={classes} style={Object.keys(inlineStyle).length ? inlineStyle : undefined} {...props}>
      {children}
    </div>
  );
}
