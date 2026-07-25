import { useEffect, useRef } from 'react';

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Dialog behaviour shared by Modal and ConfirmModal: Escape to dismiss, focus
 * moved into the dialog on open and restored on close, and Tab cycling kept
 * inside it.
 *
 * Both dialogs need this and ConfirmModal does not build on Modal, so it lives
 * in a hook rather than in either component.
 *
 * Returns a ref to attach to the dialog element.
 */
export default function useModalDismiss(onClose) {
  const ref = useRef(null);

  useEffect(() => {
    const node = ref.current;
    const previouslyFocused = document.activeElement;

    // Focus the first control, falling back to the dialog itself so screen
    // readers announce it rather than leaving focus behind on the page.
    const focusables = node ? node.querySelectorAll(FOCUSABLE) : [];
    (focusables[0] ?? node)?.focus?.();

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
        return;
      }
      if (e.key !== 'Tab' || !node) return;
      const items = [...node.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  return ref;
}
