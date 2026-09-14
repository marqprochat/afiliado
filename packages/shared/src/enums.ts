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
