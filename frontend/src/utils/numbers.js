// Parses a decimal string accepting both "." and "," as the decimal separator.
export function parseDecimalInput(str) {
  if (str === '' || str == null) return NaN;
  return Number(String(str).replace(',', '.'));
}
