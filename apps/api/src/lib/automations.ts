import type { TenantClient } from '@afilados/db';
import { automationDiscoveringKey } from '@afilados/shared';
import { getRedis } from './redis';

export interface AutomationStats {
  freshCount: number;
  discoveredToday: number;
  dispatchedToday: number;
  lastDispatchedAt: string | null;
  isDiscovering: boolean;
}

export async function getAutomationStats(db: TenantClient, ruleId: string): Promise<AutomationStats> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [freshCount, discoveredToday, dispatchedToday, lastDispatch, discoveringFlag] = await Promise.all([
    db.automationQueueItem.count({ where: { ruleId, status: 'PENDING' } }),
    db.automationLog.count({ where: { ruleId, action: 'DISCOVERED', createdAt: { gte: startOfDay } } }),
    db.automationLog.count({ where: { ruleId, action: 'DISPATCHED', createdAt: { gte: startOfDay } } }),
    db.automationLog.findFirst({ where: { ruleId, action: 'DISPATCHED' }, orderBy: { createdAt: 'desc' } }),
    getRedis().exists(automationDiscoveringKey(ruleId)).catch(() => 0),
  ]);

  return {
    freshCount,
    discoveredToday,
    dispatchedToday,
    lastDispatchedAt: lastDispatch?.createdAt.toISOString() ?? null,
    isDiscovering: discoveringFlag === 1,
  };
}
