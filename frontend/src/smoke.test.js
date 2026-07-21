import { formatNumber } from './utils/numbers';

describe('smoke', () => {
  it('can import and run a real util from the source tree', () => {
    expect(formatNumber(1234.5, { minimumFractionDigits: 2 })).toBe('1.234,50');
  });
});
