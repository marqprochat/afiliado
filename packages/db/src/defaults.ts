export const DEFAULT_TEMPLATE = `🔥 *{titulo}*

{#preco_antigo}~De {preco_antigo}~{/preco_antigo}
💰 *Por {preco}* {desconto}
{#frete_gratis}{frete_gratis}{/frete_gratis}
{#cupom}🎟️ Cupom: *{cupom}*{/cupom}
{#oferta_relampago}{oferta_relampago}{/oferta_relampago}

👉 {link}`;

export const DEFAULT_SETTINGS: Record<string, unknown> = {
  globalRateLimitPerMin: 6,
  subIdPattern: '{yyyyMMdd}-{batchId}',
};
