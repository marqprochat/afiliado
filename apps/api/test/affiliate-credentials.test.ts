import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, forTenant, encryptJson } from '@afilados/db';
import {
  loadShopeeCredentials,
  loadTagCredentials,
  loadAwinCredentials,
  loadAliexpressCredentials,
} from '../src/lib/marketplaces';
import { createTenantWithUser, cleanupTenant } from './helpers';

let owner: Awaited<ReturnType<typeof createTenantWithUser>>;
let aff: Awaited<ReturnType<typeof createTenantWithUser>>;
beforeAll(async () => {
  owner = await createTenantWithUser('dono');
  aff = await createTenantWithUser('afiliado', owner.tenantId);
  await prisma.marketplaceConnection.create({
    data: {
      tenantId: owner.tenantId,
      kind: 'SHOPEE',
      status: 'OK',
      encryptedCredentials: encryptJson({ appId: 'root-app', secret: 's' }),
    },
  });
  await prisma.marketplaceConnection.create({
    data: {
      tenantId: owner.tenantId,
      kind: 'AMAZON',
      encryptedCredentials: encryptJson({
        tag: 'dono-20',
        amazonApi: { clientId: 'c', clientSecret: 's' },
      }),
    },
  });
  await prisma.marketplaceConnection.create({
    data: {
      tenantId: owner.tenantId,
      kind: 'AWIN',
      encryptedCredentials: encryptJson({
        feedListUrl: 'https://ui.awin.com/feedList/x',
        feedIds: ['f1'],
      }),
    },
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
      await expect(loadShopeeCredentials(forTenant(lonely.tenantId))).rejects.toThrow(
        /Configure a API da Shopee/,
      );
    } finally {
      await cleanupTenant(lonely.tenantId);
    }
  });
});

describe('afiliado cujo dono não tem credencial (spec §6)', () => {
  let bareOwner: Awaited<ReturnType<typeof createTenantWithUser>>;
  let bareAff: Awaited<ReturnType<typeof createTenantWithUser>>;
  beforeAll(async () => {
    bareOwner = await createTenantWithUser('dono-sem-cred');
    bareAff = await createTenantWithUser('afiliado-sem-cred', bareOwner.tenantId);
  });
  afterAll(async () => {
    await cleanupTenant(bareOwner.tenantId);
  });
  const generic = {
    code: 'MARKETPLACE_UNAVAILABLE',
    message: /Marketplace indisponível, fale com o administrador/,
  };
  it('Shopee, tag, Awin e AliExpress → mensagem genérica', async () => {
    const db = forTenant(bareAff.tenantId);
    await expect(loadShopeeCredentials(db)).rejects.toMatchObject(generic);
    await expect(loadTagCredentials(db, 'AMAZON')).rejects.toMatchObject(generic);
    await expect(loadAwinCredentials(db)).rejects.toMatchObject(generic);
    await expect(loadAliexpressCredentials(db)).rejects.toMatchObject(generic);
  });
  it('raiz sem credencial mantém as mensagens antigas', async () => {
    const db = forTenant(bareOwner.tenantId);
    await expect(loadShopeeCredentials(db)).rejects.toMatchObject({ code: 'SHOPEE_UNCONFIGURED' });
    await expect(loadTagCredentials(db, 'AMAZON')).rejects.toThrow(/AMAZON: configure/);
    await expect(loadAwinCredentials(db)).rejects.toThrow(/AWIN: cole o link/);
    await expect(loadAliexpressCredentials(db)).rejects.toThrow(/ALIEXPRESS: configure/);
  });
});
