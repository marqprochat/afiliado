import pino from 'pino';
import { prisma, type GroupLink } from '@afilados/db';
import { buildGroupName } from '@afilados/shared';
import type { GroupSettingsUpdate, WhatsAppGateway } from '../wa/gateway';

const log = pino({ name: 'group-link-settings' });

/** Grupos que ainda existem no WhatsApp e pertencem ao link (recebem envios e alterações). */
export const LIVE_GROUP_STATUSES = ['ACTIVE', 'STANDBY', 'FULL'] as const;

const NAME_FIELDS = new Set(['baseName', 'customText', 'textPosition', 'numberPrefix']);

type LinkSettings = Pick<
  GroupLink,
  | 'baseName'
  | 'customText'
  | 'textPosition'
  | 'numberPrefix'
  | 'groupDescription'
  | 'announceOnly'
  | 'restrictEditInfo'
  | 'restrictAddMembers'
  | 'joinApproval'
  | 'groupImageBase64'
>;

/**
 * Aplica as configurações do link em um grupo do WhatsApp.
 * `fields` limita ao que mudou; ausente = aplica tudo exceto o nome (grupo recém-criado já nasce
 * com o nome certo). Cada ajuste é independente: uma falha não impede os demais. Retorna as falhas.
 */
export async function applyGroupLinkSettings(
  gateway: Pick<WhatsAppGateway, 'updateGroupSettings' | 'updateGroupPicture'>,
  sessionId: string,
  link: LinkSettings,
  group: { jid: string; number: number },
  fields?: Iterable<string>,
): Promise<{ applied: string[]; errors: string[] }> {
  const only = fields ? new Set(fields) : null;
  const wants = (f: string) => !only || only.has(f);
  const applied: string[] = [];
  const errors: string[] = [];

  const steps: [string, GroupSettingsUpdate][] = [];
  if (only && [...NAME_FIELDS].some((f) => only.has(f))) {
    steps.push([
      'subject',
      {
        subject: buildGroupName({
          baseName: link.baseName,
          customText: link.customText,
          textPosition: link.textPosition,
          numberPrefix: link.numberPrefix,
          number: group.number,
        }),
      },
    ]);
  }
  // Descrição vazia só é enviada quando foi explicitamente alterada (remove a descrição).
  if (wants('groupDescription') && (only || link.groupDescription)) {
    steps.push(['description', { description: link.groupDescription ?? '' }]);
  }
  if (wants('announceOnly')) steps.push(['announceOnly', { announceOnly: link.announceOnly }]);
  if (wants('restrictEditInfo')) {
    steps.push(['restrictEditInfo', { restrictEditInfo: link.restrictEditInfo }]);
  }
  if (wants('restrictAddMembers')) {
    steps.push(['restrictAddMembers', { restrictAddMembers: link.restrictAddMembers }]);
  }
  if (wants('joinApproval')) steps.push(['joinApproval', { joinApproval: link.joinApproval }]);

  for (const [name, settings] of steps) {
    try {
      await gateway.updateGroupSettings(sessionId, group.jid, settings);
      applied.push(name);
    } catch (err) {
      log.warn({ err, jid: group.jid, setting: name }, 'falha ao aplicar configuração no grupo');
      errors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (wants('groupImageBase64') && link.groupImageBase64) {
    try {
      const clean = link.groupImageBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');
      await gateway.updateGroupPicture(sessionId, group.jid, Buffer.from(clean, 'base64'));
      applied.push('picture');
    } catch (err) {
      log.warn({ err, jid: group.jid }, 'falha ao atualizar foto do grupo');
      errors.push(`picture: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { applied, errors };
}

/**
 * Grupos de um mesmo link são vinculados: o que vai para um vai para todos.
 * Recebe os destinos escolhidos e devolve a lista expandida com os grupos irmãos
 * (mesma sessão, ainda existentes), preservando a ordem e sem duplicatas.
 */
export async function expandLinkedGroupJids(
  tenantId: string,
  sessionId: string,
  jids: string[],
): Promise<string[]> {
  if (jids.length === 0) return jids;
  const managed = await prisma.managedGroup.findMany({
    where: { tenantId, jid: { in: jids }, groupLink: { sessionId } },
    select: { groupLinkId: true },
  });
  if (managed.length === 0) return jids;

  const linkIds = [...new Set(managed.map((m) => m.groupLinkId))];
  const siblings = await prisma.managedGroup.findMany({
    where: {
      tenantId,
      groupLinkId: { in: linkIds },
      status: { in: [...LIVE_GROUP_STATUSES] },
      jid: { not: null },
    },
    orderBy: [{ groupLinkId: 'asc' }, { sequence: 'asc' }],
    select: { jid: true },
  });

  const out = [...jids];
  const seen = new Set(jids);
  for (const s of siblings) {
    if (s.jid && !seen.has(s.jid)) {
      seen.add(s.jid);
      out.push(s.jid);
    }
  }
  return out;
}
