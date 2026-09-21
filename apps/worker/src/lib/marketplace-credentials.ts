import { prisma, decryptJson } from '@afilados/db';
import type { TagCredentials } from '@afilados/shared';

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
  if (!row?.encryptedCredentials) return {};
  return decryptJson<TagCredentials>(Buffer.from(row.encryptedCredentials));
}
