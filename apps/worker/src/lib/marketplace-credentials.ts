import { prisma, decryptJson } from '@afilados/db';
import type { TagCredentials } from '@afilados/shared';
import type { AwinCredentials } from '@afilados/marketplaces';

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
  if (!creds.publisherId || !creds.datafeedApiKey || !creds.feedIds?.length) {
    throw new Error('AWIN: configure Publisher ID, Datafeed API Key e ao menos um Feed ID');
  }
  return creds as AwinCredentials;
}
