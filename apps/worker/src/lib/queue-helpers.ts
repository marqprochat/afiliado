import {
  QUEUE_AWIN_IMPORT,
  QUEUE_AWIN_SALES_SYNC,
  QUEUE_COUPON_SYNC,
  QUEUE_SEND_OFFER,
  QUEUE_SEND_TELEGRAM,
  type AwinImportJob,
  type AwinSalesSyncJob,
  type CouponSyncJob,
  type SendOfferJob,
  type SendTelegramJob,
} from '@afilados/shared';
import { getQueue } from './redis';

export async function enqueueSendOffer(tenantId: string, batchItemId: string) {
  const q = getQueue<SendOfferJob>(QUEUE_SEND_OFFER);
  await q.add(
    'send-offer',
    { tenantId, batchItemId },
    {
      jobId: batchItemId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: 1000,
      removeOnFail: 1000,
    },
  );
}

export async function enqueueSendTelegram(job: SendTelegramJob & { jobId: string }) {
  const { jobId, ...data } = job;
  const q = getQueue<SendTelegramJob>(QUEUE_SEND_TELEGRAM);
  await q.add('send-telegram', data, {
    jobId,
    attempts: 3,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: 1000,
    removeOnFail: 1000,
  });
}

export async function enqueueAwinImport(tenantId: string) {
  const q = getQueue<AwinImportJob>(QUEUE_AWIN_IMPORT);
  const intervalHoursRaw = Number(process.env.AWIN_IMPORT_INTERVAL_HOURS ?? 12);
  const intervalHours =
    Number.isFinite(intervalHoursRaw) && intervalHoursRaw > 0 ? intervalHoursRaw : 12;
  const intervalMs = intervalHours * 60 * 60 * 1000;
  const scheduleSlot = Math.floor(Date.now() / intervalMs);
  await q.add(
    'awin-import',
    { tenantId },
    {
      // Evita que reinícios do worker repitam a importação automática no mesmo intervalo.
      jobId: `awin-import-${tenantId}-schedule-${scheduleSlot}`,
      attempts: 2,
      removeOnComplete: { age: intervalHours * 60 * 60 + 3600, count: 100 },
      removeOnFail: 50,
    },
  );
}

export async function enqueueCouponSync(
  tenantId: string,
  trigger: 'schedule' | 'manual' = 'schedule',
) {
  const q = getQueue<CouponSyncJob>(QUEUE_COUPON_SYNC);
  const hourBucket = Math.floor(Date.now() / (60 * 60 * 1000));
  const jobId =
    trigger === 'manual'
      ? `coupon-sync-${tenantId}-${Date.now()}`
      : `coupon-sync-${tenantId}-${hourBucket}`;
  await q.add(
    'coupon-sync',
    { tenantId, trigger },
    { jobId, attempts: 2, removeOnComplete: true, removeOnFail: 50 },
  );
}

/** Sincronização das vendas da Awin; jobId por hora (janela curta) ou por dia (janela longa). */
export async function enqueueAwinSalesSync(
  tenantId: string,
  windowDays: number,
  trigger: 'schedule' | 'manual' = 'schedule',
) {
  const q = getQueue<AwinSalesSyncJob>(QUEUE_AWIN_SALES_SYNC);
  const bucketMs = windowDays > 7 ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000;
  const bucket = Math.floor(Date.now() / bucketMs);
  const jobId =
    trigger === 'manual'
      ? `awin-sales-sync-${tenantId}-${windowDays}-${Date.now()}`
      : `awin-sales-sync-${tenantId}-${windowDays}-${bucket}`;
  await q.add(
    'awin-sales-sync',
    { tenantId, windowDays, trigger },
    {
      jobId,
      attempts: 2,
      backoff: { type: 'exponential', delay: 60_000 },
      // Mantém o registro por um dia para a deduplicação valer entre reinícios.
      removeOnComplete: { age: 26 * 60 * 60, count: 1000 },
      removeOnFail: 50,
    },
  );
}
