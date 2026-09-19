import type { WaSessionStatus, BatchItemStatus, MirrorLogStatus, MarketplaceKind } from './enums';

export type RealtimeEvent =
  | { type: 'wa.qr'; sessionId: string; qr: string }
  | { type: 'wa.pair-code'; sessionId: string; code: string }
  | { type: 'wa.status'; sessionId: string; status: WaSessionStatus; phone?: string }
  | { type: 'wa.groups.synced'; sessionId: string; count: number }
  | {
      type: 'wa.group.action';
      sessionId: string;
      action: 'create-group' | 'group-participants' | 'group-settings' | 'group-invite';
      ok: boolean;
      jid?: string;
      error?: string;
    }
  | {
      type: 'wa.group.details';
      sessionId: string;
      jid: string;
      ok: boolean;
      error?: string;
      subject?: string;
      description?: string | null;
      announceOnly?: boolean;
      inviteCode?: string | null;
      participants?: { jid: string; admin: 'admin' | 'superadmin' | null }[];
    }
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
  | { type: 'automation.rules.changed' }
  | { type: 'automation.queue.updated'; ruleId: string }
  | { type: 'product.enriched'; productId: string; status: 'SUCCESS' | 'ERROR'; error?: string }
  | { type: 'queue.updated' }
  | { type: 'marketplace.updated'; kind: MarketplaceKind }
  | { type: 'error'; code: string; message: string };

export const REDIS_EVENTS_CHANNEL = 'afilados:events';
