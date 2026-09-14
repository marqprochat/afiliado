import { describe, it, expect, afterAll } from 'vitest';
import { getRedis, closeRedis } from '../src/lib/redis';
import { TokenBucket, waitForToken } from '../src/lib/rate-limit';

afterAll(() => closeRedis());

describe('TokenBucket', () => {
  it('permite `capacity` envios imediatos e depois pede espera', async () => {
    const key = `test:bucket:${Date.now()}`;
    const b = new TokenBucket(getRedis(), key, 6, 3);
    expect(await b.take()).toBe(0);
    expect(await b.take()).toBe(0);
    expect(await b.take()).toBe(0);
    const wait = await b.take();
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(10_000); // 6/min = 1 token a cada 10s
    await getRedis().del(key);
  });
  it('waitForToken dorme o tempo pedido e retorna', async () => {
    const key = `test:bucket:${Date.now()}b`;
    const b = new TokenBucket(getRedis(), key, 60, 1);
    await b.take();
    const sleeps: number[] = [];
    await waitForToken(b, async (ms) => {
      sleeps.push(ms);
      await getRedis().del(key);
    });
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThan(0);
  });
});
