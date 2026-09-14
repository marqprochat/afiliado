import { Worker } from 'bullmq';
import pino from 'pino';
import { prisma } from '@afilados/db';
import {
  QUEUE_SEND_OFFER,
  QUEUE_WA_COMMANDS,
  type SendOfferJob,
  type WaCommandJob,
} from '@afilados/shared';
import { createShopeeAdapter } from '@afilados/marketplaces';
import { config } from './config';
import { getRedis, closeRedis } from './lib/redis';
import { BaileysGateway } from './wa/baileys-gateway';
import { WaSessionManager } from './wa/session-manager';
import { processWaCommand } from './processors/wa-commands';
import { processSendOffer, finalizeBatchIfComplete } from './processors/send-offer';
import { startHttp } from './http';

const log = pino({ name: 'worker' });
const gateway = new BaileysGateway();
const manager = new WaSessionManager(gateway);

const waWorker = new Worker<WaCommandJob>(QUEUE_WA_COMMANDS, processWaCommand(manager), {
  connection: getRedis(),
  concurrency: 1,
});
const sendWorker = new Worker<SendOfferJob>(
  QUEUE_SEND_OFFER,
  processSendOffer({ gateway, shopee: createShopeeAdapter() }),
  { connection: getRedis(), concurrency: 1 },
);
for (const w of [waWorker, sendWorker]) {
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

const http = startHttp(config.WORKER_PORT, () => manager.sessionCount());
await manager.start();
log.info({ port: config.WORKER_PORT }, 'worker iniciado');

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info('encerrando');
  try {
    await Promise.all([waWorker.close(), sendWorker.close()]);
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
