import { describe, it, expect } from 'vitest';
import { assertPublicHttpUrl, isBlockedIp } from '../src/lib/safe-url';

const lookupTo =
  (...addresses: string[]) =>
  async () =>
    addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
const publicLookup = lookupTo('203.0.113.10');

describe('assertPublicHttpUrl', () => {
  it('aceita host público http e https', async () => {
    await expect(assertPublicHttpUrl('https://cdn.example.com/a.jpg', publicLookup)).resolves.toBeInstanceOf(URL);
    await expect(assertPublicHttpUrl('http://cdn.example.com/a.jpg', publicLookup)).resolves.toBeInstanceOf(URL);
  });

  it.each([
    'http://127.0.0.1/a.jpg',
    'http://10.0.0.5/a.jpg',
    'http://172.16.4.1/a.jpg',
    'http://192.168.1.1/a.jpg',
    'http://169.254.169.254/latest/meta-data',
    'http://0.0.0.0/a.jpg',
    'http://2130706433/a.jpg',
    'http://[::1]/a.jpg',
    'http://[fe80::1]/a.jpg',
    'http://[fd00::1]/a.jpg',
    'http://[::ffff:127.0.0.1]/a.jpg',
    'http://[::ffff:169.254.169.254]/a.jpg',
    'http://localhost/a.jpg',
    'http://foo.localhost/a.jpg',
    'http://db.internal/a.jpg',
    'http://0x7f.0.0.1/a.jpg',
    'http://0177.0.0.1/a.jpg',
    'http://127.1/a.jpg',
    'http://localhost./a.jpg',
    'http://[64:ff9b::7f00:1]/a.jpg',
    'http://[64:ff9b::127.0.0.1]/a.jpg',
    'http://[2002:7f00:1::]/a.jpg',
    'http://[::ffff:0:127.0.0.1]/a.jpg',
    'http://[fec0::1]/a.jpg',
    'http://198.18.0.1/a.jpg',
    'http://198.19.255.255/a.jpg',
    'http://192.0.0.8/a.jpg',
  ])('rejeita %s', async (url) => {
    await expect(assertPublicHttpUrl(url, publicLookup)).rejects.toThrow();
  });

  it('rejeita hostname que resolve para IP privado (mesmo com um IP público junto)', async () => {
    await expect(assertPublicHttpUrl('https://evil.example/a.jpg', lookupTo('10.1.2.3'))).rejects.toThrow(/privad|bloquead/i);
    await expect(
      assertPublicHttpUrl('https://evil.example/a.jpg', lookupTo('203.0.113.10', '127.0.0.1')),
    ).rejects.toThrow();
  });

  it('rejeita esquemas que não são http(s) e URL inválida', async () => {
    await expect(assertPublicHttpUrl('file:///etc/passwd', publicLookup)).rejects.toThrow();
    await expect(assertPublicHttpUrl('ftp://cdn.example.com/a.jpg', publicLookup)).rejects.toThrow();
    await expect(assertPublicHttpUrl('not a url', publicLookup)).rejects.toThrow();
  });

  it('rejeita quando o DNS não resolve', async () => {
    await expect(assertPublicHttpUrl('https://x.example/a.jpg', async () => [])).rejects.toThrow();
  });
});

describe('isBlockedIp', () => {
  it('classifica faixas', () => {
    expect(isBlockedIp('8.8.8.8')).toBe(false);
    expect(isBlockedIp('172.32.0.1')).toBe(false);
    expect(isBlockedIp('172.31.255.255')).toBe(true);
    expect(isBlockedIp('2606:4700::1111')).toBe(false);
    expect(isBlockedIp('::ffff:8.8.8.8')).toBe(false);
  });
});
