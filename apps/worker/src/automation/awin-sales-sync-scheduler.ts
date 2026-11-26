import pino from 'pino';
import { prisma, listTenantsWithCredentials } from '@afilados/db';
import { enqueueAwinSalesSync } from '../lib/queue-helpers';

const log = pino({ name: 'awin-sales-sync-scheduler' });
const HOUR_MS = 60 * 60 * 1000;
export const AWIN_SALES_HOURLY_WINDOW_DAYS = 7;
export const AWIN_SALES_DAILY_WINDOW_DAYS = 31;

export interface AwinSalesSyncSchedulerDeps {
  enqueue?: (tenantId: string, windowDays: number) => Promise<void>;
  now?: () => Date;
}

/**
 * De hora em hora enfileira a sincronização das vendas da Awin (últimos 7 dias) e, uma vez por dia
 * (UTC), a janela de 31 dias para pegar validações tardias. O jobId (por hora/dia) evita repetir
 * a mesma rodada quando o worker reinicia.
 */
export class AwinSalesSyncScheduler {
  private timer: NodeJS.Timeout | null = null;
  private lastDailyKey: string | null = null;
  private readonly enqueue: (tenantId: string, windowDays: number) => Promise<void>;
  private readonly now: () => Date;

  constructor(deps: AwinSalesSyncSchedulerDeps = {}) {
    this.enqueue = deps.enqueue ?? ((t, d) => enqueueAwinSalesSync(t, d));
    this.now = deps.now ?? (() => new Date());
  }

  start() {
    const run = () =>
      void this.tick().catch((e) => log.error(e, 'falha no tick de sincronização de vendas'));
    run();
    this.timer = setInterval(run, HOUR_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    const dayKey = this.now().toISOString().slice(0, 10);
    const daily = this.lastDailyKey !== dayKey;
    const candidates = await listTenantsWithCredentials(['AWIN']);
    // Só a conta dona das credenciais: afiliados compartilham o mesmo publisher da Awin.
    const owners = candidates.length
      ? await prisma.tenant.findMany({
          where: { id: { in: candidates }, parentTenantId: null },
          select: { id: true },
        })
      : [];
    for (const { id } of owners) {
      await this.enqueue(id, AWIN_SALES_HOURLY_WINDOW_DAYS);
      if (daily) await this.enqueue(id, AWIN_SALES_DAILY_WINDOW_DAYS);
    }
    if (daily) this.lastDailyKey = dayKey;
  }
}
