import { describe, expect, it, beforeEach } from 'vitest';
import { prisma, encryptJson } from '@afilados/db';
import { loadTagCredentials } from '../src/lib/marketplace-credentials';

describe('loadTagCredentials (worker)', () => {
  let tenantId: string;

  beforeEach(async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Test Tenant Creds' } });
    tenantId = tenant.id;
  });

  it('devolve {} quando não há conexão configurada', async () => {
    const creds = await loadTagCredentials(tenantId, 'AMAZON');
    expect(creds).toEqual({});
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
    expect(creds).toEqual({ tag: 'minha-20', amazonApi: { clientId: 'cid', clientSecret: 'csecret' } });
  });
});
