import pino from 'pino';
import { prisma } from '@afilados/db';
import { enqueueAwinImport } from '../lib/queue-helpers';

const log = pino({ name: 'awin-import-scheduler' });
const INTERVAL_MS = Number(process.env.AWIN_IMPORT_INTERVAL_HOURS ?? 12) * 60 * 60 * 1000;

export interface AwinImportSchedulerDeps {
  enqueue?: (tenantId: string) => Promise<void>;
}

export class AwinImportScheduler {
  private timer: NodeJS.Timeout | null = null;
  private readonly enqueue: (tenantId: string) => Promise<void>;

  constructor(deps: AwinImportSchedulerDeps = {}) {
    this.enqueue = deps.enqueue ?? enqueueAwinImport;
  }

  start() {
    this.timer = setInterval(() => {
      void this.tick().catch((e) => log.error(e, 'falha no tick de import da Awin'));
    }, INTERVAL_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    const conns = await prisma.marketplaceConnection.findMany({
      where: { kind: 'AWIN', encryptedCredentials: { not: null } },
      select: { tenantId: true },
    });
    for (const { tenantId } of conns) {
      await this.enqueue(tenantId);
    }
  }
}
