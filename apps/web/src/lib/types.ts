import type {
  MarketplaceKind,
  MediaMode,
  WaSessionStatus,
  BatchStatus,
  BatchItemStatus,
} from '@afilados/shared';

export interface Me {
  user: { id: string; email: string; name: string; role: string };
  tenant: { id: string; name: string };
}
export interface Settings {
  window: { startTime: string; endTime: string; timezone: string; enabled: boolean };
  queueLimit: number;
  globalRateLimitPerMin: number;
  subIdPattern: string;
}
export interface WaSession {
  id: string;
  label: string;
  phone: string | null;
  status: WaSessionStatus;
  lastQr: string | null;
  pairCode: string | null;
  lastSeenAt: string | null;
  createdAt: string;
}
export interface WaGroup {
  id: string;
  jid: string;
  name: string;
  kind: 'GROUP' | 'COMMUNITY' | 'CHANNEL';
  botIsAdmin: boolean;
  memberCount: number;
}
export interface MarketplaceConnection {
  kind: MarketplaceKind;
  status: 'UNCONFIGURED' | 'OK' | 'ERROR';
  affiliateTag: string | null;
  appId: string | null;
  hasSecret: boolean;
  mattWord: string | null;
  mattTool: string | null;
  /** Sessão do ML sincronizada (extensão ou colagem manual); gera link oficial meli.la. */
  mlSessionSyncedAt: string | null;
  mlSessionSource: 'extension' | 'manual' | null;
  /** Sessão da Amazon (SiteStripe) sincronizada; armazenada, sem geração de link nesta fase. */
  amazonSessionSyncedAt: string | null;
  amazonSessionSource: 'extension' | 'manual' | null;
  /** Sessão do Magazine Você sincronizada; armazenada, sem geração de link nesta fase. */
  magaluSessionSyncedAt: string | null;
  magaluSessionSource: 'extension' | 'manual' | null;
  lastCheckedAt: string | null;
  lastError: string | null;
}

export interface ApiProduct {
  id: string;
  source: string;
  externalId: string | null;
  title: string;
  price: number;
  originalPrice: number | null;
  discountPct: number | null;
  salesCount: number | null;
  commissionPct: number | null;
  images: string[];
  shipping: string;
  flashSaleEndsAt: string | null;
  couponCode: string | null;
  originalUrl: string;
  shopId: string | null;
  shopName: string | null;
  /** Metadados brutos; `pendingEnrich: true` enquanto o worker ainda raspa a página. */
  raw?: { pendingEnrich?: boolean } | null;
}
export interface QueueItem {
  id: string;
  productId: string;
  selected: boolean;
  status: 'PENDING' | 'PENDING_ENRICH' | 'SENT' | 'ERROR';
  addedAt: string;
  product: ApiProduct;
}
export interface QueueResponse {
  items: QueueItem[];
  limit: number;
  count: number;
}
export interface Template {
  id: string;
  name: string;
  body: string;
  isDefault: boolean;
}
export interface BatchSummary {
  id: string;
  name: string;
  status: BatchStatus;
  intervalMin: number;
  mediaMode: MediaMode;
  shuffled: boolean;
  groupJids: string[];
  estimatedEndAt: string | null;
  createdAt: string;
  total: number;
  sent: number;
  errors: number;
}
export interface BatchItem {
  id: string;
  order: number;
  runAt: string;
  status: BatchItemStatus;
  error: string | null;
  product: ApiProduct;
}
export interface BatchDetail extends Omit<BatchSummary, 'total' | 'sent' | 'errors'> {
  items: BatchItem[];
}
export interface Overview {
  wa: { id: string; label: string; status: WaSessionStatus; phone: string | null }[];
  shopee: 'UNCONFIGURED' | 'OK' | 'ERROR';
  queue: { count: number; limit: number };
  batches: {
    id: string;
    name: string;
    status: BatchStatus;
    estimatedEndAt: string | null;
    total: number;
    sent: number;
  }[];
  errors: { id: string; groupJid: string; error: string | null; sentAt: string }[];
}

export interface MirrorCounts {
  mirrored: number;
  discarded: number;
  error: number;
}

export interface MirrorRule {
  id: string;
  name: string;
  sessionId: string;
  sourceJids: string[];
  targetJids: string[];
  mode: 'TEMPLATE' | 'CLONE';
  mediaMode: MediaMode;
  templateId: string | null;
  dedupHours: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  session?: { id: string; label: string; status: WaSessionStatus };
  template?: { id: string; name: string } | null;
  counts?: MirrorCounts;
}

export interface MirrorLog {
  id: string;
  ruleId: string;
  sourceJid: string;
  sourceName?: string;
  sourceMsgId: string;
  targetJid: string;
  targetName?: string;
  status: 'MIRRORED' | 'DISCARDED' | 'ERROR';
  reason: string | null;
  productKey: string | null;
  waMessageId: string | null;
  createdAt: string;
  rule?: { id: string; name: string };
}

export interface MirrorStats {
  today: {
    mirrored: number;
    discarded: number;
    error: number;
  };
}

export interface ApiToken {
  id: string;
  name: string;
  tokenHint: string;
  lastUsedAt: string | null;
  createdAt: string;
  token?: string;
}
