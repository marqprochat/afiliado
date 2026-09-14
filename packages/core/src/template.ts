import { DateTime } from 'luxon';
import type { ProductData, TemplateContext } from '@afilados/shared';
import { formatBRL, discountLabel } from './money';

export function flashSaleLabel(endsAt: string | undefined, nowIso: string): string {
  if (!endsAt) return '';
  const end = DateTime.fromISO(endsAt);
  const now = DateTime.fromISO(nowIso);
  const minutes = Math.floor(end.diff(now, 'minutes').minutes);
  if (minutes <= 0) return '';
  if (minutes < 60) return `⚡ Faltam ${minutes} minutos para expirar`;
  const hours = Math.floor(minutes / 60);
  return `⚡ Faltam ${hours}h${String(minutes % 60).padStart(2, '0')} para expirar`;
}

function buildVars(p: ProductData, ctx: TemplateContext): Record<string, string> {
  return {
    titulo: p.title,
    preco: formatBRL(p.price),
    preco_antigo: p.originalPrice ? formatBRL(p.originalPrice) : '',
    desconto: discountLabel(p.discountPct),
    vendas: p.salesCount !== undefined ? String(p.salesCount) : '',
    link: ctx.affiliateLink,
    cupom: p.couponCode ?? '',
    oferta_relampago: flashSaleLabel(p.flashSaleEndsAt, ctx.now),
    frete: p.shipping === 'FREE' ? 'Frete grátis' : p.shipping === 'FULL' ? 'Envio FULL' : '',
    frete_gratis: p.shipping === 'FREE' ? '🚚 FRETE GRÁTIS' : '',
    frete_full: p.shipping === 'FULL' ? '📦 ENVIO FULL' : '',
    cta: ctx.cta ?? '',
  };
}

const BLOCK_RE = /\{#(\w+)\}([\s\S]*?)\{\/\1\}/g;
const VAR_RE = /\{(\w+)\}/g;

/**
 * Renderiza o template do usuário.
 * - `{var}` → valor (string vazia se ausente).
 * - `{#var}...{/var}` → conteúdo só quando `var` não é vazio; se vazio e o bloco
 *   ocupava a linha inteira, a linha é removida.
 */
export function renderTemplate(body: string, product: ProductData, ctx: TemplateContext): string {
  const vars = buildVars(product, ctx);
  const withBlocks = body.replace(BLOCK_RE, (_m, name: string, inner: string) =>
    vars[name] ? inner : '',
  );
  const substituted = withBlocks.replace(VAR_RE, (m, name: string) => vars[name] ?? m);
  // Remove linhas que ficaram vazias por causa de bloco condicional
  const originalLines = body.split('\n');
  const outLines = substituted.split('\n');
  if (originalLines.length !== outLines.length) return substituted;
  return outLines
    .filter((line, i) => !(line.trim() === '' && /\{#\w+\}/.test(originalLines[i] ?? '')))
    .join('\n');
}
