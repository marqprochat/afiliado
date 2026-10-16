import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.ML_CLIENT_ID = 'cid-test';
  process.env.ML_CLIENT_SECRET = 'secret-test';
});

import { decryptJson, encryptJson, forTenant, prisma } from '@afilados/db';
import type { TagCredentials } from '@afilados/shared';
import { loadFetchCredentials } from '../src/lib/ml-api';
import { createTenantWithUser, cleanupTenant } from './helpers';

let owner: Awaited<ReturnType<typeof createTenantWithUser>>;
let aff: Awaited<ReturnType<typeof createTenantWithUser>>;

beforeAll(async () => {
  owner = await createTenantWithUser('dono-ml');
  aff = await createTenantWithUser('afiliado-ml', owner.tenantId);
  await prisma.marketplaceConnection.create({
    data: {
      tenantId: owner.tenantId,
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
    data: { tenantId: aff.tenantId, kind: 'MERCADOLIVRE', subId: 'joaoml' },
  });
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  await cleanupTenant(owner.tenantId);
});

describe('renovação do token do ML para um afiliado', () => {
  it('usa o token do dono, grava o novo refresh_token no DONO e não cria credenciais no afiliado', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'acc-2', refresh_token: 'ref-2', expires_in: 21600 }),
      text: async () => '',
    }));
    vi.stubGlobal('fetch', fetchMock);

    const creds = await loadFetchCredentials(forTenant(aff.tenantId), 'MERCADOLIVRE');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(creds.mlApi?.accessToken).toBe('acc-2');
    const ownerRow = await prisma.marketplaceConnection.findFirstOrThrow({
      where: { tenantId: owner.tenantId, kind: 'MERCADOLIVRE' },
    });
    const saved = decryptJson<TagCredentials>(Buffer.from(ownerRow.encryptedCredentials!));
    expect(saved.mlApi).toMatchObject({ refreshToken: 'ref-2', accessToken: 'acc-2' });
    expect(saved.mattWord).toBe('dono');
    const affRows = await prisma.marketplaceConnection.findMany({
      where: { tenantId: aff.tenantId, kind: 'MERCADOLIVRE' },
    });
    expect(affRows).toHaveLength(1);
    expect(affRows[0]!.encryptedCredentials).toBeNull();
    expect(affRows[0]!.subId).toBe('joaoml');
  });
});
