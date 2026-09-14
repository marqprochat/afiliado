export interface TemplateContext {
  /** Link já convertido para a tag de afiliado. */
  affiliateLink: string;
  /** Frase de CTA sorteada (F4); vazio na F1. */
  cta?: string;
  /** Instante do disparo, ISO 8601 — usado por {oferta_relampago}. */
  now: string;
}
