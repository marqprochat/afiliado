import { Prisma, prisma } from '@afilados/db';
import { ApiError, METRICS_TIMEZONE, spDayKeysInRange } from '@afilados/shared';

/**
 * Instante para comparar com colunas DateTime do Prisma (`timestamp(3)` sem fuso, em UTC).
 * Converte explicitamente para não depender do TimeZone da sessão do Postgres.
 */
export function utc(d: Date): Prisma.Sql {
  return Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
}

/** Hora local de SP da coluna. `column` é sempre um literal do código, nunca entrada do usuário. */
export function localTs(column: string): Prisma.Sql {
  return Prisma.raw(`((${column}) AT TIME ZONE 'UTC') AT TIME ZONE '${METRICS_TIMEZONE}'`);
}

/** Dia local de SP (`YYYY-MM-DD`) da coluna. */
export function localDay(column: string): Prisma.Sql {
  return Prisma.raw(
    `to_char(((${column}) AT TIME ZONE 'UTC') AT TIME ZONE '${METRICS_TIMEZONE}', 'YYYY-MM-DD')`,
  );
}

/** `column >= from AND column < to`. */
export function inRange(column: string, from: Date, to: Date): Prisma.Sql {
  return Prisma.sql`${Prisma.raw(column)} >= ${utc(from)} AND ${Prisma.raw(column)} < ${utc(to)}`;
}

/** Percentual com 1 casa; 0 quando o denominador é 0. */
export function pct(num: number, den: number): number {
  return den === 0 ? 0 : Math.round((num / den) * 1000) / 10;
}

/** Uma linha por dia de SP em [from, to), preenchendo os dias sem dados. */
export function fillDays<T extends { date: string }>(
  from: Date,
  to: Date,
  rows: T[],
  empty: (date: string) => T,
): T[] {
  const byDay = new Map(rows.map((r) => [r.date, r]));
  return spDayKeysInRange(from, to).map((date) => byDay.get(date) ?? empty(date));
}

export async function assertGroupOfTenant(tenantId: string, groupJid?: string): Promise<void> {
  if (!groupJid) return;
  const group = await prisma.waGroup.findFirst({
    where: { tenantId, jid: groupJid },
    select: { id: true },
  });
  if (!group) throw ApiError.notFound('Grupo não encontrado');
}

/** Grupos monitorados (bot admin). O mesmo jid em duas sessões conta uma vez (maior contagem). */
export async function adminGroupsOf(
  tenantId: string,
  groupJid?: string,
): Promise<{ jid: string; name: string; memberCount: number }[]> {
  const rows = await prisma.waGroup.findMany({
    where: { tenantId, botIsAdmin: true, ...(groupJid ? { jid: groupJid } : {}) },
    select: { jid: true, name: true, memberCount: true },
    orderBy: { name: 'asc' },
  });
  const byJid = new Map<string, { jid: string; name: string; memberCount: number }>();
  for (const r of rows) {
    const prev = byJid.get(r.jid);
    if (!prev || r.memberCount > prev.memberCount) byJid.set(r.jid, r);
  }
  return [...byJid.values()];
}
