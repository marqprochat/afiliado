import pino from 'pino';
import { prisma, type GroupMemberAction } from '@afilados/db';
import type { GroupParticipantsUpdateEvent, WhatsAppGateway } from '../wa/gateway';

const log = pino({ name: 'group-member-recorder' });

/** Parte do usuário do JID, sem domínio nem sufixo de dispositivo (`5511…:12@s.whatsapp.net` → `5511…`). */
function userOf(jid: string): string {
  return jid.split('@')[0]!.split(':')[0]!;
}

export function mapParticipantAction(
  action: string,
  participantJid: string,
  author?: string,
): GroupMemberAction | null {
  const byOther = !!author && userOf(author) !== userOf(participantJid);
  switch (action) {
    case 'add':
      return byOther ? 'ADDED' : 'JOIN';
    case 'remove':
      return byOther ? 'REMOVED' : 'LEAVE';
    case 'promote':
      return 'PROMOTED';
    case 'demote':
      return 'DEMOTED';
    default:
      return null;
  }
}

/** O socket pode retransmitir o mesmo evento: a chave agrupa por minuto. */
export function memberEventDedupeKey(e: {
  sessionId: string;
  groupJid: string;
  participantJid: string;
  action: GroupMemberAction;
  occurredAt: Date;
}): string {
  const minute = Math.floor(e.occurredAt.getTime() / 60_000);
  return `${e.sessionId}|${e.groupJid}|${e.participantJid}|${e.action}|${minute}`;
}

/** Grava `GroupMemberEvent` para grupos em que o bot é admin. */
export class GroupMemberRecorder {
  constructor(
    private readonly gateway: Pick<WhatsAppGateway, 'onGroupParticipants'>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  start() {
    this.gateway.onGroupParticipants((ev) => {
      void this.record(ev);
    });
  }

  /** Nunca lança: falha de banco é logada e engolida para não afetar o gateway Baileys. */
  async record(ev: GroupParticipantsUpdateEvent): Promise<number> {
    try {
      const group = await prisma.waGroup.findUnique({
        where: { sessionId_jid: { sessionId: ev.sessionId, jid: ev.jid } },
        select: { tenantId: true, botIsAdmin: true },
      });
      if (!group?.botIsAdmin) return 0;
      const occurredAt = this.now();
      const rows = ev.participants.flatMap((participantJid) => {
        const action = mapParticipantAction(ev.action, participantJid, ev.author);
        if (!action) return [];
        return [
          {
            tenantId: group.tenantId,
            sessionId: ev.sessionId,
            groupJid: ev.jid,
            participantJid,
            action,
            actorJid: ev.author ?? null,
            occurredAt,
            dedupeKey: memberEventDedupeKey({
              sessionId: ev.sessionId,
              groupJid: ev.jid,
              participantJid,
              action,
              occurredAt,
            }),
          },
        ];
      });
      if (rows.length === 0) return 0;
      const res = await prisma.groupMemberEvent.createMany({ data: rows, skipDuplicates: true });
      return res.count;
    } catch (err) {
      log.error({ err, sessionId: ev.sessionId, jid: ev.jid }, 'falha ao gravar GroupMemberEvent');
      return 0;
    }
  }
}
