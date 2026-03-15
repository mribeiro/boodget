import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark } from '@fortawesome/free-solid-svg-icons';

export default function ConfirmModal({
  title = 'Confirm',
  message,
  confirmLabel = 'Confirm',
  danger = false,
  onConfirm,
  onCancel,
}) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="close-btn" onClick={onCancel}>
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>
        <div className="modal-body">
          <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{message}</p>
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button
            className={danger ? 'btn-danger' : 'btn-primary'}
            onClick={() => { onCancel(); onConfirm(); }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
