/**
 * Badge component
 * variant: 'success' | 'warning' | 'danger' | 'brand' | 'neutral' | 'dark'
 */
export default function Badge({ variant = 'neutral', children, style }) {
  return (
    <span className={`badge badge-${variant}`} style={style}>
      {children}
    </span>
  );
}
