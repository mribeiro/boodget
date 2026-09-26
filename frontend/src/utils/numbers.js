// A run of "." thousands groups: 1–3 leading digits (not starting with 0), then groups of exactly 3.
const DOT_GROUPED = /^[1-9]\d{0,2}(\.\d{3})+$/;

// Parses a money amount typed the way the app displays it ("1.234,56"): "," is the decimal
// separator and "." the thousands separator. A string with only "." is read as thousands when
// it is correctly grouped ("1.500", "12.000", "1.234.567") and as a decimal point otherwise
// ("12.5", "0.75", "1.5") — so plain dot-decimal input keeps working. Returns NaN when the
// string isn't a number in either reading ("1,2,3", "1.23,4").
// For rates, prices per unit and other values that routinely carry 3 decimals (a 3.125 % TAN,
// 1.759 €/l fuel), use parseRateInput instead.
export function parseDecimalInput(str) {
  if (str === '' || str == null) return NaN;
  let s = String(str).trim().replace(/\s+/g, '');
  let sign = '';
  if (s.startsWith('-')) {
    sign = '-';
    s = s.slice(1);
  }
  if (s.includes(',')) {
    const parts = s.split(',');
    if (parts.length !== 2) return NaN;
    let [intPart, fracPart] = parts;
    if (intPart.includes('.')) {
      if (!DOT_GROUPED.test(intPart)) return NaN;
      intPart = intPart.replace(/\./g, '');
    }
    if (!/^\d*$/.test(fracPart)) return NaN;
    return Number(`${sign}${intPart || '0'}.${fracPart || '0'}`);
  }
  if (DOT_GROUPED.test(s)) return Number(`${sign}${s.replace(/\./g, '')}`);
  return Number(`${sign}${s}`);
}

// Parses a plain decimal (rates, percentages, per-unit prices): "." or "," is the decimal
// separator and there is no thousands grouping, so "3.125" is 3.125, not 3125.
export function parseRateInput(str) {
  if (str === '' || str == null) return NaN;
  return Number(String(str).trim().replace(',', '.'));
}

// Formats a number with "." as the thousands separator and "," as the decimal
// separator (e.g. 1234.5 -> "1.234,50"), regardless of the browser's locale.
export function formatNumber(value, options) {
  const formatted = new Intl.NumberFormat('en-US', options).format(value);
  const dotIndex = formatted.lastIndexOf('.');
  if (dotIndex === -1) return formatted.replace(/,/g, '.');
  const intPart = formatted.slice(0, dotIndex).replace(/,/g, '.');
  const fracPart = formatted.slice(dotIndex + 1);
  return `${intPart},${fracPart}`;
}
