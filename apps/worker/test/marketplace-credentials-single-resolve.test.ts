import { describe, it, expect, vi, afterAll } from 'vitest';

const h = vi.hoisted(() => ({ calls: 0 }));
vi.mock('@afilados/db', async (orig) => {
  const real = await orig<typeof import('@afilados/db')>();
  return {
    ...real,
    resolveConnection: (...args: Parameters<typeof real.resolveConnection>) => {
      h.calls++;
      return real.resolveConnection(...args);
    },
  };
});

import { prisma, encryptJson } from '@afilados/db';
import { loadTagCredentialsForLink } from '../src/lib/marketplace-credentials';

const owner = await prisma.tenant.create({ data: { name: 'single-owner' } });
const aff = await prisma.tenant.create({ data: { name: 'single-aff', parentTenantId: owner.id } });
afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: aff.id } });
  await prisma.tenant.deleteMany({ where: { id: owner.id } });
  await prisma.$disconnect();
});

describe('loadTagCredentialsForLink', () => {
  it('resolve a conexão uma única vez (credenciais e SubID do mesmo snapshot)', async () => {
    await prisma.marketplaceConnection.create({
      data: {
        tenantId: owner.id,
        kind: 'MERCADOLIVRE',
        encryptedCredentials: encryptJson({ tag: 'dono', mattWord: 'm', mattTool: '1' }),
      },
    });
    await prisma.marketplaceConnection.create({
      data: { tenantId: aff.id, kind: 'MERCADOLIVRE', subId: 'joaoml' },
    });
    h.calls = 0;
    const creds = await loadTagCredentialsForLink(aff.id, 'MERCADOLIVRE');
    expect(creds.tag).toBe('joaoml');
    expect(h.calls).toBe(1);
  });
});
