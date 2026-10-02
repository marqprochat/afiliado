import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '@afilados/db';
import { WaSessionManager } from '../src/wa/session-manager';
import type { BaileysGateway } from '../src/wa/baileys-gateway';
import type { GroupInfo } from '../src/wa/gateway';
import { getRedis, closeRedis } from '../src/lib/redis';

/** gateway falso: nenhuma conexão real com o WhatsApp é aberta */
class FakeGateway {
  disconnected: string[] = [];
  connected: Array<{ id: string; tenantId: string }> = [];
  async connect(session: { id: string; tenantId: string }) {
    this.connected.push(session);
  }
  async disconnect(sessionId: string) {
    this.disconnected.push(sessionId);
  }
  async logout() {}
  async fetchGroups(): Promise<GroupInfo[]> {
    return [];
  }
  isConnected() {
    return false;
  }
  count() {
    return this.connected.length - this.disconnected.length;
  }
}

const makeManager = () => {
  const gateway = new FakeGateway();
  const manager = new WaSessionManager(gateway as unknown as BaileysGateway);
  return {
    gateway,
    manager,
    acquire: (id: string) => callPrivate<boolean>(manager, 'acquireLock', id),
    release: (id: string) => callPrivate<void>(manager, 'releaseLock', id),
  };
};

function callPrivate<T>(manager: WaSessionManager, method: string, ...args: unknown[]): Promise<T> {
  const fn = (manager as unknown as Record<string, (...a: unknown[]) => Promise<T>>)[method];
  return fn!.call(manager, ...args);
}

const keyOf = (id: string) => `wa:lock:${id}`;
const created: string[] = [];
const newSessionId = () => {
  const id = `test-${randomUUID()}`;
  created.push(id);
  return id;
};

afterAll(async () => {
  if (created.length) await getRedis().del(...created.map(keyOf));
  await closeRedis();
});

describe('WaSessionManager — lock', () => {
  it('reentrante para o mesmo dono, exclusivo para outro worker', async () => {
    const sessionId = newSessionId();
    const a = makeManager();
    const b = makeManager();

    expect(await a.acquire(sessionId)).toBe(true);
    expect(await a.acquire(sessionId)).toBe(true);
    expect(await b.acquire(sessionId)).toBe(false);

    await a.manager.stop();
  });

  it('stop() desconecta a sessão e apaga a chave', async () => {
    const sessionId = newSessionId();
    const { manager, gateway, acquire } = makeManager();

    expect(await acquire(sessionId)).toBe(true);
    expect(await getRedis().get(keyOf(sessionId))).not.toBeNull();

    await manager.stop();

    expect(gateway.disconnected).toEqual([sessionId]);
    expect(await getRedis().get(keyOf(sessionId))).toBeNull();
  });

  it('releaseLock não apaga o lock de outro dono', async () => {
    const sessionId = newSessionId();
    await getRedis().set(keyOf(sessionId), 'outro-worker', 'PX', 30_000);

    const { manager, release } = makeManager();
    await release(sessionId);

    expect(await getRedis().get(keyOf(sessionId))).toBe('outro-worker');
    await manager.stop();
    expect(await getRedis().get(keyOf(sessionId))).toBe('outro-worker');
  });

  it('reconcile() conecta sessões ativas do banco quando o lock residual é liberado', async () => {
    const tenant = await prisma.tenant.create({ data: { name: `t-reconcile-${Date.now()}` } });
    const session = await prisma.waSession.create({
      data: {
        tenantId: tenant.id,
        label: 'chip-teste-reconcile',
        status: 'CONNECTED',
      },
    });
    created.push(session.id);

    // Simula lock residual preso no Redis por um container anterior
    await getRedis().set(keyOf(session.id), 'dead-worker-pid', 'PX', 30_000);

    const { manager, gateway } = makeManager();

    try {
      // 1. Reconcilia com lock ainda retido por outro worker: não deve conectar
      await manager.reconcile();
      expect(gateway.connected.some((c) => c.id === session.id)).toBe(false);

      // 2. Lock expira/é liberado no Redis
      await getRedis().del(keyOf(session.id));

      // 3. Próxima reconciliação adquire o lock e conecta automaticamente
      await manager.reconcile();
      expect(gateway.connected.some((c) => c.id === session.id)).toBe(true);
    } finally {
      await manager.stop();
      await prisma.waSession.deleteMany({ where: { id: session.id } });
      await prisma.tenant.deleteMany({ where: { id: tenant.id } });
    }
  });
});

