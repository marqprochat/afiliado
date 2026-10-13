import { Prisma, prisma } from '@afilados/db';
import type { MetricsProducts, MetricsQuery } from '@afilados/shared';
import { inRange } from './common';

export async function getProductsMetrics(
  tenantId: string,
  q: MetricsQuery,
): Promise<MetricsProducts> {
  const from = Prisma.sql`
    FROM "SendLog" s
    JOIN "BatchItem" bi ON bi."id" = s."batchItemId"
    JOIN "Product" p ON p."id" = bi."productId"`;
  const where = Prisma.sql`s."tenantId" = ${tenantId} AND p."tenantId" = ${tenantId}
    AND s."status" = 'SENT' AND ${inRange('s."sentAt"', q.from, q.to)}${
      q.groupJid ? Prisma.sql` AND s."groupJid" = ${q.groupJid}` : Prisma.empty
    }`;
  const [top, byMarketplace] = await Promise.all([
    prisma.$queryRaw<MetricsProducts['top']>`
      SELECT p."id" AS "productId", p."title" AS title, p."source"::text AS source,
             p."images"[1] AS image, COUNT(*)::int AS sends
      ${from} WHERE ${where}
      GROUP BY p."id" ORDER BY sends DESC, p."title" ASC LIMIT 10`,
    prisma.$queryRaw<MetricsProducts['byMarketplace']>`
      SELECT p."source"::text AS source, COUNT(*)::int AS sends
      ${from} WHERE ${where}
      GROUP BY 1 ORDER BY 2 DESC, 1 ASC`,
  ]);
  return { top, byMarketplace };
}
