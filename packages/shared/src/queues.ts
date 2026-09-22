export const QUEUE_WA_COMMANDS = 'wa-commands';
export const QUEUE_SEND_OFFER = 'send-offer';
export const QUEUE_MIRROR_MESSAGE = 'mirror-message';
export const QUEUE_PRODUCT_ENRICH = 'product-enrich';
export const QUEUE_SEND_TELEGRAM = 'send-telegram';
export const QUEUE_AWIN_IMPORT = 'awin-import';

export type WaCommand =
  | 'connect'
  | 'disconnect'
  | 'logout'
  | 'sync-groups'
  | 'create-group'
  | 'group-participants'
  | 'group-settings'
  | 'group-invite'
  | 'group-details';

export type GroupParticipantAction = 'add' | 'remove' | 'promote' | 'demote';

export interface WaCommandJob {
  tenantId: string;
  sessionId: string;
  command: WaCommand;
  mode?: 'qr' | 'pair';
  phone?: string;
  /** create-group */
  groupSubject?: string;
  groupParticipants?: string[];
  /** group-participants | group-settings | group-invite | group-details */
  groupJid?: string;
  /** group-participants */
  participantAction?: GroupParticipantAction;
  /** group-settings */
  subject?: string;
  description?: string;
  announceOnly?: boolean;
  /** group-invite */
  revokeInvite?: boolean;
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

export interface ProductEnrichJob {
  tenantId: string;
  productId: string;
  url: string;
  marketplaceKind: 'SHOPEE' | 'MERCADOLIVRE' | 'AMAZON' | 'MAGALU';
}

export interface SendTelegramJob {
  tenantId: string;
  botId: string;
  chatId: string;
  templateId: string;
  productId?: string;
  couponId?: string;
}

export interface AwinImportJob {
  tenantId: string;
}

