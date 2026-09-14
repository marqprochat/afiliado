import type { TenantClient, OperatingWindow } from '@afilados/db';

export interface Settings {
  queueLimit: number;
  globalRateLimitPerMin: number;
  subIdPattern: string;
}

export const SETTINGS_DEFAULTS: Settings = {
  queueLimit: 500,
  globalRateLimitPerMin: 6,
  subIdPattern: '{yyyyMMdd}-{batchId}',
};

export async function getSettings(db: TenantClient): Promise<Settings> {
  const rows = await db.setting.findMany();
  const out: Settings = { ...SETTINGS_DEFAULTS };
  for (const r of rows) {
    if (r.key in out) (out as unknown as Record<string, unknown>)[r.key] = r.value;
  }
  return out;
}

export async function setSetting(
  db: TenantClient,
  tenantId: string,
  key: keyof Settings,
  value: unknown,
) {
  await db.setting.upsert({
    where: { tenantId_key: { tenantId, key } },
    update: { value: value as object },
    // @ts-expect-error tenantId é injetado pela extensão forTenant
    create: { key, value: value as object },
  });
}

export async function getOperatingWindow(
  db: TenantClient,
  tenantId: string,
): Promise<OperatingWindow> {
  const existing = await db.operatingWindow.findFirst({ where: { tenantId } });
  if (existing) return existing;
  // @ts-expect-error tenantId é injetado pela extensão forTenant
  return db.operatingWindow.create({ data: {} });
}

export function toCoreWindow(w: OperatingWindow) {
  return { startTime: w.startTime, endTime: w.endTime, timezone: w.timezone, enabled: w.enabled };
}
