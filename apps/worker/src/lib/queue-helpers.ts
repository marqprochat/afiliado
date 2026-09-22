import { QUEUE_AWIN_IMPORT, QUEUE_SEND_OFFER, QUEUE_SEND_TELEGRAM, type AwinImportJob, type SendOfferJob, type SendTelegramJob } from '@afilados/shared';
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
