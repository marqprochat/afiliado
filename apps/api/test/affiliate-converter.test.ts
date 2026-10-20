import { describe, it, expect, vi } from 'vitest';
import { convertOfferText } from '../src/lib/affiliate-converter';
import * as dbModule from '@afilados/db';
import * as coreModule from '@afilados/core';

describe('convertOfferText', () => {
  it('converte links e detecta preço, cupom e título em mensagem de grupo', async () => {
    // Mock resolveShortLinks
    vi.spyOn(coreModule, 'resolveShortLinks').mockResolvedValue(
      new Map([['https://amzn.to/3xyz', 'https://www.amazon.com.br/dp/B08N5WRWNW']]),
    );

    // Mock resolveConnection para simular credenciais cadastradas
    vi.spyOn(dbModule, 'resolveConnection').mockImplementation(async (_tenantId, kind) => {
      if (kind === 'AMAZON') {
        const creds = JSON.stringify({ tag: 'minhatag-20' });
        return {
          row: {
            id: 'c1',
            tenantId: 't1',
            kind: 'AMAZON',
            encryptedCredentials: Buffer.from(creds) as unknown as string,
            status: 'OK',
            affiliateTag: null,
            subId: null,
            lastCheckedAt: null,
            lastError: null,
          },
          subId: null,
          isAffiliate: false,
        };
      }
      return null;
    });

    // Mock decryptJson
    vi.spyOn(dbModule, 'decryptJson').mockImplementation((buf: Buffer) => {
      return JSON.parse(buf.toString());
    });

    const text = `🔥 Fone Top Bluetooth
De R$ 299,00 por apenas R$ 189,90 no Pix
Cupom: FONE10
Acesse: https://amzn.to/3xyz`;

    const res = await convertOfferText('tenant-1', text);

    expect(res.ok).toBeUndefined(); // a rota envelopa com ok: true
    expect(res.detected.title).toBe('Fone Top Bluetooth');
    expect(res.detected.price).toBe(189.9);
    expect(res.detected.originalPrice).toBe(299.0);
    expect(res.detected.coupon).toBe('FONE10');
    expect(res.detected.links).toHaveLength(1);
    expect(res.detected.links[0]!.converted).toBe(true);
    expect(res.detected.links[0]!.affiliateUrl).toContain('tag=minhatag-20');
    expect(res.convertedText).toContain('tag=minhatag-20');
    expect(res.convertedText).not.toContain('https://amzn.to/3xyz');
  });

  it('informa erro amigável se marketplace não estiver configurado', async () => {
    vi.spyOn(coreModule, 'resolveShortLinks').mockResolvedValue(new Map());
    vi.spyOn(dbModule, 'resolveConnection').mockResolvedValue(null);

    const text = `Produto Shopee
R$ 50,00
https://shopee.com.br/product/123/456`;

    const res = await convertOfferText('tenant-1', text);

    expect(res.detected.links).toHaveLength(1);
    expect(res.detected.links[0]!.converted).toBe(false);
    expect(res.detected.links[0]!.error).toContain('credenciais não configuradas');
    expect(res.convertedText).toBe(text);
  });
});
