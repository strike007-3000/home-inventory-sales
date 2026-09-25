import { describe, expect, it } from 'vitest';
import { productIdentityKey } from '../../server/product-identity';

describe('product identity', () => {
  it('normalizes Unicode case, compatibility characters, and surrounding whitespace', () => {
    expect(productIdentityKey(' ÉCLAIR ', 'ＣＲÈＭＥ', null))
      .toBe(productIdentityKey('éclair', 'crème', ''));
  });

  it('keeps distinct names, colours, and sizes separate', () => {
    expect(productIdentityKey('Bowl', 'Blue', 'Small'))
      .not.toBe(productIdentityKey('Bowl', 'Blue', 'Large'));
  });
});
