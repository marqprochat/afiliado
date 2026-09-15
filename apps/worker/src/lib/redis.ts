import { Redis } from 'ioredis';
import { Queue } from 'bullmq';
import { config } from '../config';

let redis: Redis | null = null;
export function getRedis(): Redis {
  if (!redis) redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
  return redis;
}
export async function closeRedis() {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}

const queues = new Map<string, Queue>();
export function getQueue<T = unknown>(name: string): Queue<T> {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, { connection: getRedis() });
    queues.set(name, q);
  }
  return q as Queue<T>;
}
