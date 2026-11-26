import { forTenant, getParentTenantId, type AwinProgrammeStats } from '@afilados/db';
import { compareProgrammeStats } from '@afilados/marketplaces';
import type { AwinProgrammeStatsItem } from '@afilados/shared';

const num = (v: { toString(): string } | null): number | null => {
  if (v === null) return null;
  const n = Number(v.toString());
  return Number.isFinite(n) ? n : null;
};

export function toAwinProgrammeStatsItem(row: AwinProgrammeStats): AwinProgrammeStatsItem {
  return {
    advertiserId: row.advertiserId,
    name: row.name,
    logoUrl: row.logoUrl,
    displayUrl: row.displayUrl,
    currency: row.currency,
    epc: num(row.epc),
    conversionRate: num(row.conversionRate),
    approvalPercentage: num(row.approvalPercentage),
    averagePaymentTime: row.averagePaymentTime,
    validationDays: row.validationDays,
    awinIndex: num(row.awinIndex),
    commissionMin: num(row.commissionMin),
    commissionMax: num(row.commissionMax),
    commissionType: row.commissionType,
    score: num(row.score),
    fetchedAt: row.fetchedAt.toISOString(),
  };
}

/**
 * Indicadores dos programas Awin do dono das credenciais (afiliados compartilham o publisher do
 * dono), já na ordem do ranking.
 */
export async function listAwinProgrammeStats(tenantId: string): Promise<AwinProgrammeStatsItem[]> {
  const ownerTenantId = (await getParentTenantId(tenantId)) ?? tenantId;
  const rows = await forTenant(ownerTenantId).awinProgrammeStats.findMany();
  return rows.sort(compareProgrammeStats).map(toAwinProgrammeStatsItem);
}
