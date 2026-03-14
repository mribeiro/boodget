/**
 * Button component
 * variant: 'primary' | 'secondary' | 'ghost' | 'danger'
 * size: 'sm' | 'md' | 'lg' | 'icon'
 */
export default function Button({
  variant = 'secondary',
  size = 'md',
  children,
  className = '',
  ...props
}) {
  const sizeClass = size === 'sm' ? 'btn-sm' : size === 'lg' ? 'btn-lg' : size === 'icon' ? 'btn-icon' : '';
  return (
    <button
      className={`btn-${variant} ${sizeClass} ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  );
}
