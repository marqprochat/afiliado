import type { Job } from 'bullmq';
import { DelayedError } from 'bullmq';
import pino from 'pino';
import { prisma, decryptJson } from '@afilados/db';
import {
  extractStoreLinks,
  hasImage,
  isWithinOperatingWindow,
  nextWindowOpen,
  pickText,
  productKey,
  renderTemplate,
  rewriteLinks,
  generateSubId,
} from '@afilados/core';
import {
  getAdapter,
  type AnyAdapter,
  type MarketplaceAdapter,
  type ShopeeCredentials,
} from '@afilados/marketplaces';
import {
  hasTagCredentials,
  type MarketplaceKind,
  type MirrorMessageJob,
  type ProductData,
  type TagCredentials,
} from '@afilados/shared';

import { publishEvent } from '../lib/events';
import { getRedis } from '../lib/redis';
import { TokenBucket, jitter, waitForToken } from '../lib/rate-limit';
import type { OutgoingMessage, WhatsAppGateway } from '../wa/gateway';

const log = pino({ name: 'mirror-message' });

export interface MirrorMessageDeps {
  gateway: WhatsAppGateway;
  getAdapter?: (kind: MarketplaceKind) => AnyAdapter;
  downloadMedia?: (sessionId: string, message: unknown) => Promise<Buffer>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  rng?: () => number;
  bucketFor?: (sessionId: string, ratePerMin: number) => { take(): Promise<number> };
}

export type MirrorMessageResult =
  | { outcome: 'mirrored'; count: number }
  | { outcome: 'discarded'; reason: 'no-links' }
  | { outcome: 'skipped'; reason: 'rule-disabled' | 'missing' }
  | { outcome: 'rescheduled'; runAt: Date };

