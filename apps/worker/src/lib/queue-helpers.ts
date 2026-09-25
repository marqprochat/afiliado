import {
  QUEUE_AWIN_IMPORT,
  QUEUE_COUPON_SYNC,
  QUEUE_SEND_OFFER,
  QUEUE_SEND_TELEGRAM,
  type AwinImportJob,
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
  await q.add(
    'awin-import',
    { tenantId },
    { jobId: `awin-import-${tenantId}-${Date.now()}`, attempts: 2, removeOnComplete: true, removeOnFail: 50 },
  );
}

export async function enqueueCouponSync(tenantId: string, trigger: 'schedule' | 'manual' = 'schedule') {
  const q = getQueue<CouponSyncJob>(QUEUE_COUPON_SYNC);
  const hourBucket = Math.floor(Date.now() / (60 * 60 * 1000));
  const jobId = trigger === 'manual' ? `coupon-sync-${tenantId}-${Date.now()}` : `coupon-sync-${tenantId}-${hourBucket}`;
  await q.add(
    'coupon-sync',
    { tenantId, trigger },
    { jobId, attempts: 2, removeOnComplete: true, removeOnFail: 50 },
  );
}

