import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, forTenant, encryptJson } from '@afilados/db';
import { loadShopeeCredentials, loadTagCredentials, loadAwinCredentials } from '../src/lib/marketplaces';
import { createTenantWithUser, cleanupTenant } from './helpers';

let owner: Awaited<ReturnType<typeof createTenantWithUser>>;
let aff: Awaited<ReturnType<typeof createTenantWithUser>>;
beforeAll(async () => {
  owner = await createTenantWithUser('dono');
  aff = await createTenantWithUser('afiliado', owner.tenantId);
  await prisma.marketplaceConnection.create({
    data: { tenantId: owner.tenantId, kind: 'SHOPEE', status: 'OK',
      encryptedCredentials: encryptJson({ appId: 'root-app', secret: 's' }) },
  });
  await prisma.marketplaceConnection.create({
    data: { tenantId: owner.tenantId, kind: 'AMAZON',
      encryptedCredentials: encryptJson({ tag: 'dono-20', amazonApi: { clientId: 'c', clientSecret: 's' } }) },
  });
  await prisma.marketplaceConnection.create({
    data: { tenantId: owner.tenantId, kind: 'AWIN',
      encryptedCredentials: encryptJson({ feedListUrl: 'https://ui.awin.com/feedList/x', feedIds: ['f1'] }) },
  });
});
afterAll(async () => {
  await cleanupTenant(owner.tenantId);
});

describe('afiliado lê credenciais do pai', () => {
  it('Shopee', async () => {
    const r = await loadShopeeCredentials(forTenant(aff.tenantId));
    expect(r.creds.appId).toBe('root-app');
  });
  it('Amazon (tag + Creators API)', async () => {
    const c = await loadTagCredentials(forTenant(aff.tenantId), 'AMAZON');
    expect(c.tag).toBe('dono-20');
    expect(c.amazonApi?.clientId).toBe('c');
  });
  it('Awin', async () => {
    const c = await loadAwinCredentials(forTenant(aff.tenantId));
    expect(c.feedIds).toEqual(['f1']);
  });
  it('tenant raiz sem credencial continua com erro de configuração', async () => {
    const lonely = await createTenantWithUser('sem-credencial');
    try {
      await expect(loadShopeeCredentials(forTenant(lonely.tenantId))).rejects.toThrow(/Configure a API da Shopee/);
    } finally {
      await cleanupTenant(lonely.tenantId);
    }
  });
});
