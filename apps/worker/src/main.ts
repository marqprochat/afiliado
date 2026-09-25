import { Worker } from 'bullmq';
import pino from 'pino';
import { prisma } from '@afilados/db';
import {
  QUEUE_AWIN_IMPORT,
  QUEUE_COUPON_SYNC,
  QUEUE_MIRROR_MESSAGE,
  QUEUE_PRODUCT_ENRICH,
  QUEUE_SEND_OFFER,
  QUEUE_SEND_TELEGRAM,
  QUEUE_WA_COMMANDS,
  REDIS_EVENTS_CHANNEL,
  type AwinImportJob,
  type CouponSyncJob,
  type MirrorMessageJob,
  type ProductEnrichJob,
  type SendOfferJob,
  type SendTelegramJob,
  type WaCommandJob,
} from '@afilados/shared';
import { createShopeeAdapter, createAwinAdapter, createAliexpressAdapter } from '@afilados/marketplaces';
import { config } from './config';
import { getRedis, closeRedis } from './lib/redis';
import { BaileysGateway } from './wa/baileys-gateway';
import { WaSessionManager } from './wa/session-manager';
import { processWaCommand } from './processors/wa-commands';
import { processSendOffer, finalizeBatchIfComplete } from './processors/send-offer';
import { processSendTelegram } from './processors/send-telegram';
import { processMirrorMessage } from './processors/mirror-message';
import { createProductEnrichProcessor } from './processors/product-enrich';
import { createAwinImportProcessor } from './processors/awin-import';
import { createCouponSyncProcessor } from './processors/coupon-sync';
import { MirrorListener } from './mirror/listener';
import { AutomationScheduler } from './automation/scheduler';
import { AwinImportScheduler } from './automation/awin-import-scheduler';
import { CouponSyncScheduler } from './automation/coupon-sync-scheduler';
import { TelegramManager } from './telegram/manager';
import { startHttp } from './http';

const log = pino({ name: 'worker' });
const gateway = new BaileysGateway();
const manager = new WaSessionManager(gateway);
const mirrorListener = new MirrorListener(gateway);
const automationScheduler = new AutomationScheduler();
const awinImportScheduler = new AwinImportScheduler();
const couponSyncScheduler = new CouponSyncScheduler();
const telegramManager = new TelegramManager();

const waWorker = new Worker<WaCommandJob>(QUEUE_WA_COMMANDS, processWaCommand(manager), {
  connection: getRedis(),
  concurrency: 1,
});
const sendWorker = new Worker<SendOfferJob>(
  QUEUE_SEND_OFFER,
  processSendOffer({
    gateway,
    shopee: createShopeeAdapter(),
    awin: createAwinAdapter(),
    aliexpress: createAliexpressAdapter(),
  }),
  { connection: getRedis(), concurrency: 1 },
);
const mirrorWorker = new Worker<MirrorMessageJob>(
  QUEUE_MIRROR_MESSAGE,
  processMirrorMessage({ gateway }),
  { connection: getRedis(), concurrency: 2 },
);
// Scraping gentil: no máximo 6 páginas a cada 10s, 2 em paralelo (evita bloqueio dos marketplaces)
const enrichWorker = new Worker<ProductEnrichJob>(
  QUEUE_PRODUCT_ENRICH,
  createProductEnrichProcessor(),
  { connection: getRedis(), concurrency: 2, limiter: { max: 6, duration: 10_000 } },
);
const telegramWorker = new Worker<SendTelegramJob>(
  QUEUE_SEND_TELEGRAM,
  processSendTelegram({
    shopee: createShopeeAdapter(),
    awin: createAwinAdapter(),
    aliexpress: createAliexpressAdapter(),
  }),
  { connection: getRedis(), concurrency: 2 },
);
const awinImportWorker = new Worker<AwinImportJob>(QUEUE_AWIN_IMPORT, createAwinImportProcessor(), {
  connection: getRedis(),
  concurrency: 1,
});
const couponSyncWorker = new Worker<CouponSyncJob>(QUEUE_COUPON_SYNC, createCouponSyncProcessor(), {
  connection: getRedis(),
  concurrency: 1,
});

for (const w of [
  waWorker,
  sendWorker,
  mirrorWorker,
  enrichWorker,
  telegramWorker,
  awinImportWorker,
  couponSyncWorker,
]) {
  w.on('failed', (job, err) => log.error({ jobId: job?.id, err: err.message }, 'job falhou'));
}
sendWorker.on('failed', (job, err) => {
  if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    const { batchItemId } = job.data;
    void (async () => {
      try {
        await prisma.batchItem.updateMany({
          where: { id: batchItemId, status: { in: ['PENDING', 'SENDING'] } },
          data: { status: 'ERROR', error: err.message },
        });
        const item = await prisma.batchItem.findUnique({ where: { id: batchItemId } });
        if (item) await finalizeBatchIfComplete(item.batchId);
      } catch (e) {
        log.error({ err: e, batchItemId }, 'falha ao finalizar item esgotado');
      }
    })();
  }
});

// Subscriber Redis para mirror.rules.changed
const redisSub = getRedis().duplicate();
await redisSub.subscribe(REDIS_EVENTS_CHANNEL);
redisSub.on('message', (_channel, raw) => {
  try {
    const ev = JSON.parse(raw) as { event?: { type: string } };
    if (ev.event?.type === 'mirror.rules.changed') {
      void mirrorListener.reload();
    }
    if (ev.event?.type === 'automation.rules.changed') {
      void automationScheduler.reload();
    }
    if (ev.event?.type === 'telegram.bots.changed') {
      void telegramManager.reload();
    }
  } catch {
    // ignore
  }
});

const http = startHttp(config.WORKER_PORT, () => manager.sessionCount());
await manager.start();
await mirrorListener.start();
await automationScheduler.start();
awinImportScheduler.start();
couponSyncScheduler.start();
await telegramManager.start();
log.info({ port: config.WORKER_PORT }, 'worker iniciado');

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info('encerrando');
  try {
    automationScheduler.stop();
    awinImportScheduler.stop();
    couponSyncScheduler.stop();
    telegramManager.stop();
    await Promise.all([
      waWorker.close(),
      sendWorker.close(),
      mirrorWorker.close(),
      enrichWorker.close(),
      telegramWorker.close(),
      awinImportWorker.close(),
      couponSyncWorker.close(),
    ]);
    await redisSub.unsubscribe();
    redisSub.disconnect();
    await manager.stop();
    await gateway.stopAll();
    http.close();
    await closeRedis();
  } catch (e) {
    log.error(e);
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('unhandledRejection', (e) => log.error(e, 'unhandledRejection'));
process.on('uncaughtException', (e) => {
  log.fatal(e, 'uncaughtException');
  void shutdown();
});
