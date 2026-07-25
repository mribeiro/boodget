import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark } from '@fortawesome/free-solid-svg-icons';
import useModalDismiss from './useModalDismiss';

/**
 * Modal component
 * Props: title, onClose, footer (ReactNode), children, style
 *
 * Escape-to-close, the focus trap and focus restoration come from
 * useModalDismiss; see SPECIFICATION_UI.md §6.5.
 */
export default function Modal({ title, onClose, footer, children, style }) {
  const dialogRef = useModalDismiss(onClose);
  const titleId = `modal-title-${String(title).replace(/\s+/g, '-').toLowerCase()}`;

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div
        className="modal"
        style={style}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id={titleId}>{title}</h2>
          {onClose && (
            <button type="button" className="close-btn" onClick={onClose} aria-label="Close">
              <FontAwesomeIcon icon={faXmark} />
            </button>
          )}
        </div>
        <div className="modal-body">
          {children}
        </div>
        {footer && (
          <div className="modal-footer">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
