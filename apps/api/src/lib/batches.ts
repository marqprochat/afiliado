import { QUEUE_SEND_OFFER, type ProductData, type SendOfferJob } from '@afilados/shared';
import { getQueue } from './redis';

export const SAMPLE_PRODUCT: ProductData = {
  source: 'SHOPEE',
  externalId: 'exemplo',
  title: 'Fone Bluetooth XYZ',
  price: 129.9,
  originalPrice: 199.9,
  discountPct: 35,
  salesCount: 1250,
  commissionPct: 5,
  images: ['https://cf.shopee.com.br/file/exemplo'],
  shipping: 'FREE',
  couponCode: 'AFILIADO10',
  originalUrl: 'https://shopee.com.br/product/1/1',
  raw: {},
};

export async function enqueueBatchItems(
  items: { id: string; runAt: Date }[],
  tenantId: string,
  now = new Date(),
) {
  const q = getQueue<SendOfferJob>(QUEUE_SEND_OFFER);
  await q.addBulk(
    items.map((it) => ({
      name: 'send-offer',
      data: { tenantId, batchItemId: it.id },
      opts: {
        jobId: it.id,
        delay: Math.max(0, it.runAt.getTime() - now.getTime()),
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    })),
  );
}

export async function removePendingJobs(itemIds: string[]) {
  const q = getQueue<SendOfferJob>(QUEUE_SEND_OFFER);
  await Promise.all(
    itemIds.map(async (id) => {
      const job = await q.getJob(id);
      if (!job) return;
      const state = await job.getState();
      if (state === 'waiting' || state === 'delayed') await job.remove();
    }),
  );
}
