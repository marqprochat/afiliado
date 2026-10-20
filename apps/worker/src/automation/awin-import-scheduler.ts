import pino from 'pino';
import { prisma } from '@afilados/db';
import { enqueueAwinImport } from '../lib/queue-helpers';

const log = pino({ name: 'awin-import-scheduler' });
const DEFAULT_INTERVAL_HOURS = 12;
const parsedIntervalHours = Number(
  process.env.AWIN_IMPORT_INTERVAL_HOURS ?? DEFAULT_INTERVAL_HOURS,
);
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
    // O catálogo pertence à conta principal; afiliados compartilham os mesmos feeds e só
    // diferenciam o Sub ID na geração do link. Importar por afiliado duplicava o trabalho.
    const owners = await prisma.$queryRaw<{ tenantId: string }[]>`
      SELECT DISTINCT connection."tenantId"
      FROM "MarketplaceConnection" AS connection
      INNER JOIN "Tenant" AS tenant ON tenant.id = connection."tenantId"
      WHERE connection.kind = 'AWIN'
        AND connection."encryptedCredentials" IS NOT NULL
        AND tenant."parentTenantId" IS NULL
        AND tenant.active = TRUE
    `;
    for (const { tenantId } of owners) {
      await this.enqueue(tenantId);
    }
  }
}
