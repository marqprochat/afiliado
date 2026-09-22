import pino from 'pino';
import { prisma } from '@afilados/db';
import { enqueueAwinImport } from '../lib/queue-helpers';

const log = pino({ name: 'awin-import-scheduler' });
const DEFAULT_INTERVAL_HOURS = 12;
const parsedIntervalHours = Number(process.env.AWIN_IMPORT_INTERVAL_HOURS ?? DEFAULT_INTERVAL_HOURS);
// Um valor não numérico (ou <= 0) vira NaN/0 e faria setInterval disparar quase imediatamente
// em loop apertado — cai para o default de 12h nesse caso.
const INTERVAL_MS =
  (Number.isFinite(parsedIntervalHours) && parsedIntervalHours > 0
    ? parsedIntervalHours
    : DEFAULT_INTERVAL_HOURS) *
  60 *
  60 *
  1000;

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
    // Workers reiniciam a cada deploy; sem um tick inicial, uma instância redeployada com
    // frequência (mais frequente que INTERVAL_MS) pode nunca chegar a importar automaticamente.
    void this.tick().catch((e) => log.error(e, 'falha no tick de import da Awin'));
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
