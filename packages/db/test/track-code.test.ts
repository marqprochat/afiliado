import { describe, it, expect } from 'vitest';
import { ensureTrackCode, generateTrackCode, type TrackCodeDb } from '../src/track-code';

type Row = { id: string; tenantId: string; trackCode: string | null };

function fakeDb(rows: { wa?: Row[]; tg?: Row[] }, opts: { collideTimes?: number } = {}) {
  let collisions = opts.collideTimes ?? 0;
  const table = (list: Row[]) => ({
    async findFirst(args: { where: { id: string } }) {
      const r = list.find((x) => x.id === args.where.id);
      return r ? { ...r } : null;
    },
    async updateMany(args: {
      where: { id: string; trackCode: null };
      data: { trackCode: string };
    }) {
      if (collisions > 0) {
        collisions--;
        throw Object.assign(new Error('unique'), { code: 'P2002' });
      }
      const r = list.find((x) => x.id === args.where.id && x.trackCode === null);
      if (!r) return { count: 0 };
      r.trackCode = args.data.trackCode;
      return { count: 1 };
    },
  });
  const wa = rows.wa ?? [];
  const tg = rows.tg ?? [];
  return { db: { waGroup: table(wa), telegramChat: table(tg) } as unknown as TrackCodeDb, wa, tg };
}

describe('generateTrackCode', () => {
  it('prefixo w/t + 5 alfanuméricos', () => {
    expect(generateTrackCode('WHATSAPP')).toMatch(/^w[A-Za-z0-9]{5}$/);
    expect(generateTrackCode('TELEGRAM')).toMatch(/^t[A-Za-z0-9]{5}$/);
  });
});

describe('ensureTrackCode', () => {
  it('reaproveita o código existente', async () => {
    const { db } = fakeDb({ wa: [{ id: 'g1', tenantId: 't', trackCode: 'wAAAAA' }] });
    expect(await ensureTrackCode(db, { kind: 'WHATSAPP', id: 'g1' })).toBe('wAAAAA');
  });

  it('gera e grava na primeira vez (lazy)', async () => {
    const { db, tg } = fakeDb({ tg: [{ id: 'c1', tenantId: 't', trackCode: null }] });
    const code = await ensureTrackCode(db, { kind: 'TELEGRAM', id: 'c1' });
    expect(code).toMatch(/^t[A-Za-z0-9]{5}$/);
    expect(tg[0]!.trackCode).toBe(code);
    expect(await ensureTrackCode(db, { kind: 'TELEGRAM', id: 'c1' })).toBe(code);
  });

  it('tenta de novo quando o código colide (P2002)', async () => {
    const { db, wa } = fakeDb(
      { wa: [{ id: 'g1', tenantId: 't', trackCode: null }] },
      { collideTimes: 2 },
    );
    const code = await ensureTrackCode(db, { kind: 'WHATSAPP', id: 'g1' });
    expect(code).toMatch(/^w[A-Za-z0-9]{5}$/);
    expect(wa[0]!.trackCode).toBe(code);
  });

  it('canal inexistente → null', async () => {
    const { db } = fakeDb({});
    expect(await ensureTrackCode(db, { kind: 'WHATSAPP', id: 'nada' })).toBeNull();
  });
});
