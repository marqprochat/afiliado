import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// O servidor TEM o app do ML configurado: o afiliado, mesmo assim, não deve ver isso.
vi.hoisted(() => {
  process.env.ML_CLIENT_ID = 'ml-client-id';
  process.env.ML_CLIENT_SECRET = 'ml-client-secret';
});

import { prisma, forTenant, encryptJson } from '@afilados/db';
import {
  publicAffiliateConnection,
  publicConnection,
  setAffiliateSubId,
} from '../src/lib/marketplaces';
import { createTenantWithUser, cleanupTenant } from './helpers';

let owner: Awaited<ReturnType<typeof createTenantWithUser>>;
let aff: Awaited<ReturnType<typeof createTenantWithUser>>;
beforeAll(async () => {
  owner = await createTenantWithUser('dono');
  aff = await createTenantWithUser('afiliado', owner.tenantId);
});
afterAll(async () => {
  await cleanupTenant(owner.tenantId);
});

describe('publicAffiliateConnection', () => {
  it('mostra o status do dono e o subId do afiliado, sem credenciais nem lastError', async () => {
    const ownerRow = await prisma.marketplaceConnection.create({
      data: {
        tenantId: owner.tenantId,
        kind: 'MERCADOLIVRE',
        status: 'ERROR',
        lastError: 'token do dono expirou: segredo-interno',
        affiliateTag: 'tag-do-dono',
        encryptedCredentials: encryptJson({
          mattWord: 'matt-do-dono',
          appId: 'app-do-dono',
          secret: 'segredo-do-dono',
          mlApi: { refreshToken: 'r', connectedAt: '2026-01-01T00:00:00.000Z' },
        }),
      },
    });
    const ownRow = await prisma.marketplaceConnection.create({
      data: { tenantId: aff.tenantId, kind: 'MERCADOLIVRE', subId: 'joao' },
    });
    const view = publicAffiliateConnection(ownerRow, ownRow, 'MERCADOLIVRE');
    expect(view).toMatchObject({
      kind: 'MERCADOLIVRE',
      status: 'ERROR',
      subId: 'joao',
      lastError: null,
      mlApiAvailable: false,
      hasMlApi: false,
      hasSecret: false,
      appId: null,
      mattWord: null,
      affiliateTag: null,
    });
    expect(JSON.stringify(view)).not.toMatch(/segredo|matt-do-dono|app-do-dono|tag-do-dono/);
    // O contraste: o tenant raiz continua vendo que o servidor tem o app do ML.
    expect(publicConnection(ownerRow, 'MERCADOLIVRE').mlApiAvailable).toBe(true);
  });

  it('sem linhas: UNCONFIGURED e subId null', () => {
    expect(publicAffiliateConnection(null, null, 'SHOPEE')).toMatchObject({
      status: 'UNCONFIGURED',
      subId: null,
      lastError: null,
      mlApiAvailable: false,
    });
  });
});

describe('setAffiliateSubId', () => {
  const rows = () =>
    prisma.marketplaceConnection.findMany({ where: { tenantId: aff.tenantId, kind: 'SHOPEE' } });

  it('cria a linha, atualiza a mesma, e vazio limpa para null', async () => {
    const db = forTenant(aff.tenantId);
    await setAffiliateSubId(db, 'SHOPEE', ' joao ');
    expect((await rows()).map((r) => r.subId)).toEqual(['joao']);
    await setAffiliateSubId(db, 'SHOPEE', 'maria');
    expect((await rows()).map((r) => r.subId)).toEqual(['maria']);
    await setAffiliateSubId(db, 'SHOPEE', '   ');
    expect((await rows()).map((r) => r.subId)).toEqual([null]);
  });

  it('nunca grava na linha do dono', async () => {
    const before = await prisma.marketplaceConnection.findMany({
      where: { tenantId: owner.tenantId },
      orderBy: { kind: 'asc' },
    });
    await setAffiliateSubId(forTenant(aff.tenantId), 'AMAZON', 'tag-20');
    const after = await prisma.marketplaceConnection.findMany({
      where: { tenantId: owner.tenantId },
      orderBy: { kind: 'asc' },
    });
    expect(after).toEqual(before);
  });
});
