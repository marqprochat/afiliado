import type { Prisma } from '@prisma/client';
import { prisma } from './client';

export type AffiliateSaleStatusValue = 'PENDING' | 'APPROVED' | 'DECLINED' | 'DELETED';
export type AffiliateSaleSourceValue = 'API' | 'WEBHOOK';

/** Venda já normalizada (ex.: `mapAwinTransaction` em @afilados/marketplaces). */
export interface AffiliateSaleInput {
  externalId: string;
  advertiserId: string;
  advertiserName: string | null;
  saleAmount: number;
  commissionAmount: number;
  currency: string;
  status: AffiliateSaleStatusValue;
  transactionDate: Date;
  validationDate: Date | null;
  clickRef: string | null;
  clickRef2: string | null;
  clickRef3: string | null;
  clickRef4: string | null;
  clickRef5: string | null;
  clickRef6: string | null;
  raw: unknown;
}

export interface ResolvedSaleChannel {
  kind: 'WHATSAPP' | 'TELEGRAM';
  id: string;
  name: string;
}

/** `trackCode` (clickRef2) → grupo do WhatsApp ou chat do Telegram do tenant. */
export async function resolveChannelByTrackCode(
  tenantId: string,
  trackCode: string | null | undefined,
): Promise<ResolvedSaleChannel | null> {
  const code = trackCode?.trim();
  if (!code) return null;
  const group = await prisma.waGroup.findFirst({
    where: { tenantId, trackCode: code },
    select: { id: true, name: true },
  });
  if (group) return { kind: 'WHATSAPP', id: group.id, name: group.name };
  const chat = await prisma.telegramChat.findFirst({
    where: { tenantId, trackCode: code },
    select: { id: true, title: true },
  });
  if (chat) return { kind: 'TELEGRAM', id: chat.id, name: chat.title };
  return null;
}

function cleanRef(v: string | null): string | null {
  const s = v?.replace(/[^A-Za-z0-9]/g, '').slice(0, 50);
  return s ? s : null;
}

/**
 * Grava a venda de forma idempotente em `(tenantId, network, externalId)`: a segunda chegada (sync
 * ou webhook) atualiza status, valores e validação. O canal só é preenchido quando resolvido —
 * nunca apaga uma atribuição já feita.
 */
export async function upsertAffiliateSale(
  tenantId: string,
  input: AffiliateSaleInput,
  source: AffiliateSaleSourceValue,
  network: 'AWIN' = 'AWIN',
): Promise<'created' | 'updated'> {
  const channel = await resolveChannelByTrackCode(tenantId, input.clickRef2);
  const batchId = cleanRef(input.clickRef3);
  const where = {
    tenantId_network_externalId: { tenantId, network, externalId: input.externalId },
  };
  const existing = await prisma.affiliateSale.findUnique({ where, select: { id: true } });

  const data = {
    advertiserId: input.advertiserId,
    advertiserName: input.advertiserName,
    saleAmount: input.saleAmount,
    commissionAmount: input.commissionAmount,
    currency: input.currency,
    status: input.status,
    transactionDate: input.transactionDate,
    validationDate: input.validationDate,
    source,
    raw: (input.raw ?? {}) as Prisma.InputJsonValue,
  };
  const refs = {
    clickRef: input.clickRef,
    clickRef2: input.clickRef2,
    clickRef3: input.clickRef3,
    clickRef4: input.clickRef4,
    clickRef5: input.clickRef5,
    clickRef6: input.clickRef6,
  };
  const channelData = channel
    ? { channelKind: channel.kind, channelId: channel.id, channelName: channel.name }
    : {};

  if (existing) {
    // Refs ausentes na atualização (ex.: webhook achatado) não apagam as já gravadas.
    const presentRefs = Object.fromEntries(Object.entries(refs).filter(([, v]) => v !== null));
    await prisma.affiliateSale.update({
      where: { id: existing.id },
      data: {
        ...data,
        ...presentRefs,
        ...channelData,
        ...(batchId ? { batchId } : {}),
      },
    });
    return 'updated';
  }
  try {
    await prisma.affiliateSale.create({
      data: {
        tenantId,
        network,
        externalId: input.externalId,
        ...data,
        ...refs,
        ...channelData,
        batchId,
      },
    });
    return 'created';
  } catch (err) {
    // Corrida entre webhook e sync: o outro criou primeiro → vira atualização.
    if ((err as { code?: unknown } | null)?.code !== 'P2002') throw err;
    return upsertAffiliateSale(tenantId, input, source, network);
  }
}
