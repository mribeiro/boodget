import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPencil } from '@fortawesome/free-solid-svg-icons';
import { parseDecimalInput, formatNumber } from '../../utils/numbers';

function fmt(v) {
  return `${formatNumber(v ?? 0, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

// Amount shown on an annual-expense payment row. Unpaid: the per-installment estimate, read-only.
// Paid: the amount actually paid (the payment's real_value), editable inline so it can differ
// from the estimate — that's the figure every "paid" total is built from.
export default function PaidAmount({ payment, expectedValue, disabled, onSave }) {
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const numStyle = { fontSize: '0.875rem', fontWeight: 500, fontVariantNumeric: 'tabular-nums' };

  if (!payment?.paid) return <span style={numStyle}>{fmt(expectedValue)}</span>;

  const realValue = payment.real_value ?? expectedValue;
  const differs = Math.abs(realValue - expectedValue) > 0.005;

  async function commit() {
    if (draft === null || saving) return;
    const parsed = parseDecimalInput(draft);
    if (isNaN(parsed) || parsed < 0) {
      setError('Enter a non-negative amount');
      return;
    }
    if (Math.abs(parsed - realValue) < 0.005) {
      setDraft(null);
      return;
    }
    setSaving(true);
    try {
      await onSave(parsed);
      setDraft(null);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (draft !== null) {
    return (
      <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
        <input
          type="text"
          inputMode="decimal"
          autoFocus
          aria-label="Amount actually paid"
          value={draft}
          disabled={saving}
          onChange={(e) => { setDraft(e.target.value); setError(''); }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            if (e.key === 'Escape') { setDraft(null); setError(''); }
          }}
          style={{ width: 92, textAlign: 'right', padding: '0.25rem 0.4rem', fontSize: '0.875rem' }}
        />
        {error && <span style={{ fontSize: 11, color: 'var(--color-danger)' }}>{error}</span>}
      </span>
    );
  }

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end' }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setDraft(formatNumber(realValue, { maximumFractionDigits: 2 }))}
        title={disabled ? 'Amount paid' : 'Amount actually paid — click to edit'}
        style={{
          ...numStyle,
          background: 'none', border: 'none', padding: 0, color: 'inherit',
          cursor: disabled ? 'default' : 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
        }}
      >
        {fmt(realValue)}
        {!disabled && <FontAwesomeIcon icon={faPencil} style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }} />}
      </button>
      {differs && (
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>est. {fmt(expectedValue)}</span>
      )}
    </span>
  );
}
