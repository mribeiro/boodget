import { useState, useRef, useEffect, useCallback } from 'react';

/**
 * Owns the state and dismiss timer for a <Toast>.
 *
 * Every consumer used to re-implement this by hand — the same useState +
 * useRef + setTimeout block copied across eight components, only one of which
 * cleared its timer on unmount (the rest could setState after unmounting).
 *
 * Usage:
 *   const { toast, showToast, showError } = useToast();
 *   showToast('Saved');
 *   showError(err.message);
 *   <Toast {...toast} />
 */
export default function useToast(duration = 2000) {
  const [toast, setToast] = useState({ message: '', variant: 'success', visible: false });
  const timer = useRef(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const showToast = useCallback((message, variant = 'success') => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ message, variant, visible: true });
    timer.current = setTimeout(() => setToast((t) => ({ ...t, visible: false })), duration);
  }, [duration]);

  const showError = useCallback((message) => showToast(message, 'error'), [showToast]);

  return { toast, showToast, showError };
}
