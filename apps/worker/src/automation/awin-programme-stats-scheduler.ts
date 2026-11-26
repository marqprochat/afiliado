import pino from 'pino';
import { prisma, decryptJson } from '@afilados/db';
import type { AwinCredentials } from '@afilados/marketplaces';
import { enqueueAwinProgrammeStats } from '../lib/queue-helpers';

const log = pino({ name: 'awin-programme-stats-scheduler' });
const HOUR_MS = 60 * 60 * 1000;

export interface AwinProgrammeStatsSchedulerDeps {
  enqueue?: (tenantId: string) => Promise<void>;
  now?: () => Date;
}

/**
 * Uma vez por dia (UTC) enfileira a atualização dos indicadores dos programas Awin para cada
 * conta dona das credenciais (publisherId + token). Afiliados compartilham o publisher do dono,
 * então não rodam. Confere de hora em hora; o jobId por dia evita repetir após reinícios.
 */
export class AwinProgrammeStatsScheduler {
  private timer: NodeJS.Timeout | null = null;
  private lastDayKey: string | null = null;
  private readonly enqueue: (tenantId: string) => Promise<void>;
  private readonly now: () => Date;

  constructor(deps: AwinProgrammeStatsSchedulerDeps = {}) {
    this.enqueue = deps.enqueue ?? ((t) => enqueueAwinProgrammeStats(t));
    this.now = deps.now ?? (() => new Date());
  }

  start() {
    const run = () =>
      void this.tick().catch((e) => log.error(e, 'falha no tick dos indicadores da Awin'));
    run();
    this.timer = setInterval(run, HOUR_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    const dayKey = this.now().toISOString().slice(0, 10);
    if (this.lastDayKey === dayKey) return;
    const conns = await prisma.marketplaceConnection.findMany({
      where: {
        kind: 'AWIN',
        encryptedCredentials: { not: null },
        tenant: { parentTenantId: null, active: true },
      },
      select: { tenantId: true, encryptedCredentials: true },
    });
    for (const c of conns) {
      try {
        const creds = decryptJson<AwinCredentials>(Buffer.from(c.encryptedCredentials!));
        if (!creds.publisherId || !creds.offersApiToken) continue;
      } catch (err) {
        log.warn({ tenantId: c.tenantId, err: String(err) }, 'credenciais Awin ilegíveis');
        continue;
      }
      await this.enqueue(c.tenantId);
    }
    this.lastDayKey = dayKey;
  }
}
