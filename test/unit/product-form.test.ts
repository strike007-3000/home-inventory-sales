import { describe, expect, it } from 'vitest';
import { formatRupeesInput } from '../../src/components/ProductForm';

describe('product price input formatting', () => {
  it('omits unnecessary decimals and preserves real paise', () => {
    expect(formatRupeesInput(66000)).toBe('660');
    expect(formatRupeesInput(66050)).toBe('660.5');
    expect(formatRupeesInput(null)).toBe('');
  });
});
