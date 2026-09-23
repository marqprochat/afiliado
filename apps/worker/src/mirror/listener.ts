import pino from 'pino';
import { prisma } from '@afilados/db';
import { QUEUE_MIRROR_MESSAGE, type MirrorMessageJob } from '@afilados/shared';
import { getQueue } from '../lib/redis';
import type { IncomingGroupMessage, WhatsAppGateway } from '../wa/gateway';

const log = pino({ name: 'mirror-listener' });

interface QueueLike {
  add(
    name: string,
    data: MirrorMessageJob,
    opts: { jobId: string; attempts: number; backoff: { type: string; delay: number } },
  ): Promise<unknown>;
}

export class MirrorListener {
  private cache = new Map<string, Map<string, { id: string; tenantId: string }[]>>();
  private readonly queue: QueueLike;

  constructor(
    private readonly gateway: Pick<WhatsAppGateway, 'onMessage'>,
    deps: { queue?: QueueLike } = {},
  ) {
    this.queue = deps.queue ?? (getQueue<MirrorMessageJob>(QUEUE_MIRROR_MESSAGE) as QueueLike);
  }

  async start() {
    await this.reload();
    this.gateway.onMessage((m) => {
      void this.handle(m).catch((e) => log.error(e, 'falha ao processar mensagem recebida'));
    });
  }

  async reload() {
    const rules = await prisma.mirrorRule.findMany({
      where: { enabled: true },
      select: { id: true, tenantId: true, sessionId: true, sourceJids: true },
    });
    const next = new Map<string, Map<string, { id: string; tenantId: string }[]>>();
    for (const r of rules) {
      if (!next.has(r.sessionId)) next.set(r.sessionId, new Map());
      const bySession = next.get(r.sessionId)!;
      for (const jid of r.sourceJids) {
        if (!bySession.has(jid)) bySession.set(jid, []);
        bySession.get(jid)!.push({ id: r.id, tenantId: r.tenantId });
      }
    }
    this.cache = next;
  }

  ruleCount() {
    let n = 0;
    for (const bySession of this.cache.values())
      for (const rules of bySession.values()) n += rules.length;
    return n;
  }

  private async handle(m: IncomingGroupMessage) {
    const rules = this.cache.get(m.sessionId)?.get(m.sourceJid);
    if (!rules?.length) return;
    for (const rule of rules) {
      const job: MirrorMessageJob = {
        tenantId: rule.tenantId,
        ruleId: rule.id,
        sessionId: m.sessionId,
        sourceJid: m.sourceJid,
        msgId: m.msgId,
        message: m.message,
      };
      await this.queue.add('mirror-message', job, {
        // BullMQ rejeita Custom Id com ":" (reservado p/ jobs repetíveis, exige 3 partes) —
        // ids de mensagem do WhatsApp podem conter ":", então trocamos o separador e saneamos.
        jobId: `${rule.id}-${m.msgId}`.replace(/:/g, '_'),
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
      });
    }
  }
}
