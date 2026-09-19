import { describe, expect, it } from 'vitest';
import { calculateDiscountedPrice, formatRupeesInput } from '../../src/components/ProductForm';

describe('product price input formatting', () => {
  it('omits unnecessary decimals and preserves real paise', () => {
    expect(formatRupeesInput(66000)).toBe('660');
    expect(formatRupeesInput(66050)).toBe('660.5');
    expect(formatRupeesInput(null)).toBe('');
  });
});

describe('consultant price calculation', () => {
  it('defaults CP to 24% less than MRP without losing paise precision', () => {
    expect(calculateDiscountedPrice(100_00, 24)).toBe(76_00);
    expect(calculateDiscountedPrice(999_99, 24)).toBe(75_999);
    expect(calculateDiscountedPrice(null, 24)).toBeNull();
  });
});
