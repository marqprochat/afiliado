import pino from 'pino';
import { prisma } from '@afilados/db';
import { enqueueCouponSync } from '../lib/queue-helpers';

const log = pino({ name: 'coupon-sync-scheduler' });
const DEFAULT_INTERVAL_HOURS = 6;
const parsedIntervalHours = Number(
  process.env.COUPON_SYNC_INTERVAL_HOURS ?? DEFAULT_INTERVAL_HOURS,
);
const INTERVAL_MS =
  (Number.isFinite(parsedIntervalHours) && parsedIntervalHours > 0
    ? parsedIntervalHours
    : DEFAULT_INTERVAL_HOURS) *
  60 *
  60 *
  1000;

export interface CouponSyncSchedulerDeps {
  enqueue?: (tenantId: string) => Promise<void>;
}

export class CouponSyncScheduler {
  private timer: NodeJS.Timeout | null = null;
  private readonly enqueue: (tenantId: string) => Promise<void>;

  constructor(deps: CouponSyncSchedulerDeps = {}) {
    this.enqueue = deps.enqueue ?? enqueueCouponSync;
  }

  start() {
    void this.tick().catch((e) => log.error(e, 'falha no tick de sincronização de cupons'));
    this.timer = setInterval(() => {
      void this.tick().catch((e) => log.error(e, 'falha no tick de sincronização de cupons'));
    }, INTERVAL_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    const conns = await prisma.marketplaceConnection.findMany({
      where: {
        kind: { in: ['ALIEXPRESS', 'AWIN'] },
        encryptedCredentials: { not: null },
      },
      select: { tenantId: true },
    });

    const tenantIds = Array.from(new Set(conns.map((c) => c.tenantId)));
    for (const tenantId of tenantIds) {
      await this.enqueue(tenantId);
    }
  }
}
