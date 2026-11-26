import { randomInt } from 'node:crypto';

export type TrackChannelKind = 'WHATSAPP' | 'TELEGRAM';

export interface TrackChannelRef {
  kind: TrackChannelKind;
  /** WaGroup.id ou TelegramChat.id */
  id: string;
}

interface TrackCodeTable {
  findFirst(args: {
    where: { id: string };
    select: { trackCode: true };
  }): Promise<{ trackCode: string | null } | null>;
  updateMany(args: {
    where: { id: string; trackCode: null };
    data: { trackCode: string };
  }): Promise<{ count: number }>;
}

/** Subconjunto do PrismaClient usado aqui (o client global satisfaz este tipo). */
export interface TrackCodeDb {
  waGroup: TrackCodeTable;
  telegramChat: TrackCodeTable;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const MAX_ATTEMPTS = 8;

/** `w` (WhatsApp) / `t` (Telegram) + 5 alfanuméricos aleatórios, ex.: `wK7p2Q`. */
export function generateTrackCode(kind: TrackChannelKind): string {
  let out = kind === 'WHATSAPP' ? 'w' : 't';
  for (let i = 0; i < 5; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

function isUniqueConflict(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === 'P2002';
}

/**
 * Código de rastreio do canal, gerado na primeira vez que ele é usado (lazy) e reaproveitado
 * depois. Colisão no único `(tenantId, trackCode)` → tenta outro código. Se outro processo gravar
 * primeiro, devolve o código dele. Canal inexistente → `null`.
 */
export async function ensureTrackCode(
  db: TrackCodeDb,
  channel: TrackChannelRef,
): Promise<string | null> {
  const table: TrackCodeTable = channel.kind === 'WHATSAPP' ? db.waGroup : db.telegramChat;
  const read = () => table.findFirst({ where: { id: channel.id }, select: { trackCode: true } });
  const current = await read();
  if (!current) return null;
  if (current.trackCode) return current.trackCode;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const code = generateTrackCode(channel.kind);
    try {
      const { count } = await table.updateMany({
        where: { id: channel.id, trackCode: null },
        data: { trackCode: code },
      });
      if (count === 1) return code;
      // Outro processo gravou antes (ou o canal sumiu): usa o que estiver lá.
      return (await read())?.trackCode ?? null;
    } catch (err) {
      if (!isUniqueConflict(err)) throw err;
    }
  }
  throw new Error('não foi possível gerar um código de rastreio único para o canal');
}
