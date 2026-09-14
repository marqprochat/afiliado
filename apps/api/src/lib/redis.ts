import { Redis } from 'ioredis';
import { Queue } from 'bullmq';
import { config } from '../config';

let redis: Redis | null = null;
const queues = new Map<string, Queue>();

export function getRedis(): Redis {
  if (!redis) redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
  return redis;
}

export function getQueue<T = unknown>(name: string): Queue<T> {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, { connection: getRedis() });
    queues.set(name, q);
  }
  return q as Queue<T>;
}

export async function closeRedis() {
  await Promise.all([...queues.values()].map((q) => q.close()));
  queues.clear();
  if (redis) {
    await redis.quit();
    redis = null;
  }
}
