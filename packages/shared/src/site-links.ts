import { z } from 'zod';

/** Chave em `Setting`: liga a troca do link da loja pelo link da página da oferta no site. */
export const SITE_LINKS_KEY = 'siteLinks';

export const siteLinksUpdateSchema = z.object({ enabled: z.boolean() });
export type SiteLinksSetting = z.infer<typeof siteLinksUpdateSchema>;

/** Valor gravado em `Setting.value`; ausente ou malformado = desligado. */
export function siteLinksEnabled(value: unknown): boolean {
  return (
    typeof value === 'object' && value !== null && (value as { enabled?: unknown }).enabled === true
  );
}
