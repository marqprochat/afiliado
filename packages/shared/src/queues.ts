export const QUEUE_WA_COMMANDS = 'wa-commands';
export const QUEUE_SEND_OFFER = 'send-offer';
export const QUEUE_MIRROR_MESSAGE = 'mirror-message';

export type WaCommand = 'connect' | 'disconnect' | 'logout' | 'sync-groups';

export interface WaCommandJob {
  tenantId: string;
  sessionId: string;
  command: WaCommand;
  mode?: 'qr' | 'pair';
  phone?: string;
}

export interface SendOfferJob {
  tenantId: string;
  batchItemId: string;
}

export interface MirrorMessageJob {
  tenantId: string;
  ruleId: string;
  sessionId: string;
  sourceJid: string;
  msgId: string;
  /** WAMessage serializado com BufferJSON.replacer */
  message: unknown;
}
