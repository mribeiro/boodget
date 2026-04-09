import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

/**
 * Modal component
 * Props: title, onClose, footer (ReactNode), children
 */
export default function Modal({ title, onClose, footer, children, style }) {
  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="modal" style={style} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
          {onClose && (
            <button className="close-btn" onClick={onClose} aria-label="Close">
              <FontAwesomeIcon icon="xmark" />
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
