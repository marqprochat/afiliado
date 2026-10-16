import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  prisma,
  forTenant,
  encryptJson,
  resolveConnection,
  resolveConnections,
  resolveSettings,
  mergeAffiliateAi,
  isTenantActive,
  listTenantsWithCredentials,
} from '../src/index';

let root: string;
let aff: string;
let affNoRow: string;
let inactive: string;
const rootCreds = encryptJson({ appId: 'root-app', secret: 'root-secret' });

beforeAll(async () => {
  root = (await prisma.tenant.create({ data: { name: 'res-root' } })).id;
  aff = (await prisma.tenant.create({ data: { name: 'res-aff', parentTenantId: root } })).id;
  affNoRow = (await prisma.tenant.create({ data: { name: 'res-aff2', parentTenantId: root } })).id;
  inactive = (
    await prisma.tenant.create({ data: { name: 'res-off', parentTenantId: root, active: false } })
  ).id;
  await prisma.marketplaceConnection.create({
    data: { tenantId: root, kind: 'SHOPEE', encryptedCredentials: rootCreds, status: 'OK' },
  });
  await prisma.marketplaceConnection.create({
    data: { tenantId: aff, kind: 'SHOPEE', subId: ' joao ' },
  });
  await prisma.setting.create({
    data: {
      tenantId: root,
      key: 'ai',
      value: {
        enabled: false,
        baseUrl: 'https://vps/v1',
        model: 'combo',
        encryptedApiKey: 'KEY',
        tone: 'urgente',
      },
    },
  });
  await prisma.setting.create({
    data: {
      tenantId: aff,
      key: 'ai',
      value: { enabled: true, baseUrl: 'https://evil', model: 'x', tone: 'divertido' },
    },
  });
});
afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [aff, affNoRow, inactive] } } });
  await prisma.tenant.deleteMany({ where: { id: root } });
  await prisma.$disconnect();
});

describe('resolveConnection', () => {
  it('raiz: usa a própria linha, subId null', async () => {
    const r = await resolveConnection(root, 'SHOPEE');
    expect(r).toMatchObject({ ownerTenantId: root, subId: null, isAffiliate: false });
    expect(r.row?.tenantId).toBe(root);
  });
  it('afiliado: credencial do pai, subId do próprio (aparado)', async () => {
    const r = await resolveConnection(aff, 'SHOPEE');
    expect(r).toMatchObject({ ownerTenantId: root, subId: 'joao', isAffiliate: true });
    expect(r.row?.tenantId).toBe(root);
  });
  it('afiliado sem linha própria: subId null; pai sem credencial: row null', async () => {
    expect((await resolveConnection(affNoRow, 'SHOPEE')).subId).toBeNull();
    expect((await resolveConnection(aff, 'AMAZON')).row).toBeNull();
  });
  it('resolveConnections devolve mapa por kind', async () => {
    const m = await resolveConnections(aff);
    expect(m.get('SHOPEE')).toMatchObject({ subId: 'joao', isAffiliate: true });
    expect(m.has('AMAZON')).toBe(false);
  });
});

describe('IA e settings', () => {
  it('mergeAffiliateAi: credenciais do pai, preferências do afiliado', () => {
    const m = mergeAffiliateAi(
      { enabled: true, baseUrl: 'x', model: 'y', encryptedApiKey: 'MINE', tone: 'divertido' },
      { enabled: false, baseUrl: 'https://vps/v1', model: 'combo', encryptedApiKey: 'KEY' },
    );
    expect(m).toMatchObject({
      enabled: true,
      baseUrl: 'https://vps/v1',
      model: 'combo',
      encryptedApiKey: 'KEY',
      tone: 'divertido',
    });
  });
  it('mergeAffiliateAi sem pai configurado deixa incompleto', () => {
    expect(mergeAffiliateAi({ enabled: true, baseUrl: '', model: '' }, undefined)).toEqual({
      enabled: true,
      baseUrl: '',
      model: '',
    });
  });
  it('resolveSettings: afiliado herda credencial de IA; raiz não muda', async () => {
    const a = (await resolveSettings(aff)).ai as Record<string, unknown>;
    expect(a).toMatchObject({
      enabled: true,
      baseUrl: 'https://vps/v1',
      encryptedApiKey: 'KEY',
      tone: 'divertido',
    });
    const r = (await resolveSettings(root)).ai as Record<string, unknown>;
    expect(r).toMatchObject({ baseUrl: 'https://vps/v1', tone: 'urgente' });
  });
});

describe('tenants', () => {
  it('isTenantActive', async () => {
    expect(await isTenantActive(aff)).toBe(true);
    expect(await isTenantActive(inactive)).toBe(false);
  });
  it('listTenantsWithCredentials: dono + afiliados ativos', async () => {
    const ids = await listTenantsWithCredentials(['SHOPEE']);
    expect(ids).toEqual(expect.arrayContaining([root, aff, affNoRow]));
    expect(ids).not.toContain(inactive);
  });
  it('forTenant expõe $tenantId', () => {
    expect(forTenant(aff).$tenantId).toBe(aff);
  });
});
