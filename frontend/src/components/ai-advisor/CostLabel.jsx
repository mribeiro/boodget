import { formatNumber } from '../../utils/numbers';

// Small "how much did this cost" label shown under every AI response.
// Costs are estimates in USD (Anthropic bills in USD regardless of dossier currency).
export default function CostLabel({ costUsd, inputTokens, outputTokens, style }) {
  if (costUsd == null) return null;
  const tokens =
    inputTokens != null && outputTokens != null
      ? ` · ${formatNumber(inputTokens, { maximumFractionDigits: 0 })} in / ${formatNumber(outputTokens, { maximumFractionDigits: 0 })} out tokens`
      : '';
  return (
    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', ...style }}>
      ~$ {formatNumber(costUsd, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}{tokens}
    </span>
  );
}
