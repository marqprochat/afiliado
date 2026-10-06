import type { TenantClient } from '@afilados/db';
import { mlLinksErrorKey, type MlLinkBatchError } from '@afilados/marketplaces';
import { QUEUE_ML_LINKS_PREWARM, type MlLinksPrewarmJob } from '@afilados/shared';
import { getQueue, getRedis } from './redis';

const ML_LINK_ERROR_READ_TIMEOUT_MS = 400;

/** Último erro do gerador de links em lote (método 1), gravado pelo worker; null quando não há. */
export async function readMlLinkBatchError(tenantId: string): Promise<MlLinkBatchError | null> {
  // O Redis da API enfileira comandos sem limite quando está fora do ar; o card do marketplace não
  // pode esperar por isso, então a leitura corre contra um timer curto.
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ML_LINK_ERROR_READ_TIMEOUT_MS);
  });
  const raw = await Promise.race([
    getRedis()
      .get(mlLinksErrorKey(tenantId))
      .catch(() => null),
    timeout,
  ]).finally(() => clearTimeout(timer));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MlLinkBatchError;
  } catch {
    return null;
  }
}

/**
 * Pede ao worker para gerar antecipadamente os links meli.la dos produtos do ML (quando salvos na
 * fila ou levados a um lote), para o envio já encontrá-los prontos. Devolve quantas URLs foram pedidas.
 */
export async function enqueueMlLinksPrewarm(
  db: TenantClient,
  tenantId: string,
  productIds: string[],
): Promise<number> {
  if (productIds.length === 0) return 0;
  const products = await db.product.findMany({
    where: { id: { in: productIds }, source: 'MERCADOLIVRE' },
    select: { originalUrl: true },
  });
  const urls = [...new Set(products.map((p) => p.originalUrl))];
  if (urls.length === 0) return 0;
  await getQueue<MlLinksPrewarmJob>(QUEUE_ML_LINKS_PREWARM).add(
    'prewarm',
    { tenantId, urls },
    { attempts: 1, removeOnComplete: true, removeOnFail: 50 },
  );
  return urls.length;
}
