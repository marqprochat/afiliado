import { describe, it, expect } from 'vitest';
import { isWithinOperatingWindow, nextWindowOpen, type OperatingWindow } from '../src/window';

const w: OperatingWindow = {
  startTime: '07:30',
  endTime: '23:30',
  timezone: 'America/Sao_Paulo',
  enabled: true,
};
// São Paulo = UTC-3 (sem horário de verão desde 2019)
const sp = (s: string) => new Date(`${s}-03:00`);

describe('isWithinOperatingWindow', () => {
  it('dentro', () => expect(isWithinOperatingWindow(sp('2026-09-14T12:00:00'), w)).toBe(true));
  it('antes', () => expect(isWithinOperatingWindow(sp('2026-09-14T07:29:59'), w)).toBe(false));
  it('no início é dentro', () =>
    expect(isWithinOperatingWindow(sp('2026-09-14T07:30:00'), w)).toBe(true));
  it('no fim é fora', () =>
    expect(isWithinOperatingWindow(sp('2026-09-14T23:30:00'), w)).toBe(false));
  it('desabilitada = sempre dentro', () =>
    expect(isWithinOperatingWindow(sp('2026-09-14T03:00:00'), { ...w, enabled: false })).toBe(true));
  it('janela que cruza meia-noite', () => {
    const night = { ...w, startTime: '22:00', endTime: '02:00' };
    expect(isWithinOperatingWindow(sp('2026-09-14T23:00:00'), night)).toBe(true);
    expect(isWithinOperatingWindow(sp('2026-09-15T01:00:00'), night)).toBe(true);
    expect(isWithinOperatingWindow(sp('2026-09-15T03:00:00'), night)).toBe(false);
  });
});

describe('nextWindowOpen', () => {
  it('retorna now quando dentro', () => {
    const now = sp('2026-09-14T12:00:00');
    expect(nextWindowOpen(now, w)).toEqual(now);
  });
  it('antes da abertura → abertura de hoje', () => {
    expect(nextWindowOpen(sp('2026-09-14T05:00:00'), w)).toEqual(sp('2026-09-14T07:30:00'));
  });
  it('depois do fechamento → abertura de amanhã', () => {
    expect(nextWindowOpen(sp('2026-09-14T23:45:00'), w)).toEqual(sp('2026-09-15T07:30:00'));
  });
});
