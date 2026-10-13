import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@afilados/db';
import {
  GroupMemberRecorder,
  mapParticipantAction,
  memberEventDedupeKey,
} from '../src/metrics/group-member-recorder';
import type { GroupParticipantsUpdateEvent } from '../src/wa/gateway';

const ADMIN_GROUP = 'rec-admin@g.us';
const COMMON_GROUP = 'rec-common@g.us';
const ADMIN = 'adm@s.whatsapp.net';
const NOW = new Date('2026-10-13T15:00:20Z');
let tenantId: string;
let sessionId: string;

class FakeGateway {
  handler?: (ev: GroupParticipantsUpdateEvent) => void;
  onGroupParticipants(h: (ev: GroupParticipantsUpdateEvent) => void) {
    this.handler = h;
  }
}

const makeRecorder = (now = NOW) => {
  const gateway = new FakeGateway();
  return { gateway, recorder: new GroupMemberRecorder(gateway, () => now) };
};

const ev = (
  action: GroupParticipantsUpdateEvent['action'],
  participants: string[],
  author?: string,
  jid = ADMIN_GROUP,
): GroupParticipantsUpdateEvent => ({
  sessionId,
  jid,
  participants,
  action,
  ...(author ? { author } : {}),
});

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: 'recorder' } })).id;
  sessionId = (await prisma.waSession.create({ data: { tenantId, label: 'chip' } })).id;
  await prisma.waGroup.create({
    data: { tenantId, sessionId, jid: ADMIN_GROUP, name: 'Admin', botIsAdmin: true },
  });
  await prisma.waGroup.create({
    data: { tenantId, sessionId, jid: COMMON_GROUP, name: 'Comum', botIsAdmin: false },
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
});

describe('mapParticipantAction', () => {
  it.each([
    ['add', 'p@s.whatsapp.net', undefined, 'JOIN'],
    ['add', 'p@s.whatsapp.net', 'p:12@s.whatsapp.net', 'JOIN'],
    ['add', 'p@s.whatsapp.net', ADMIN, 'ADDED'],
    ['remove', 'p@s.whatsapp.net', undefined, 'LEAVE'],
    ['remove', 'p@s.whatsapp.net', 'p@s.whatsapp.net', 'LEAVE'],
    ['remove', 'p@s.whatsapp.net', ADMIN, 'REMOVED'],
    ['promote', 'p@s.whatsapp.net', ADMIN, 'PROMOTED'],
    ['demote', 'p@s.whatsapp.net', ADMIN, 'DEMOTED'],
    ['modify', 'p@s.whatsapp.net', undefined, null],
  ])('%s de %s por %s → %s', (action, participant, author, expected) => {
    expect(mapParticipantAction(action, participant, author)).toBe(expected);
  });

  it('dedupeKey agrupa por minuto', () => {
    const base = {
      sessionId: 's',
      groupJid: 'g@g.us',
      participantJid: 'p@s.whatsapp.net',
      action: 'JOIN' as const,
    };
    const a = memberEventDedupeKey({ ...base, occurredAt: new Date('2026-10-13T15:00:01Z') });
    const b = memberEventDedupeKey({ ...base, occurredAt: new Date('2026-10-13T15:00:59Z') });
    const c = memberEventDedupeKey({ ...base, occurredAt: new Date('2026-10-13T15:01:00Z') });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('GroupMemberRecorder.record', () => {
  it('grava as seis ações com actorJid e tenant corretos', async () => {
    const { recorder } = makeRecorder();
    await recorder.record(ev('add', ['six-join@s.whatsapp.net']));
    await recorder.record(ev('add', ['six-added@s.whatsapp.net'], ADMIN));
    await recorder.record(ev('remove', ['six-leave@s.whatsapp.net']));
    await recorder.record(ev('remove', ['six-removed@s.whatsapp.net'], ADMIN));
    await recorder.record(ev('promote', ['six-promoted@s.whatsapp.net'], ADMIN));
    await recorder.record(ev('demote', ['six-demoted@s.whatsapp.net'], ADMIN));
    const rows = await prisma.groupMemberEvent.findMany({
      where: { tenantId, participantJid: { startsWith: 'six-' } },
      orderBy: { participantJid: 'asc' },
    });
    expect(rows.map((r) => [r.participantJid.split('@')[0], r.action])).toEqual([
      ['six-added', 'ADDED'],
      ['six-demoted', 'DEMOTED'],
      ['six-join', 'JOIN'],
      ['six-leave', 'LEAVE'],
      ['six-promoted', 'PROMOTED'],
      ['six-removed', 'REMOVED'],
    ]);
    expect(rows.find((r) => r.action === 'ADDED')).toMatchObject({
      actorJid: ADMIN,
      groupJid: ADMIN_GROUP,
      sessionId,
      occurredAt: NOW,
    });
    expect(rows.find((r) => r.action === 'JOIN')?.actorJid).toBeNull();
  });

  it('grava um evento por participante', async () => {
    const { recorder } = makeRecorder();
    const n = await recorder.record(
      ev('add', ['multi-1@s.whatsapp.net', 'multi-2@s.whatsapp.net'], ADMIN),
    );
    expect(n).toBe(2);
  });

  it('é idempotente para retransmissões no mesmo minuto', async () => {
    const event = ev('add', ['dup@s.whatsapp.net']);
    expect(await makeRecorder().recorder.record(event)).toBe(1);
    expect(await makeRecorder().recorder.record(event)).toBe(0);
    expect(await makeRecorder(new Date('2026-10-13T15:00:50Z')).recorder.record(event)).toBe(0);
    expect(
      await prisma.groupMemberEvent.count({ where: { participantJid: 'dup@s.whatsapp.net' } }),
    ).toBe(1);
  });

  it('ignora grupo sem bot admin e grupo desconhecido', async () => {
    const { recorder } = makeRecorder();
    expect(
      await recorder.record(ev('add', ['ign-1@s.whatsapp.net'], undefined, COMMON_GROUP)),
    ).toBe(0);
    expect(await recorder.record(ev('add', ['ign-2@s.whatsapp.net'], undefined, 'nao@g.us'))).toBe(
      0,
    );
    expect(
      await prisma.groupMemberEvent.count({ where: { participantJid: { startsWith: 'ign-' } } }),
    ).toBe(0);
  });

  it('erro durante a gravação é engolido e não propaga', async () => {
    // `now` é chamado dentro do try, depois da consulta ao banco: simula uma falha no meio da gravação
    const broken = new GroupMemberRecorder(new FakeGateway(), () => {
      throw new Error('falha no meio da gravação');
    });
    await expect(broken.record(ev('add', ['err@s.whatsapp.net']))).resolves.toBe(0);
    expect(
      await prisma.groupMemberEvent.count({ where: { participantJid: 'err@s.whatsapp.net' } }),
    ).toBe(0);
  });

  it('start() registra o handler no gateway', async () => {
    const { gateway, recorder } = makeRecorder();
    recorder.start();
    gateway.handler!(ev('add', ['via-start@s.whatsapp.net']));
    await vi.waitFor(async () => {
      expect(
        await prisma.groupMemberEvent.count({
          where: { participantJid: 'via-start@s.whatsapp.net' },
        }),
      ).toBe(1);
    });
  });
});
