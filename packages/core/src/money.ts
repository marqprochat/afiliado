export function formatBRL(value: number): string {
  const fixed = value.toFixed(2); // "1234.50"
  const [intPart = '0', dec = '00'] = fixed.split('.');
  const withThousands = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `R$ ${withThousands},${dec}`;
}

export function discountLabel(pct?: number): string {
  if (!pct || pct <= 0) return '';
  return `-${Math.round(pct)}% OFF`;
}
