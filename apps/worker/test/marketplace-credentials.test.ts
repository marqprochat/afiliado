import { describe, expect, it, beforeEach } from 'vitest';
import { prisma, encryptJson } from '@afilados/db';
import {
  loadAwinCredentials,
  loadTagCredentials,
  loadTagCredentialsForLink,
} from '../src/lib/marketplace-credentials';

describe('loadTagCredentials (worker)', () => {
  let tenantId: string;

  beforeEach(async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Test Tenant Creds' } });
    tenantId = tenant.id;
  });

  it('AMAZON: lança erro claro quando não há conexão configurada', async () => {
    await expect(loadTagCredentials(tenantId, 'AMAZON')).rejects.toThrow(
      /configure Client ID\/Secret da Creators API/,
    );
  });

  it('AMAZON: lança erro claro quando a conexão existe mas amazonApi está incompleto', async () => {
    await prisma.marketplaceConnection.create({
      data: {
        tenantId,
        kind: 'AMAZON',
        encryptedCredentials: encryptJson({ tag: 'minha-20' }),
      },
    });
    await expect(loadTagCredentials(tenantId, 'AMAZON')).rejects.toThrow(
      /configure Client ID\/Secret da Creators API/,
    );
  });

  it('decripta e devolve as credenciais salvas', async () => {
    await prisma.marketplaceConnection.create({
      data: {
        tenantId,
        kind: 'AMAZON',
        encryptedCredentials: encryptJson({
          tag: 'minha-20',
          amazonApi: { clientId: 'cid', clientSecret: 'csecret' },
        }),
      },
    });
    const creds = await loadTagCredentials(tenantId, 'AMAZON');
    expect(creds).toEqual({
      tag: 'minha-20',
      amazonApi: { clientId: 'cid', clientSecret: 'csecret' },
    });
  });

  it('MERCADOLIVRE: devolve {} quando não há conexão configurada, sem lançar', async () => {
    const creds = await loadTagCredentials(tenantId, 'MERCADOLIVRE');
    expect(creds).toEqual({});
  });

  it('MAGALU: devolve {} quando não há conexão configurada, sem lançar', async () => {
    const creds = await loadTagCredentials(tenantId, 'MAGALU');
    expect(creds).toEqual({});
  });
});

describe('afiliado (worker)', () => {
  it('carrega credenciais do pai e aplica a etiqueta do afiliado só no link', async () => {
    const owner = await prisma.tenant.create({ data: { name: 'w-owner' } });
    const aff = await prisma.tenant.create({ data: { name: 'w-aff', parentTenantId: owner.id } });
    try {
      await prisma.marketplaceConnection.create({
        data: { tenantId: owner.id, kind: 'MERCADOLIVRE',
          encryptedCredentials: encryptJson({ tag: 'dono', mattWord: 'm', mattTool: '1' }) },
      });
      await prisma.marketplaceConnection.create({
        data: { tenantId: aff.id, kind: 'MERCADOLIVRE', subId: 'joaoml' },
      });
      await prisma.marketplaceConnection.create({
        data: { tenantId: owner.id, kind: 'AWIN',
          encryptedCredentials: encryptJson({ feedListUrl: 'https://ui.awin.com/feedList/x', feedIds: ['f'] }) },
      });
      expect((await loadTagCredentialsForLink(aff.id, 'MERCADOLIVRE')).tag).toBe('joaoml');
      expect((await loadTagCredentials(aff.id, 'MERCADOLIVRE')).tag).toBe('dono');
      expect((await loadTagCredentialsForLink(owner.id, 'MERCADOLIVRE')).tag).toBe('dono');
      expect((await loadAwinCredentials(aff.id)).feedIds).toEqual(['f']);
    } finally {
      await prisma.tenant.deleteMany({ where: { id: aff.id } });
      await prisma.tenant.deleteMany({ where: { id: owner.id } });
    }
  });
});
