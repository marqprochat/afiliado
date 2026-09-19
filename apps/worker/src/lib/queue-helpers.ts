import { QUEUE_SEND_OFFER, QUEUE_SEND_TELEGRAM, type SendOfferJob, type SendTelegramJob } from '@afilados/shared';
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
