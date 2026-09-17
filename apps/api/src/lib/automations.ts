import type { TenantClient } from '@afilados/db';

export interface AutomationStats {
  freshCount: number;
  discoveredToday: number;
  dispatchedToday: number;
  lastDispatchedAt: string | null;
}

export async function getAutomationStats(db: TenantClient, ruleId: string): Promise<AutomationStats> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [freshCount, discoveredToday, dispatchedToday, lastDispatch] = await Promise.all([
    db.automationQueueItem.count({ where: { ruleId, status: 'PENDING' } }),
    db.automationLog.count({ where: { ruleId, action: 'DISCOVERED', createdAt: { gte: startOfDay } } }),
    db.automationLog.count({ where: { ruleId, action: 'DISPATCHED', createdAt: { gte: startOfDay } } }),
    db.automationLog.findFirst({ where: { ruleId, action: 'DISPATCHED' }, orderBy: { createdAt: 'desc' } }),
  ]);

  return {
    freshCount,
    discoveredToday,
    dispatchedToday,
    lastDispatchedAt: lastDispatch?.createdAt.toISOString() ?? null,
  };
}
