interface TextParts {
  conversation?: string | null;
  extendedTextMessage?: { text?: string | null } | null;
  imageMessage?: { caption?: string | null } | null;
}

function unwrap(m: unknown): TextParts | null {
  if (!m || typeof m !== 'object') return null;
  const o = m as { message?: unknown } & TextParts;
  if ('message' in o) return (o.message as TextParts | null | undefined) ?? null;
  return o;
}

/** Texto útil de uma WAMessage: conversation → extendedTextMessage.text → imageMessage.caption. */
export function pickText(message: unknown): string {
  const m = unwrap(message);
  return (m?.conversation ?? m?.extendedTextMessage?.text ?? m?.imageMessage?.caption ?? '').trim();
}

export function hasImage(message: unknown): boolean {
  const m = unwrap(message);
  return Boolean(m?.imageMessage);
}
