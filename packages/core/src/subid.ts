import { DateTime } from 'luxon';
import type { TagCredentials } from '@afilados/shared';

export interface SubIdContext {
  now: Date;
  batchId?: string;
  groupJid?: string;
  timezone?: string;
}

export function generateSubId(pattern: string, ctx: SubIdContext): string {
  const d = DateTime.fromJSDate(ctx.now, { zone: ctx.timezone ?? 'America/Sao_Paulo' });
  const out = pattern
    .replaceAll('{yyyyMMdd}', d.toFormat('yyyyLLdd'))
    .replaceAll('{HHmm}', d.toFormat('HHmm'))
    .replaceAll('{batchId}', ctx.batchId ?? '')
    .replaceAll('{group}', ctx.groupJid ?? '');
  // A Shopee só aceita letras e números no sub_id — nem hífen nem underscore (testado
  // contra a API real: ambos disparam "error [11001]: Params Error : invalid sub id",
  // mesmo alfanumérico puro funcionando sem erro). Qualquer outro caractere é removido.
  return out.replace(/[^A-Za-z0-9]/g, '').slice(0, 50);
}

/** Mesma regra do generateSubId: a Shopee só aceita letras e números (máx. 50). */
export function sanitizeSubId(raw: string | null | undefined): string {
  return (raw ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 50);
}

export interface LinkSubIds {
  subId: string;
  extraSubIds: string[];
}

/**
 * SubIDs de um link gerado por API. Com identificador de afiliado: Shopee leva ele + o padrão
 * data/lote; AliExpress/Awin levam só ele. Sem identificador: comportamento antigo (só o padrão).
 *
 * `patternSubId` deve vir de `generateSubId`, que já o devolve sanitizado; aqui só o identificador
 * do afiliado é sanitizado.
 */
export function composeLinkSubIds(
  kind: 'SHOPEE' | 'ALIEXPRESS' | 'AWIN',
  affiliateSubId: string | null | undefined,
  patternSubId: string,
): LinkSubIds {
  const aff = sanitizeSubId(affiliateSubId);
  if (!aff) return { subId: patternSubId, extraSubIds: [] };
  if (kind === 'SHOPEE' && patternSubId) return { subId: aff, extraSubIds: [patternSubId] };
  return { subId: aff, extraSubIds: [] };
}

/** Amazon/ML/Magalu: o identificador do afiliado vira a `tag` (tracking ID, etiqueta ou loja). */
export function applyAffiliateTag(
  creds: TagCredentials,
  affiliateTag: string | null | undefined,
): TagCredentials {
  const tag = affiliateTag?.trim();
  return tag ? { ...creds, tag } : creds;
}
