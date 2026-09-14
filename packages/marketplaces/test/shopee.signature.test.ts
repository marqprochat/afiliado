import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { buildShopeeAuthHeader } from '../src/shopee/signature';

describe('buildShopeeAuthHeader', () => {
  it('monta header no formato da Open Platform', () => {
    const payload = '{"query":"{ x }"}';
    const ts = 1700000000;
    const expected = createHash('sha256').update(`app${ts}${payload}sec`).digest('hex');
    expect(buildShopeeAuthHeader('app', 'sec', payload, ts)).toBe(
      `SHA256 Credential=app, Timestamp=${ts}, Signature=${expected}`,
    );
  });
});
