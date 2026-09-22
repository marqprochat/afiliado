import { prisma, decryptJson } from '@afilados/db';
import type { TagCredentials } from '@afilados/shared';
import type { AliexpressCredentials, AwinCredentials } from '@afilados/marketplaces';

/**
 * Carrega e decripta as credenciais de um marketplace por tag (ML/Amazon/Magalu) do tenant.
 * Só é preciso de verdade para a Amazon (Creators API) — Mercado Livre e Magalu continuam
 * raspando HTML por URL e não usam nada daqui, mas a função aceita os três por uniformidade.
 */
export async function loadTagCredentials(
  tenantId: string,
  kind: 'MERCADOLIVRE' | 'AMAZON' | 'MAGALU',
): Promise<TagCredentials> {
  const row = await prisma.marketplaceConnection.findFirst({ where: { tenantId, kind } });
  const creds = row?.encryptedCredentials
    ? decryptJson<TagCredentials>(Buffer.from(row.encryptedCredentials))
    : {};
  if (kind === 'AMAZON' && (!creds.amazonApi?.clientId || !creds.amazonApi?.clientSecret)) {
    throw new Error('AMAZON: configure Client ID/Secret da Creators API');
  }
  return creds;
}

export async function loadAwinCredentials(tenantId: string): Promise<AwinCredentials> {
  const row = await prisma.marketplaceConnection.findFirst({ where: { tenantId, kind: 'AWIN' } });
  const creds = row?.encryptedCredentials
    ? decryptJson<AwinCredentials>(Buffer.from(row.encryptedCredentials))
    : ({} as Partial<AwinCredentials>);
  if (!creds.feedListUrl) {
    throw new Error('AWIN: configure o link da lista de feeds');
  }
  return { feedListUrl: creds.feedListUrl, feedIds: creds.feedIds ?? [] };
}

export async function loadAliexpressCredentials(tenantId: string): Promise<AliexpressCredentials> {
  const row = await prisma.marketplaceConnection.findFirst({ where: { tenantId, kind: 'ALIEXPRESS' } });
  const creds = row?.encryptedCredentials
    ? decryptJson<AliexpressCredentials>(Buffer.from(row.encryptedCredentials))
    : ({} as Partial<AliexpressCredentials>);
  if (!creds.appKey || !creds.appSecret || !creds.trackingId) {
    throw new Error('ALIEXPRESS: configure App Key, App Secret e Tracking ID');
  }
  return creds as AliexpressCredentials;
}
