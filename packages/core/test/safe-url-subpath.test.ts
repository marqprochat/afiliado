import { describe, it, expect } from 'vitest';
import { assertPublicHttpUrl, isBlockedIp } from '../src/safe-url';

const publicLookup = async () => [{ address: '203.0.113.10', family: 4 }];

describe('safe-url (core)', () => {
  it('aceita host público e bloqueia privado/localhost', async () => {
    await expect(assertPublicHttpUrl('https://router.example.com/v1', publicLookup)).resolves.toBeInstanceOf(URL);
    await expect(assertPublicHttpUrl('http://localhost:20128/v1', publicLookup)).rejects.toThrow();
    await expect(assertPublicHttpUrl('http://10.0.0.5/v1', publicLookup)).rejects.toThrow();
    expect(isBlockedIp('127.0.0.1')).toBe(true);
    expect(isBlockedIp('203.0.113.10')).toBe(false);
  });
});
