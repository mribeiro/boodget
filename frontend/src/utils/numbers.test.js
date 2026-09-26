import { parseDecimalInput, parseRateInput, formatNumber } from './numbers';

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

  it('reads a correctly grouped dot as the thousands separator, the way amounts are displayed', () => {
    expect(parseDecimalInput('1.500')).toBe(1500);
    expect(parseDecimalInput('12.000')).toBe(12000);
    expect(parseDecimalInput('1.234.567')).toBe(1234567);
  });

  it('parses thousands dots together with a decimal comma', () => {
    expect(parseDecimalInput('1.500,50')).toBe(1500.5);
    expect(parseDecimalInput('1.234.567,8')).toBe(1234567.8);
    expect(parseDecimalInput('1500,50')).toBe(1500.5);
  });

  it('keeps reading a dot as a decimal point when it is not a thousands grouping', () => {
    expect(parseDecimalInput('12.5')).toBe(12.5);
    expect(parseDecimalInput('0.75')).toBe(0.75);
    expect(parseDecimalInput('0.500')).toBe(0.5);
    expect(parseDecimalInput('1500.50')).toBe(1500.5);
  });

  it('handles a sign, surrounding spaces and a trailing comma while typing', () => {
    expect(parseDecimalInput('-1.500,5')).toBe(-1500.5);
    expect(parseDecimalInput(' 1 500 ')).toBe(1500);
    expect(parseDecimalInput('1.500,')).toBe(1500);
  });

  it('rejects strings that are ambiguous or malformed', () => {
    expect(parseDecimalInput('1,2,3')).toBeNaN();
    expect(parseDecimalInput('1.23,4')).toBeNaN();
    expect(parseDecimalInput('1,234.5')).toBeNaN();
    expect(parseDecimalInput('abc')).toBeNaN();
  });
});

describe('parseRateInput', () => {
  it('reads a dot or comma as the decimal separator, never as thousands', () => {
    expect(parseRateInput('3.125')).toBe(3.125);
    expect(parseRateInput('1,759')).toBe(1.759);
    expect(parseRateInput('4')).toBe(4);
  });

  it('returns NaN for empty input', () => {
    expect(parseRateInput('')).toBeNaN();
    expect(parseRateInput(null)).toBeNaN();
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
