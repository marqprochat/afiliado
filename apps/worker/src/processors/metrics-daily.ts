import type { Job } from 'bullmq';
import pino from 'pino';
import { METRICS_TIMEZONE, type MetricsDailyJob } from '@afilados/shared';
import { purgeOldMetrics, snapshotGroups } from '../metrics/group-snapshots';

const log = pino({ name: 'metrics-daily' });

export interface JobSchedulerLike {
  upsertJobScheduler(
    id: string,
    repeat: { pattern: string; tz: string },
    template: { name: string; data: MetricsDailyJob },
  ): Promise<unknown>;
}

export function createMetricsDailyProcessor(deps: { retentionDays: number; now?: () => Date }) {
  return async (_job: Job<MetricsDailyJob>) => {
    const now = deps.now?.() ?? new Date();
    const snapshots = await snapshotGroups({}, now);
    const purged = await purgeOldMetrics(now, deps.retentionDays);
    log.info({ ...purged, snapshots }, 'métricas diárias concluídas');
    return { ...purged, snapshots };
  };
}

/** Idempotente: o BullMQ mantém um único agendamento com este id. */
export async function scheduleMetricsDaily(queue: JobSchedulerLike): Promise<void> {
  await queue.upsertJobScheduler(
    'metrics-daily',
    { pattern: '0 0 * * *', tz: METRICS_TIMEZONE },
    { name: 'daily', data: { trigger: 'schedule' } },
  );
}
