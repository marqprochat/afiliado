import { describe, it, expect } from 'vitest';
import { eligibleBatches } from '@/lib/batch-target';
import type { BatchSummary } from '@/lib/types';

describe('eligibleBatches', () => {
  const makeBatch = (id: string, name: string, status: BatchSummary['status'], total = 10, sent = 2, errors = 1): BatchSummary => ({
    id,
    name,
    status,
    intervalMin: 5,
    mediaMode: 'IMAGE',
    shuffled: false,
    groupJids: ['g1@g.us'],
    telegramChatIds: [],
    estimatedEndAt: null,
    createdAt: '2026-10-02T10:00:00.000Z',
    total,
    sent,
    errors,
  });

  it('exclui lotes CANCELLED da lista', () => {
    const list: BatchSummary[] = [
      makeBatch('1', 'Lote 1', 'RUNNING'),
      makeBatch('2', 'Lote Cancelado', 'CANCELLED'),
      makeBatch('3', 'Lote 3', 'PAUSED'),
    ];

    const result = eligibleBatches(list);
    expect(result.map((b) => b.id)).toEqual(['1', '3']);
  });

  it('calcula pending = total - sent - errors para cada lote', () => {
    const list: BatchSummary[] = [
      makeBatch('1', 'Lote 1', 'RUNNING', 10, 3, 2),
      makeBatch('2', 'Lote Concluído', 'DONE', 5, 5, 0),
    ];

    const result = eligibleBatches(list);
    expect(result[0]?.pending).toBe(5);
    expect(result[1]?.pending).toBe(0);
  });

  it('ordena lotes em andamento/pausados antes de concluídos (DONE)', () => {
    const list: BatchSummary[] = [
      makeBatch('1', 'Lote Concluído 1', 'DONE'),
      makeBatch('2', 'Lote Pausado', 'PAUSED'),
      makeBatch('3', 'Lote Concluído 2', 'DONE'),
      makeBatch('4', 'Lote Rodando', 'RUNNING'),
      makeBatch('5', 'Lote Agendado', 'SCHEDULED'),
    ];

    const result = eligibleBatches(list);
    expect(result.map((b) => b.id)).toEqual(['2', '4', '5', '1', '3']);
    expect(result.map((b) => b.status)).toEqual(['PAUSED', 'RUNNING', 'SCHEDULED', 'DONE', 'DONE']);
  });

  it('retorna array vazio quando não há lotes ou todos são CANCELLED', () => {
    expect(eligibleBatches([])).toEqual([]);
    expect(eligibleBatches([makeBatch('1', 'Cancelado', 'CANCELLED')])).toEqual([]);
  });
});
