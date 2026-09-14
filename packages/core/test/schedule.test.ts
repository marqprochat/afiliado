import { describe, it, expect } from 'vitest';
import { scheduleBatch } from '../src/schedule';
import type { OperatingWindow } from '../src/window';

const w: OperatingWindow = { startTime: '07:30', endTime: '23:30', timezone: 'America/Sao_Paulo', enabled: true };
const sp = (s: string) => new Date(`${s}-03:00`);

describe('scheduleBatch', () => {
  it('lote vazio', () => {
    expect(scheduleBatch(0, 10, w, sp('2026-09-14T12:00:00'))).toEqual({ runAt: [], estimatedEndAt: null });
  });

  it('espaça pelo intervalo dentro da janela', () => {
    const { runAt, estimatedEndAt } = scheduleBatch(3, 10, w, sp('2026-09-14T12:00:00'));
    expect(runAt).toEqual([sp('2026-09-14T12:00:00'), sp('2026-09-14T12:10:00'), sp('2026-09-14T12:20:00')]);
    expect(estimatedEndAt).toEqual(sp('2026-09-14T12:20:00'));
  });

  it('pula o período fechado (critério de aceite do spec)', () => {
    const { runAt } = scheduleBatch(2, 10, w, sp('2026-09-14T23:25:00'));
    expect(runAt).toEqual([sp('2026-09-14T23:25:00'), sp('2026-09-15T07:30:00')]);
  });

  it('começa na próxima abertura se criado fora da janela', () => {
    const { runAt } = scheduleBatch(1, 10, w, sp('2026-09-14T02:00:00'));
    expect(runAt).toEqual([sp('2026-09-14T07:30:00')]);
  });
});
