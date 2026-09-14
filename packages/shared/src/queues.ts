export const QUEUE_WA_COMMANDS = 'wa-commands';
export const QUEUE_SEND_OFFER = 'send-offer';

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
