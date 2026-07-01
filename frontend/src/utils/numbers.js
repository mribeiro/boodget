// Parses a decimal string accepting both "." and "," as the decimal separator.
export function parseDecimalInput(str) {
  if (str === '' || str == null) return NaN;
  return Number(String(str).replace(',', '.'));
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
