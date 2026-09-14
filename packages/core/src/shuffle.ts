function shuffleInPlace<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

/**
 * Embaralha cada fonte e depois intercala em round-robin,
 * evitando blocos monotemáticos (ex.: 10 Shopee seguidos).
 */
export function shuffleInterleaved<T>(
  items: T[],
  keyOf: (t: T) => string,
  rng: () => number = Math.random,
): T[] {
  const buckets = new Map<string, T[]>();
  for (const it of items) {
    const k = keyOf(it);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(it);
  }
  const queues = shuffleInPlace(
    [...buckets.values()].map((b) => shuffleInPlace(b, rng)),
    rng,
  );
  const out: T[] = [];
  while (out.length < items.length) {
    for (const q of queues) {
      const next = q.shift();
      if (next !== undefined) out.push(next);
    }
  }
  return out;
}
