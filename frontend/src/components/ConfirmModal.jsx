import Modal from './ui/Modal';

/**
 * Confirmation dialog for destructive actions. Used instead of window.confirm()
 * everywhere in the app.
 *
 * Built on <Modal> rather than re-implementing the overlay markup, so it inherits
 * Escape-to-close, the focus trap, dialog semantics, and the guarded backdrop
 * click (a drag starting inside the dialog and released on the backdrop no
 * longer dismisses it).
 */
export default function ConfirmModal({
  title = 'Confirm',
  message,
  confirmLabel = 'Confirm',
  danger = false,
  onConfirm,
  onCancel,
}) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      style={{ maxWidth: 440 }}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className={danger ? 'btn-danger' : 'btn-primary'}
            // Confirm first, then close — closing first unmounts this dialog
            // before the handler runs.
            onClick={() => { onConfirm?.(); onCancel?.(); }}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{message}</p>
    </Modal>
  );
}
