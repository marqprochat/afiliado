import type { TenantClient } from '@afilados/db';
import {
  isWithinOperatingWindow,
  nextWindowOpen,
  scheduleBatch,
  type OperatingWindow,
} from '@afilados/core';
import { ApiError, type DispatchMode } from '@afilados/shared';
import { enqueueBatchItems } from './batches';

export interface DispatchTargetsInput {
  groupJids?: string[] | undefined;
  telegramChatIds?: string[] | undefined;
  templateId?: string | undefined;
}

/** Garante que grupos, chats do Telegram e template existem no tenant. */
export async function assertDispatchTargets(
  db: TenantClient,
  sessionId: string,
  t: DispatchTargetsInput,
) {
  if (t.groupJids) {
    const groups = await db.waGroup.findMany({
      where: { sessionId, jid: { in: t.groupJids } },
      select: { jid: true },
    });
    const known = new Set(groups.map((g) => g.jid));
    const unknown = t.groupJids.filter((j) => !known.has(j));
    if (unknown.length) throw ApiError.validation(`Grupos desconhecidos: ${unknown.join(', ')}`);
  }
  if (t.telegramChatIds?.length) {
    const chats = await db.telegramChat.findMany({
      where: { chatId: { in: t.telegramChatIds } },
      select: { chatId: true },
    });
    const knownChats = new Set(chats.map((c) => c.chatId));
    const unknownChats = t.telegramChatIds.filter((c) => !knownChats.has(c));
    if (unknownChats.length) {
      throw ApiError.validation(`Chats do Telegram desconhecidos: ${unknownChats.join(', ')}`);
    }
  }
  if (t.templateId) {
    const template = await db.template.findFirst({ where: { id: t.templateId } });
    if (!template) throw ApiError.notFound('Template não encontrado');
  }
}

/** Sessão do tenant e conectada; senão `NOT_FOUND` / `WA_NOT_CONNECTED`. */
export async function requireConnectedSession(db: TenantClient, sessionId: string) {
  const session = await db.waSession.findFirst({ where: { id: sessionId } });
  if (!session) throw ApiError.notFound('Sessão não encontrada');
  if (session.status !== 'CONNECTED') {
    throw new ApiError('WA_NOT_CONNECTED', 'WhatsApp não está conectado', 400);
  }
  return session;
}

/** "Cupons 30/09 14:05" — data/hora no fuso da janela de operação. */
export function dispatchBatchName(prefix: string, now: Date, timezone: string): string {
  const stamp = new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(now);
  return `${prefix} ${stamp.replace(',', '')}`;
}

export interface DispatchItemInput {
  couponId?: string;
  customText?: string;
  customImageUrl?: string;
  customImageData?: Buffer;
  customImageType?: string;
}

export interface CreateDispatchBatchArgs {
  db: TenantClient;
  tenantId: string;
  sessionId: string;
  templateId: string;
  name: string;
  groupJids: string[];
  telegramChatIds: string[];
  mode: DispatchMode;
  intervalMin: number;
  items: DispatchItemInput[];
  window: OperatingWindow;
  /** Mensagens por minuto (setting `globalRateLimitPerMin`); estima o fim do envio imediato. */
  ratePerMin?: number;
  now?: Date;
}

export interface DispatchBatchResult {
  batchId: string;
  name: string;
  itemCount: number;
  firstRunAt: Date;
}

/**
 * Cria o lote e enfileira os itens em `send-offer`.
 * `now`: todos os itens com `runAt = agora` (o worker aplica o rate limit); fora da janela de
 * operação, `runAt` é a próxima abertura, para a tela mostrar o horário real.
 * `queue`: horários de `scheduleBatch` (janela de operação + intervalo).
 */
export async function createDispatchBatch(
  args: CreateDispatchBatchArgs,
): Promise<DispatchBatchResult> {
  const { db, tenantId, items, mode } = args;
  const now = args.now ?? new Date();
  let schedule: { runAt: Date[]; estimatedEndAt: Date | null };
  if (mode === 'now') {
    const start = isWithinOperatingWindow(now, args.window) ? now : nextWindowOpen(now, args.window);
    const rate = args.ratePerMin && args.ratePerMin > 0 ? args.ratePerMin : 6;
    const minutes = Math.ceil((items.length * Math.max(args.groupJids.length, 1)) / rate);
    schedule = {
      runAt: items.map(() => start),
      estimatedEndAt: new Date(start.getTime() + minutes * 60_000),
    };
  } else {
    schedule = scheduleBatch(items.length, args.intervalMin, args.window, now);
  }

  const batch = await db.batch.create({
    data: {
      tenantId,
      sessionId: args.sessionId,
      templateId: args.templateId,
      name: args.name,
      groupJids: args.groupJids,
      telegramChatIds: args.telegramChatIds,
      intervalMin: mode === 'now' ? 1 : args.intervalMin,
      estimatedEndAt: schedule.estimatedEndAt,
      items: {
        create: items.map((it, i) => ({
          order: i,
          runAt: schedule.runAt[i]!,
          couponId: it.couponId ?? null,
          customText: it.customText ?? null,
          customImageUrl: it.customImageUrl ?? null,
          customImageData: it.customImageData ?? null,
          customImageType: it.customImageType ?? null,
        })),
      },
    },
    include: { items: { orderBy: { order: 'asc' } } },
  });

  try {
    await enqueueBatchItems(batch.items, tenantId, now);
  } catch {
    await db.batch.updateMany({ where: { id: batch.id }, data: { status: 'CANCELLED' } });
    await db.batchItem.updateMany({
      where: { id: { in: batch.items.map((i) => i.id) } },
      data: { status: 'ERROR', error: 'falha ao enfileirar' },
    });
    throw new ApiError('INTERNAL', 'Falha ao enfileirar lote', 500);
  }

  return {
    batchId: batch.id,
    name: batch.name,
    itemCount: batch.items.length,
    firstRunAt: schedule.runAt[0]!,
  };
}
