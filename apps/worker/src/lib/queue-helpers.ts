import { QUEUE_SEND_OFFER, type SendOfferJob } from '@afilados/shared';
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
