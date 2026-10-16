import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.ML_CLIENT_ID = 'cid-test';
  process.env.ML_CLIENT_SECRET = 'secret-test';
});

import { decryptJson, encryptJson, prisma } from '@afilados/db';
import type { TagCredentials } from '@afilados/shared';
import { loadMlApiCredentials } from '../src/lib/marketplace-credentials';

let owner: string;
let aff: string;

beforeAll(async () => {
  owner = (await prisma.tenant.create({ data: { name: 'mltok-owner' } })).id;
  aff = (await prisma.tenant.create({ data: { name: 'mltok-aff', parentTenantId: owner } })).id;
  await prisma.marketplaceConnection.create({
    data: {
      tenantId: owner,
      kind: 'MERCADOLIVRE',
      status: 'OK',
      encryptedCredentials: encryptJson({
        mattWord: 'dono',
        mlApi: {
          refreshToken: 'ref-1',
          accessToken: 'acc-velho',
          expiresAt: new Date(Date.now() - 3600_000).toISOString(),
        },
      }),
    },
  });
  await prisma.marketplaceConnection.create({
    data: { tenantId: aff, kind: 'MERCADOLIVRE', subId: 'joaoml' },
  });
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: aff } });
  await prisma.tenant.deleteMany({ where: { id: owner } });
  await prisma.$disconnect();
});

describe('renovação do token do ML para um afiliado (worker)', () => {
  it('usa o token do dono, grava o novo refresh_token no DONO e não cria credenciais no afiliado', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'acc-2', refresh_token: 'ref-2', expires_in: 21600 }),
      text: async () => '',
    }));
    vi.stubGlobal('fetch', fetchMock);

    const creds = await loadMlApiCredentials(aff);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(creds.mlApi?.accessToken).toBe('acc-2');
    const ownerRow = await prisma.marketplaceConnection.findFirstOrThrow({
      where: { tenantId: owner, kind: 'MERCADOLIVRE' },
    });
    const saved = decryptJson<TagCredentials>(Buffer.from(ownerRow.encryptedCredentials!));
    expect(saved.mlApi).toMatchObject({ refreshToken: 'ref-2', accessToken: 'acc-2' });
    expect(saved.mattWord).toBe('dono');
    const affRows = await prisma.marketplaceConnection.findMany({
      where: { tenantId: aff, kind: 'MERCADOLIVRE' },
    });
    expect(affRows).toHaveLength(1);
    expect(affRows[0]!.encryptedCredentials).toBeNull();
    expect(affRows[0]!.subId).toBe('joaoml');
  });
});