export async function mirrorMessage(
  deps: MirrorMessageDeps,
  jobData: MirrorMessageJob,
): Promise<MirrorMessageResult> {
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const rng = deps.rng ?? Math.random;
  const adapterGetter = deps.getAdapter ?? getAdapter;
  const downloadMedia =
    deps.downloadMedia ?? ((s: string, m: unknown) => deps.gateway.downloadMedia(s, m));
  const bucketFor =
    deps.bucketFor ??
    ((sessionId: string, rate: number) =>
      new TokenBucket(getRedis(), `wa:rate:${sessionId}`, rate));

  const rule = await prisma.mirrorRule.findUnique({
    where: { id: jobData.ruleId },
    include: { template: true },
  });
  if (!rule || !rule.enabled) return { outcome: 'skipped', reason: 'rule-disabled' };

  const tenantId = rule.tenantId;
  const text = pickText(jobData.message);
  const links = extractStoreLinks(text);

  if (links.length === 0) {
    for (const targetJid of rule.targetJids) {
      const logRow = await prisma.mirrorLog.create({
        data: {
          tenantId,
          ruleId: rule.id,
          sourceJid: jobData.sourceJid,
          sourceMsgId: jobData.msgId,
          targetJid,
          status: 'DISCARDED',
          reason: 'no-links',
        },
      });
      await publishEvent(tenantId, {
        type: 'mirror.log',
        ruleId: rule.id,
        logId: logRow.id,
        status: 'DISCARDED',
        reason: 'no-links',
        targetJid,
      });
    }
    return { outcome: 'discarded', reason: 'no-links' };
  }

  const [windowRow, settingsRows, connections] = await Promise.all([
    prisma.operatingWindow.findUnique({ where: { tenantId } }),
    prisma.setting.findMany({ where: { tenantId } }),
    prisma.marketplaceConnection.findMany({ where: { tenantId } }),
  ]);
  const settings = Object.fromEntries(settingsRows.map((s) => [s.key, s.value])) as Record<
    string,
    unknown
  >;
  const ratePerMin = Number(settings.globalRateLimitPerMin ?? 6);
  const window = windowRow
    ? {
        startTime: windowRow.startTime,
        endTime: windowRow.endTime,
        timezone: windowRow.timezone,
        enabled: windowRow.enabled,
      }
    : { startTime: '07:30', endTime: '23:30', timezone: 'America/Sao_Paulo', enabled: true };

  const t = now();
  if (!isWithinOperatingWindow(t, window)) {
    const runAt = nextWindowOpen(t, window);
    return { outcome: 'rescheduled', runAt };
  }

  const connMap = new Map(connections.map((c) => [c.kind, c]));
  const replacements = new Map<string, string>();
  const unsupportedStores = new Set<string>();

  for (const storeLink of links) {
    const kind = storeLink.parsed.source;
    const conn = connMap.get(kind);
    try {
      if (kind === 'SHOPEE') {
        if (conn?.encryptedCredentials) {
          const creds = decryptJson<ShopeeCredentials>(Buffer.from(conn.encryptedCredentials));
          const subId = generateSubId('{yyyyMMdd}-mirror-' + rule.id, {
            now: t,
            batchId: rule.id,
            timezone: window.timezone,
          });
          const adapter = adapterGetter('SHOPEE') as MarketplaceAdapter<ShopeeCredentials>;
          const affLink = await adapter.toAffiliateLink(creds, storeLink.url, subId);
          replacements.set(storeLink.url, affLink);
        } else {
          replacements.set(storeLink.url, storeLink.url);
          unsupportedStores.add('SHOPEE');
        }
      } else {
        if (conn?.encryptedCredentials) {
          const creds = decryptJson<TagCredentials>(Buffer.from(conn.encryptedCredentials));
          if (hasTagCredentials(kind, creds)) {
            const adapter = adapterGetter(kind) as MarketplaceAdapter<TagCredentials>;
            const affLink = await adapter.toAffiliateLink(creds, storeLink.url);
            replacements.set(storeLink.url, affLink);
          } else {
            replacements.set(storeLink.url, storeLink.url);
            unsupportedStores.add(kind);
          }
        } else {
          replacements.set(storeLink.url, storeLink.url);
          unsupportedStores.add(kind);
        }
      }
    } catch {
      replacements.set(storeLink.url, storeLink.url);
      unsupportedStores.add(kind);
    }
  }

  const prodKey = productKey(links[0]!.parsed);
  let effectiveMode: 'CLONE' | 'TEMPLATE' = 'CLONE';
  let fallbackReason: string | null = null;
  let templateProducts: { product: ProductData; convertedUrl: string }[] = [];

  let template = rule.template;
  if (rule.mode === 'TEMPLATE') {
    if (!template) {
      template =
        (await prisma.template.findFirst({ where: { tenantId, isDefault: true } })) ??
        (await prisma.template.findFirst({ where: { tenantId } }));
    }
    const allShopee = links.every((l) => l.parsed.source === 'SHOPEE');
    const shopeeConn = connMap.get('SHOPEE');
    if (allShopee && template && shopeeConn?.encryptedCredentials) {
      try {
        const creds = decryptJson<ShopeeCredentials>(Buffer.from(shopeeConn.encryptedCredentials));
        const adapter = adapterGetter('SHOPEE') as MarketplaceAdapter<ShopeeCredentials>;
        const fetched = await adapter.fetchByUrls(
          creds,
          links.map((l) => l.url),
        );

        if (fetched.length > 0) {
          effectiveMode = 'TEMPLATE';
          templateProducts = fetched.map((p) => ({
            product: p,
            convertedUrl: replacements.get(p.originalUrl) ?? p.originalUrl,
          }));
        } else {
          fallbackReason = 'template->clone';
        }
      } catch {
        fallbackReason = 'template->clone';
      }
    } else {
      fallbackReason = 'template->clone';
    }
  }

  const outgoingMessages: OutgoingMessage[] = [];
  if (effectiveMode === 'CLONE') {
    const newText = rewriteLinks(text, replacements);
    if (rule.mediaMode === 'IMAGE' && hasImage(jobData.message)) {
      const imageBuffer = await downloadMedia(jobData.sessionId, jobData.message);
      outgoingMessages.push({ kind: 'image', imageBuffer, caption: newText });
    } else {
      const firstLink = replacements.get(links[0]!.url) ?? links[0]!.url;
      outgoingMessages.push({
        kind: 'preview',
        text: newText,
        title: '',
        description: '',
        thumbnailUrl: '',
        url: firstLink,
      });
    }
  } else if (template) {
    for (const item of templateProducts) {
      const body = renderTemplate(template.body, item.product, {
        affiliateLink: item.convertedUrl,
        now: t.toISOString(),
      });
      const firstImg = item.product.images?.[0];
      if (rule.mediaMode === 'IMAGE' && firstImg) {
        outgoingMessages.push({ kind: 'image', imageUrl: firstImg, caption: body });
      } else {
        outgoingMessages.push({
          kind: 'preview',
          text: body,
          title: item.product.title,
          description: `R$ ${Number(item.product.price).toFixed(2).replace('.', ',')}`,
          thumbnailUrl: firstImg ?? '',
          url: item.convertedUrl,
        });
      }
    }
  }

  const bucket = bucketFor(rule.sessionId, ratePerMin);
  const dedupSince = new Date(t.getTime() - rule.dedupHours * 3600_000);
  let mirroredCount = 0;

  for (const targetJid of rule.targetJids) {
    // Dedup check
    const dup = await prisma.mirrorLog.findFirst({
      where: {
        tenantId,
        targetJid,
        productKey: prodKey,
        status: 'MIRRORED',
        createdAt: { gte: dedupSince },
      },
    });
    if (dup) {
      const logRow = await prisma.mirrorLog.create({
        data: {
          tenantId,
          ruleId: rule.id,
          sourceJid: jobData.sourceJid,
          sourceMsgId: jobData.msgId,
          targetJid,
          status: 'DISCARDED',
          reason: 'duplicate',
          productKey: prodKey,
        },
      });
      await publishEvent(tenantId, {
        type: 'mirror.log',
        ruleId: rule.id,
        logId: logRow.id,
        status: 'DISCARDED',
        reason: 'duplicate',
        targetJid,
      });
      continue;
    }

    await waitForToken(bucket, sleep);
    await sleep(jitter(2000, 0.15, rng));

    try {
      let lastMessageId: string | undefined;
      for (const msg of outgoingMessages) {
        const res = await deps.gateway.sendMessage(rule.sessionId, targetJid, msg);
        lastMessageId = res.messageId;
      }
      mirroredCount++;
      const reason =
        fallbackReason ??
        (unsupportedStores.size > 0
          ? `unsupported-store:${Array.from(unsupportedStores).join(',')}`
          : null);
      const logRow = await prisma.mirrorLog.create({
        data: {
          tenantId,
          ruleId: rule.id,
          sourceJid: jobData.sourceJid,
          sourceMsgId: jobData.msgId,
          targetJid,
          status: 'MIRRORED',
          reason,
          productKey: prodKey,
          waMessageId: lastMessageId ?? null,
        },
      });
      await publishEvent(tenantId, {
        type: 'mirror.log',
        ruleId: rule.id,
        logId: logRow.id,
        status: 'MIRRORED',
        ...(reason ? { reason } : {}),
        targetJid,
      });
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      log.warn({ ruleId: rule.id, targetJid, errorMsg }, 'falha ao espelhar mensagem');
      const logRow = await prisma.mirrorLog.create({
        data: {
          tenantId,
          ruleId: rule.id,
          sourceJid: jobData.sourceJid,
          sourceMsgId: jobData.msgId,
          targetJid,
          status: 'ERROR',
          reason: errorMsg,
          productKey: prodKey,
        },
      });
      await publishEvent(tenantId, {
        type: 'mirror.log',
        ruleId: rule.id,
        logId: logRow.id,
        status: 'ERROR',
        reason: errorMsg,
        targetJid,
      });
    }
  }

  return { outcome: 'mirrored', count: mirroredCount };
}

export function processMirrorMessage(deps: MirrorMessageDeps) {
  return async (job: Job<MirrorMessageJob>) => {
    const r = await mirrorMessage(deps, job.data);
    if (r.outcome === 'rescheduled') {
      const delay = Math.max(1_000, r.runAt.getTime() - Date.now());
      await job.moveToDelayed(Date.now() + delay, job.token);
      throw new DelayedError();
    }
  };
}
