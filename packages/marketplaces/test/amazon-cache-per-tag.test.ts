import { describe, expect, it, vi } from 'vitest';
import { createTagAdapter } from '../src/tag-adapter';

describe('cache do link oficial da Amazon', () => {
  it('não reaproveita o link de outra tag (mesma sessão, afiliados diferentes)', async () => {
    const gen = vi.fn(
      async (_u: string, _c: Record<string, string>, storeId: string) => `https://amzn.to/${storeId}`,
    );
    const a = createTagAdapter('AMAZON', { amazonOfficialLink: gen });
    const base = { amazonSession: { cookies: { a: '1' }, syncedAt: '2026-10-16T00:00:00Z' } };
    const url = 'https://www.amazon.com.br/dp/B0TESTCACHE';
    expect(await a.toAffiliateLink({ ...base, tag: 'joao-20' }, url)).toBe('https://amzn.to/joao-20');
    expect(await a.toAffiliateLink({ ...base, tag: 'maria-20' }, url)).toBe('https://amzn.to/maria-20');
    expect(gen).toHaveBeenCalledTimes(2);
  });
});
