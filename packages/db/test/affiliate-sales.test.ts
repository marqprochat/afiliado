import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../src/client';
import { upsertAffiliateSale, type AffiliateSaleInput } from '../src/affiliate-sales';

let tenantId: string;
let groupId: string;

const base = (over: Partial<AffiliateSaleInput> = {}): AffiliateSaleInput => ({
  externalId: 'tx-1',
  advertiserId: '9999',
  advertiserName: 'Loja Exemplo',
  saleAmount: 200,
  commissionAmount: 12.5,
  currency: 'BRL',
  status: 'PENDING',
  transactionDate: new Date('2026-11-20T15:00:00Z'),
  validationDate: null,
  clickRef: 'afiliado1',
  clickRef2: 'wAbc12',
  clickRef3: 'batch123',
  clickRef4: null,
  clickRef5: null,
  clickRef6: null,
  raw: { id: 'tx-1' },
  ...over,
});

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: 'sales-db' } })).id;
  const session = await prisma.waSession.create({
    data: { tenantId, label: 's', status: 'CONNECTED' },
  });
  groupId = (
    await prisma.waGroup.create({
      data: {
        tenantId,
        sessionId: session.id,
        jid: 'g-sales@g.us',
        name: 'Grupo Ofertas',
        trackCode: 'wAbc12',
      },
    })
  ).id;
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe('upsertAffiliateSale', () => {
  it('cria a venda resolvendo o canal pelo clickRef2 e o lote pelo clickRef3', async () => {
    expect(await upsertAffiliateSale(tenantId, base(), 'WEBHOOK')).toBe('created');
    const sale = await prisma.affiliateSale.findFirstOrThrow({ where: { tenantId } });
    expect(sale).toMatchObject({
      network: 'AWIN',
      externalId: 'tx-1',
      channelKind: 'WHATSAPP',
      channelId: groupId,
      channelName: 'Grupo Ofertas',
      batchId: 'batch123',
      source: 'WEBHOOK',
      status: 'PENDING',
    });
    expect(Number(sale.commissionAmount)).toBe(12.5);
  });

  it('é idempotente: atualiza status/valores sem duplicar e mantém o canal', async () => {
    const r = await upsertAffiliateSale(
      tenantId,
      base({
        status: 'APPROVED',
        commissionAmount: 13,
        validationDate: new Date('2026-11-24T10:00:00Z'),
        clickRef2: null,
      }),
      'API',
    );
    expect(r).toBe('updated');
    const sales = await prisma.affiliateSale.findMany({ where: { tenantId } });
    expect(sales).toHaveLength(1);
    expect(sales[0]).toMatchObject({ status: 'APPROVED', source: 'API', channelId: groupId });
    expect(Number(sales[0]!.commissionAmount)).toBe(13);
    expect(sales[0]!.validationDate?.toISOString()).toBe('2026-11-24T10:00:00.000Z');
  });

  it('clickRef2 desconhecido → venda sem canal', async () => {
    await upsertAffiliateSale(tenantId, base({ externalId: 'tx-2', clickRef2: 'wNope1' }), 'API');
    const sale = await prisma.affiliateSale.findFirstOrThrow({
      where: { tenantId, externalId: 'tx-2' },
    });
    expect(sale.channelId).toBeNull();
    expect(sale.clickRef2).toBe('wNope1');
  });
});
