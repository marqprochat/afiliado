import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { prisma } from '@afilados/db';
import { buildApp } from '../src/app';
import { createTenantWithUser, cleanupTenant, loginCookie } from './helpers';

const app = await buildApp({ logger: false });

// Slugs do PriceEngine têm até 100 caracteres de título + sufixo "-xxxx" (105 no total).
const longSlug = `${'a'.repeat(100)}-niiy`;
let tenantId: string;
let cookie: string;

beforeAll(async () => {
  const t = await createTenantWithUser('Deals');
  tenantId = t.tenantId;
  cookie = await loginCookie(app, t.email, t.password);
  await prisma.masterProduct.create({
    data: {
      tenantId,
      title: 'Produto de título longo',
      cleanTitle: 'Produto de título longo',
      slug: longSlug,
      lowestPriceEver: 100,
      averagePrice30d: 100,
      currentBestPrice: 100,
    },
  });
});

afterAll(async () => {
  await cleanupTenant(tenantId);
  await app.close();
});

describe('GET /api/v1/deals/:slug', () => {
  it('abre o produto mesmo quando o slug passa de 100 caracteres', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/deals/${longSlug}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().slug).toBe(longSlug);
  });

  it('aceita criar alerta para produto com slug longo', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/deals/${longSlug}/alerts`,
      headers: { cookie },
      payload: { recipient: '5511999999999', targetPrice: 90 },
    });
    expect(res.statusCode).toBe(201);
  });
});
