import { Redis } from 'ioredis';
import { Queue, QueueEvents } from 'bullmq';
import { config } from '../config';

let redis: Redis | null = null;
const queues = new Map<string, Queue>();
const queueEvents = new Map<string, QueueEvents>();

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

/** QueueEvents dedicado por fila, usado por `job.waitUntilFinished`. Usa conexão própria
 * (não a de `getRedis()`) porque QueueEvents faz leitura bloqueante de stream (XREAD BLOCK),
 * que travaria outros comandos se compartilhasse a conexão da Queue — recomendação do BullMQ. */
export function getQueueEvents(name: string): QueueEvents {
  let qe = queueEvents.get(name);
  if (!qe) {
    qe = new QueueEvents(name, {
      connection: new Redis(config.REDIS_URL, { maxRetriesPerRequest: null }),
    });
    queueEvents.set(name, qe);
  }
  return qe;
}

export async function closeRedis() {
  await Promise.all([...queues.values()].map((q) => q.close()));
  await Promise.all([...queueEvents.values()].map((qe) => qe.close()));
  queues.clear();
  queueEvents.clear();
  if (redis) {
    await redis.quit();
    redis = null;
  }
}
