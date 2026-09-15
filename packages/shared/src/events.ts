import type { WaSessionStatus, BatchItemStatus, MirrorLogStatus } from './enums';

export type RealtimeEvent =
  | { type: 'wa.qr'; sessionId: string; qr: string }
  | { type: 'wa.pair-code'; sessionId: string; code: string }
  | { type: 'wa.status'; sessionId: string; status: WaSessionStatus; phone?: string }
  | { type: 'wa.groups.synced'; sessionId: string; count: number }
  | { type: 'batch.progress'; batchId: string; sent: number; total: number; estimatedEndAt: string }
  | { type: 'batch.item'; batchId: string; itemId: string; status: BatchItemStatus; error?: string }
  | {
      type: 'mirror.log';
      ruleId: string;
      logId: string;
      status: MirrorLogStatus;
      reason?: string;
      targetJid: string;
    }
  | { type: 'mirror.rules.changed' }
  | { type: 'product.enriched'; productId: string; status: 'SUCCESS' | 'ERROR'; error?: string }
  | { type: 'queue.updated' }
  | { type: 'error'; code: string; message: string };

export const REDIS_EVENTS_CHANNEL = 'afilados:events';
