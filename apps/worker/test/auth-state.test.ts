import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@afilados/db';
import { usePostgresAuthState } from '../src/wa/auth-state';

let tenantId: string;
let sessionId: string;
beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: 'auth' } })).id;
  sessionId = (await prisma.waSession.create({ data: { tenantId, label: 'a' } })).id;
});
afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe('usePostgresAuthState', () => {
  it('persiste creds (com Buffers) e chaves, e recarrega', async () => {
    const a = await usePostgresAuthState(sessionId);
    // `creds` expõe alguns campos como readonly; o store real também os sobrescreve.
    const creds = a.state.creds as {
      registrationId: number;
      noiseKey: { private: Uint8Array; public: Uint8Array };
    };
    creds.registrationId = 4242;
    creds.noiseKey = { private: Buffer.from('priv'), public: Buffer.from('pub') };
    await a.saveCreds();
    await a.state.keys.set({
      'pre-key': { '1': { private: Buffer.from('p1'), public: Buffer.from('q1') } },
    });

    const b = await usePostgresAuthState(sessionId);
    expect(b.state.creds.registrationId).toBe(4242);
    expect(Buffer.isBuffer(b.state.creds.noiseKey.private)).toBe(true);
    expect(b.state.creds.noiseKey.public.toString()).toBe('pub');
    const keys = await b.state.keys.get('pre-key', ['1', '2']);
    expect(keys['1']?.public.toString()).toBe('q1');
    expect(keys['2']).toBeUndefined();
  });
  it('set com null remove a chave; clear apaga tudo', async () => {
    const a = await usePostgresAuthState(sessionId);
    await a.state.keys.set({ 'pre-key': { '1': null } });
    expect(await prisma.waAuthKey.count({ where: { sessionId } })).toBe(0);
    await a.clear();
    const s = await prisma.waSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(s.authCreds).toBeNull();
  });
});
