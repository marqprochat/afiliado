import { describe, it, expect } from 'vitest';
import { planBatchOrder, type BatchPosition } from '../src/batch-position';

describe('planBatchOrder', () => {
  const pending = ['p1', 'p2', 'p3'];
  const incoming = ['in1', 'in2'];

  it('start: coloca os novos antes dos pendentes, preservando ordem interna', () => {
    const result = planBatchOrder(pending, incoming, 'start');
    expect(result).toEqual(['in1', 'in2', 'p1', 'p2', 'p3']);
  });

  it('end: coloca os novos depois dos pendentes, preservando ordem interna', () => {
    const result = planBatchOrder(pending, incoming, 'end');
    expect(result).toEqual(['p1', 'p2', 'p3', 'in1', 'in2']);
  });

  describe('shuffle', () => {
    it('mantém todos os itens e preserva a ordem relativa dos pendentes', () => {
      // Simula RNG para shuffle não-trivial
      let seed = 42;
      const rng = () => {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
      };

      const result = planBatchOrder(pending, incoming, 'shuffle', (x) => x, rng);

      // 1. Quantidade total e presença de todos os itens
      expect(result).toHaveLength(pending.length + incoming.length);
      expect(new Set(result)).toEqual(new Set([...pending, ...incoming]));

      // 2. Ordem relativa dos pendentes deve ser estritamente preservada
      const pendingInResult = result.filter((x) => pending.includes(x));
      expect(pendingInResult).toEqual(pending);
    });

    it('é determinístico com rng fixo', () => {
      const rng1 = () => 0.5;
      const rng2 = () => 0.5;
      const r1 = planBatchOrder(pending, incoming, 'shuffle', (x) => x, rng1);
      const r2 = planBatchOrder(pending, incoming, 'shuffle', (x) => x, rng2);
      expect(r1).toEqual(r2);
    });

    it('quando pending está vazio (ex.: lote concluído), resultado são os novos embaralhados', () => {
      const result = planBatchOrder([], incoming, 'shuffle');
      expect(result).toHaveLength(incoming.length);
      expect(new Set(result)).toEqual(new Set(incoming));
    });
  });

  it('quando incoming está vazio, devolve cópia dos pendentes inalterada', () => {
    for (const pos of ['start', 'end', 'shuffle'] as BatchPosition[]) {
      const result = planBatchOrder(pending, [], pos);
      expect(result).toEqual(pending);
      expect(result).not.toBe(pending);
    }
  });

  it('quando pending está vazio e position é start ou end, devolve os novos', () => {
    expect(planBatchOrder([], incoming, 'start')).toEqual(incoming);
    expect(planBatchOrder([], incoming, 'end')).toEqual(incoming);
  });

  it('não muta os arrays de entrada', () => {
    const pCopy = [...pending];
    const inCopy = [...incoming];
    planBatchOrder(pending, incoming, 'start');
    planBatchOrder(pending, incoming, 'end');
    planBatchOrder(pending, incoming, 'shuffle');
    expect(pending).toEqual(pCopy);
    expect(incoming).toEqual(inCopy);
  });
});
