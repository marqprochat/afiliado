import { Redis } from 'ioredis';
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
