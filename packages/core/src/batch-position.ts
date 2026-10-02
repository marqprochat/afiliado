import { shuffleInterleaved } from './shuffle';

export type BatchPosition = 'shuffle' | 'start' | 'end';

/**
 * Planeja a ordem dos itens pendentes de um lote ao receber novos produtos.
 * - 'start': novos entram no início da fila de pendentes.
 * - 'end': novos entram no fim da fila de pendentes.
 * - 'shuffle': novos são embaralhados (interleaved por keyOf) e distribuídos
 *   em posições aleatórias entre os pendentes, PRESERVANDO a ordem relativa dos pendentes existentes.
 */
export function planBatchOrder<T>(
  pending: readonly T[],
  incoming: readonly T[],
  position: BatchPosition,
  keyOf: (t: T) => string = () => '',
  rng: () => number = Math.random,
): T[] {
  if (incoming.length === 0) return [...pending];
  if (pending.length === 0) {
    return position === 'shuffle' ? shuffleInterleaved([...incoming], keyOf, rng) : [...incoming];
  }

  if (position === 'start') {
    return [...incoming, ...pending];
  }

  if (position === 'end') {
    return [...pending, ...incoming];
  }

  if (position === 'shuffle') {
    // 1. Embaralha os novos (intercalando por keyOf, ex. marketplace)
    const shuffledIncoming = shuffleInterleaved([...incoming], keyOf, rng);

    // 2. Escolhe posições aleatórias para os novos entre os pendentes existentes,
    // preservando a ordem relativa de pending.
    const totalCount = pending.length + incoming.length;
    const allIndices = Array.from({ length: totalCount }, (_, i) => i);
    for (let i = allIndices.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [allIndices[i], allIndices[j]] = [allIndices[j]!, allIndices[i]!];
    }
    const incomingSlots = new Set(allIndices.slice(0, incoming.length));

    const result: T[] = new Array(totalCount);
    let pIdx = 0;
    let inIdx = 0;
    for (let i = 0; i < totalCount; i++) {
      if (incomingSlots.has(i)) {
        result[i] = shuffledIncoming[inIdx++]!;
      } else {
        result[i] = pending[pIdx++]!;
      }
    }
    return result;
  }

  throw new Error(`Posição inválida: ${position}`);
}
