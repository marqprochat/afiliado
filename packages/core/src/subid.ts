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
  // A Shopee só aceita letras, números e underscore no sub_id (rejeita com
  // "Params Error : invalid sub id" caso contrário) — hífen incluso, e o padrão
  // padrão de configuração usa hífen. Qualquer caractere fora disso vira "_".
  return out
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);
}
