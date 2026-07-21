import { parseDecimalInput, formatNumber } from './numbers';

describe('parseDecimalInput', () => {
  it('returns NaN for an empty string', () => {
    expect(parseDecimalInput('')).toBeNaN();
  });

  it('returns NaN for null', () => {
    expect(parseDecimalInput(null)).toBeNaN();
  });

  it('parses a comma-decimal value', () => {
    expect(parseDecimalInput('1,5')).toBe(1.5);
  });

  it('parses a dot-decimal value unchanged', () => {
    expect(parseDecimalInput('1.5')).toBe(1.5);
  });

  it('parses a plain integer string', () => {
    expect(parseDecimalInput('42')).toBe(42);
  });

  // Current behavior, not a target for fixing: only the *first* comma is replaced, so a
  // thousands-separated comma-decimal string like "1,234.5" does not parse as 1234.5 — the
  // comma becomes a second dot alongside the real decimal dot, and Number(...) on a
  // two-dot string is NaN.
  it('does not correctly parse a thousands-separator + decimal-dot string (documented as-is)', () => {
    expect(parseDecimalInput('1,234.5')).toBeNaN();
  });
});

describe('formatNumber', () => {
  it('swaps thousands dot and decimal comma for a value with both', () => {
    expect(formatNumber(1234.5, { minimumFractionDigits: 2 })).toBe('1.234,50');
  });

  it('uses only a comma decimal separator when there is no thousands grouping', () => {
    expect(formatNumber(42.5, { minimumFractionDigits: 2 })).toBe('42,50');
  });

  it('produces no comma at all for a value with no fractional part and no options', () => {
    expect(formatNumber(42)).toBe('42');
  });

  it('swaps a large integer thousands separator with no fractional part', () => {
    expect(formatNumber(1234)).toBe('1.234');
  });
});
