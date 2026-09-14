import { describe, it, expect } from 'vitest';
import { shuffleInterleaved } from '../src/shuffle';

describe('shuffleInterleaved', () => {
  it('intercala fontes em round-robin', () => {
    const items = ['s1', 's2', 's3', 'm1', 'm2', 'a1'];
    const keyOf = (s: string) => s[0]!;
    const rng = () => 0; // determinístico: sem embaralhar dentro da fonte
    const out = shuffleInterleaved(items, keyOf, rng);
    expect(out).toHaveLength(6);
    expect(out.map(keyOf).slice(0, 3).sort()).toEqual(['a', 'm', 's']);
    expect(new Set(out)).toEqual(new Set(items));
  });
  it('fonte única mantém todos os itens', () => {
    const out = shuffleInterleaved(
      [1, 2, 3],
      () => 'x',
      () => 0.5,
    );
    expect(out.sort()).toEqual([1, 2, 3]);
  });
});
