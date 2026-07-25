import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCircleCheck, faCircleExclamation } from '@fortawesome/free-solid-svg-icons';

const VARIANTS = {
  success: { icon: faCircleCheck, className: 'toast--success' },
  error: { icon: faCircleExclamation, className: 'toast--error' },
};

/**
 * Transient confirmation pill, bottom-right.
 *
 * Pair it with the useToast() hook, which owns the dismiss timer:
 *   const { toast, showToast, showError } = useToast();
 *   ...
 *   showToast('Saved');            // success
 *   showError('Could not save');   // error
 *   <Toast {...toast} />
 *
 * Renders nothing until a message has been shown at least once — the message is
 * deliberately retained while `visible` flips back to false so the exit
 * transition can play out.
 */
export default function Toast({ message, visible, variant = 'success' }) {
  if (!message) return null;
  const { icon, className } = VARIANTS[variant] ?? VARIANTS.success;
  return (
    <div
      className={`toast ${className}${visible ? ' toast--visible' : ''}`}
      role="status"
      aria-live="polite"
    >
      <FontAwesomeIcon icon={icon} style={{ fontSize: 14 }} />
      {message}
    </div>
  );
}
