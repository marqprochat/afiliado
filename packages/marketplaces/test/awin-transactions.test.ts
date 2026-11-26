import { describe, it, expect, vi } from 'vitest';
import {
  formatAwinDate,
  listAwinTransactions,
  mapAwinTransaction,
  parseAwinWebhookBody,
} from '../src/awin/transactions';
import { AwinApiError } from '../src/awin/datafeed';
import fixture from '../src/awin/fixtures/transactions.json';

const NOW = new Date('2026-11-25T12:00:00Z');

describe('mapAwinTransaction', () => {
  it('formato aninhado da API (saleAmount/commissionAmount/clickRefs)', () => {
    const tx = mapAwinTransaction(fixture[0], { now: NOW });
    expect(tx).toMatchObject({
      externalId: '445566778',
      advertiserId: '9999',
      advertiserName: null,
      saleAmount: 250,
      commissionAmount: 12.5,
      currency: 'BRL',
      status: 'PENDING',
      validationDate: null,
      clickRef: 'afiliado1',
      clickRef2: 'wAbc12',
      clickRef3: 'cmbatch1',
      clickRef4: null,
    });
    expect(tx!.transactionDate.toISOString()).toBe('2026-11-20T15:00:00.000Z');
    expect(tx!.raw).toBe(fixture[0]);
  });

  it('formato achatado, valores em string e status em maiúsculas', () => {
    const tx = mapAwinTransaction(fixture[1], { now: NOW });
    expect(tx).toMatchObject({
      externalId: '445566779',
      advertiserId: '8888',
      advertiserName: 'Outra Loja',
      saleAmount: 73,
      commissionAmount: 7.3,
      status: 'APPROVED',
      clickRef: 'padrao20261120',
      clickRef2: 'tXyz98',
      clickRef3: null,
    });
    expect(tx!.validationDate!.toISOString()).toBe('2026-11-24T09:30:00.000Z');
  });

  it('variações do webhook: transactionId, commission/saleAmount numéricos, clickref minúsculo', () => {
    const tx = mapAwinTransaction(
      {
        transactionId: 77,
        merchantId: 5,
        commission: 3.2,
        saleAmount: 40,
        currency: 'EUR',
        status: 'declined',
        clickref: 'x',
        clickref2: 'wAbc12',
        transactionDate: '2026-11-21 08:00:00',
      },
      { now: NOW },
    );
    expect(tx).toMatchObject({
      externalId: '77',
      advertiserId: '5',
      commissionAmount: 3.2,
      saleAmount: 40,
      currency: 'EUR',
      status: 'DECLINED',
      clickRef: 'x',
      clickRef2: 'wAbc12',
    });
    expect(tx!.transactionDate.toISOString()).toBe('2026-11-21T08:00:00.000Z');
  });

  it('status desconhecido vira PENDING; sem data usa "agora"; sem id → null', () => {
    const tx = mapAwinTransaction(
      { id: 1, advertiserId: 2, commissionStatus: 'xpto' },
      { now: NOW },
    );
    expect(tx).toMatchObject({
      status: 'PENDING',
      saleAmount: 0,
      commissionAmount: 0,
      currency: 'BRL',
    });
    expect(tx!.transactionDate.toISOString()).toBe(NOW.toISOString());
    expect(mapAwinTransaction({ advertiserId: 2 })).toBeNull();
    expect(mapAwinTransaction(null)).toBeNull();
    expect(mapAwinTransaction('x')).toBeNull();
  });

  it('status "deleted"', () => {
    expect(mapAwinTransaction({ id: 9, commissionStatus: 'deleted' })!.status).toBe('DELETED');
  });
});

describe('parseAwinWebhookBody', () => {
  it('aceita objeto, lista e envelopes comuns', () => {
    expect(parseAwinWebhookBody(fixture[0], { now: NOW })).toHaveLength(1);
    expect(parseAwinWebhookBody(fixture, { now: NOW })).toHaveLength(2);
    expect(parseAwinWebhookBody({ transactions: fixture }, { now: NOW })).toHaveLength(2);
    expect(parseAwinWebhookBody({ transaction: fixture[1] }, { now: NOW })).toHaveLength(1);
    expect(parseAwinWebhookBody({ data: JSON.stringify(fixture[1]) }, { now: NOW })).toHaveLength(
      1,
    );
  });
  it('corpo sem transação válida → lista vazia', () => {
    expect(parseAwinWebhookBody({ foo: 'bar' })).toEqual([]);
    expect(parseAwinWebhookBody(null)).toEqual([]);
    expect(parseAwinWebhookBody('texto')).toEqual([]);
  });
});

describe('listAwinTransactions', () => {
  const creds = { publisherId: '12345', offersApiToken: 'tok-1' };

  it('monta URL (datas UTC, timezone, dateType) e manda Bearer', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(fixture), { status: 200 }));
    const out = await listAwinTransactions(
      creds,
      {
        startDate: new Date('2026-11-18T12:00:00Z'),
        endDate: new Date('2026-11-25T12:00:00Z'),
      },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(out).toHaveLength(2);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://api.awin.com/publishers/12345/transactions/');
    expect(u.searchParams.get('startDate')).toBe('2026-11-18T12:00:00');
    expect(u.searchParams.get('endDate')).toBe('2026-11-25T12:00:00');
    expect(u.searchParams.get('timezone')).toBe('UTC');
    expect(u.searchParams.get('dateType')).toBe('transaction');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-1');
  });

  it('401/403 → AwinApiError AWIN_UNAUTHORIZED', async () => {
    for (const status of [401, 403]) {
      const fetchImpl = vi.fn(async () => new Response('{}', { status }));
      const err = await listAwinTransactions(
        creds,
        { startDate: new Date('2026-11-18T00:00:00Z'), endDate: new Date('2026-11-25T00:00:00Z') },
        { fetchImpl: fetchImpl as unknown as typeof fetch },
      ).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AwinApiError);
      expect((err as AwinApiError).code).toBe('AWIN_UNAUTHORIZED');
    }
  });

  it('outros erros HTTP → AWIN_ERROR', async () => {
    const fetchImpl = vi.fn(async () => new Response('x', { status: 500 }));
    await expect(
      listAwinTransactions(
        creds,
        { startDate: new Date('2026-11-18T00:00:00Z'), endDate: new Date('2026-11-25T00:00:00Z') },
        { fetchImpl: fetchImpl as unknown as typeof fetch },
      ),
    ).rejects.toMatchObject({ code: 'AWIN_ERROR' });
  });

  it('janela acima de 31 dias é recusada sem chamar a API', async () => {
    const fetchImpl = vi.fn();
    await expect(
      listAwinTransactions(
        creds,
        { startDate: new Date('2026-10-01T00:00:00Z'), endDate: new Date('2026-11-25T00:00:00Z') },
        { fetchImpl: fetchImpl as unknown as typeof fetch },
      ),
    ).rejects.toThrow(/31 dias/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('formatAwinDate usa UTC sem milissegundos', () => {
    expect(formatAwinDate(new Date('2026-01-02T03:04:05.678Z'))).toBe('2026-01-02T03:04:05');
  });
});
