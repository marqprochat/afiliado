export const MARKETPLACE_KINDS = ['SHOPEE', 'MERCADOLIVRE', 'AMAZON', 'MAGALU'] as const;
export type MarketplaceKind = (typeof MARKETPLACE_KINDS)[number];

export const PRODUCT_SOURCES = [...MARKETPLACE_KINDS, 'MANUAL'] as const;
export type ProductSource = (typeof PRODUCT_SOURCES)[number];

export const SHIPPINGS = ['NONE', 'FREE', 'FULL', 'UNKNOWN'] as const;
export type Shipping = (typeof SHIPPINGS)[number];

export const MEDIA_MODES = ['IMAGE', 'PREVIEW'] as const;
export type MediaMode = (typeof MEDIA_MODES)[number];

export const WA_SESSION_STATUSES = [
  'DISCONNECTED',
  'CONNECTING',
  'NEEDS_QR',
  'CONNECTED',
  'LOGGED_OUT',
] as const;
export type WaSessionStatus = (typeof WA_SESSION_STATUSES)[number];

export const BATCH_STATUSES = ['SCHEDULED', 'RUNNING', 'PAUSED', 'DONE', 'CANCELLED'] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

export const BATCH_ITEM_STATUSES = ['PENDING', 'SENDING', 'SENT', 'ERROR'] as const;
export type BatchItemStatus = (typeof BATCH_ITEM_STATUSES)[number];

export const MIRROR_MODES = ['TEMPLATE', 'CLONE'] as const;
export type MirrorMode = (typeof MIRROR_MODES)[number];

export const MIRROR_LOG_STATUSES = ['MIRRORED', 'DISCARDED', 'ERROR'] as const;
export type MirrorLogStatus = (typeof MIRROR_LOG_STATUSES)[number];

export const QUEUE_ITEM_STATUSES = ['PENDING', 'PENDING_ENRICH', 'SENT', 'ERROR'] as const;
export type QueueItemStatus = (typeof QUEUE_ITEM_STATUSES)[number];

export const TEMPLATE_KINDS = ['PRODUCT', 'COUPON'] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export const AUTOMATION_LOG_ACTIONS = ['DISCOVERED', 'DISPATCHED', 'SKIPPED', 'ERROR'] as const;
export type AutomationLogAction = (typeof AUTOMATION_LOG_ACTIONS)[number];

export const AUTOMATION_ITEM_KINDS = ['PRODUCT', 'COUPON'] as const;
export type AutomationItemKind = (typeof AUTOMATION_ITEM_KINDS)[number];

export const AUTOMATION_QUEUE_STATUSES = ['PENDING', 'DISPATCHED', 'REMOVED'] as const;
export type AutomationQueueStatus = (typeof AUTOMATION_QUEUE_STATUSES)[number];
