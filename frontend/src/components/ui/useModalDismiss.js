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

  // Held in a ref so the effect below can depend on nothing and run exactly
  // once per open. Callers pass an inline arrow, so a [onClose] dependency
  // re-runs the effect on *every* render of the parent — which means every
  // keystroke in a controlled modal input tore the effect down and set it up
  // again, and the setup moves focus to the first control. The symptom was
  // that only the first character you typed ever landed in the field.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Captured during the first render, deliberately not in the effect below.
  // React applies a child's `autoFocus` while committing the DOM, which is
  // *before* passive effects run — so by effect time the active element is
  // already the dialog's own input, and "restoring" it on close focused a
  // detached node, which drops focus to <body>. At first-render time the
  // dialog does not exist yet, so this is still the element that opened it.
  const previouslyFocusedRef = useRef(null);
  if (previouslyFocusedRef.current === null) {
    previouslyFocusedRef.current = document.activeElement;
  }

  useEffect(() => {
    const node = ref.current;
    const previouslyFocused = previouslyFocusedRef.current;

    // Prefer the first form field over the first focusable: the first focusable
    // is the header's close button, and focusing it would override the
    // `autoFocus` callers put on the field the user opened the dialog to edit.
    // Text-only dialogs (ConfirmModal) have no field and fall through to the
    // close button, then to the dialog itself so screen readers announce it
    // rather than leaving focus behind on the page.
    const focusables = node ? [...node.querySelectorAll(FOCUSABLE)] : [];
    const field = focusables.find((el) => /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName));
    (field ?? focusables[0] ?? node)?.focus?.();

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current?.();
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
      // isConnected guard: the trigger can legitimately be gone by now (e.g.
      // confirming a delete removes the row its button lived in), and focusing
      // a detached node silently drops focus to <body>.
      if (previouslyFocused?.isConnected) previouslyFocused.focus?.();
    };
  }, []);

  return ref;
}
