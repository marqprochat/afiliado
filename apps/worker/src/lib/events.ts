import { REDIS_EVENTS_CHANNEL, type RealtimeEvent } from '@afilados/shared';
import { getRedis } from './redis';

export async function publishEvent(tenantId: string, event: RealtimeEvent) {
  await getRedis().publish(REDIS_EVENTS_CHANNEL, JSON.stringify({ tenantId, event }));
}
