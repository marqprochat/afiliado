import { DateTime } from 'luxon';

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
