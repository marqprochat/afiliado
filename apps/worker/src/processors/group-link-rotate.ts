import type { Job } from 'bullmq';
import pino from 'pino';
import { prisma } from '@afilados/db';
import { buildGroupName, type GroupLinkRotateJob } from '@afilados/shared';
import { getRedis } from '../lib/redis';
import { publishEvent } from '../lib/events';
import type { WhatsAppGateway } from '../wa/gateway';

const log = pino({ name: 'group-link-rotate' });

const RELEASE_LUA = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`;

export function createGroupLinkRotateProcessor(deps: { gateway: WhatsAppGateway }) {
  const { gateway } = deps;

  return async function processGroupLinkRotate(job: Job<GroupLinkRotateJob>) {
    const { tenantId, groupLinkId, fromGroupId, reason } = job.data;
    log.info({ groupLinkId, tenantId, fromGroupId, reason }, 'Iniciando rotação de grupo');

    const link = await prisma.groupLink.findFirst({
      where: { id: groupLinkId, tenantId },
      include: {
        groups: {
          where: { status: 'ACTIVE' },
        },
      },
    });

    if (!link) {
      log.warn({ groupLinkId }, 'GroupLink não encontrado');
      return { skipped: true, reason: 'NOT_FOUND' };
    }

    if (!link.enabled || link.status === 'PAUSED') {
      log.info(
        { groupLinkId, enabled: link.enabled, status: link.status },
        'GroupLink desativado ou pausado; rotação ignorada',
      );
      return { skipped: true, reason: 'LINK_DISABLED_OR_PAUSED' };
    }

    const currentActive = link.groups[0] ?? null;
    // Idempotência: se um fromGroupId específico foi passado (ex: threshold/orphaned) e o grupo ACTIVE atual
    // já é outro, significa que outra execução já realizou a rotação.
    if (fromGroupId && currentActive && currentActive.id !== fromGroupId) {
      log.info(
        { groupLinkId, fromGroupId, currentActiveId: currentActive.id },
        'Grupo ativo já mudou; rotação já efetuada',
      );
      return { skipped: true, reason: 'ALREADY_ROTATED' };
    }

    const lockKey = `grouplink:rotate:${link.id}`;
    const lockOwner = `worker:${process.pid}:${Math.random().toString(36).slice(2)}`;
    const LOCK_TTL_MS = 120_000;

    const acquired = await getRedis().set(lockKey, lockOwner, 'PX', LOCK_TTL_MS, 'NX');
    if (acquired !== 'OK') {
      log.warn({ groupLinkId }, 'Outro processo já está realizando a rotação deste link');
      throw new Error(`CONCURRENT_ROTATION_IN_PROGRESS: link ${link.id}`);
    }

    try {
      // 1. Verifica conexão com WhatsApp
      if (!gateway.isConnected(link.sessionId)) {
        log.error({ sessionId: link.sessionId, groupLinkId }, 'WhatsApp não está conectado');
        await prisma.groupLink.updateMany({
          where: { id: link.id },
          data: { lastError: 'WA_NOT_CONNECTED' },
        });
        throw new Error('WA_NOT_CONNECTED');
      }

      // 2. Verifica taxa limite de rotações por hora
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const rotationsInLastHour = await prisma.managedGroup.count({
        where: {
          groupLinkId: link.id,
          status: { in: ['ACTIVE', 'FULL'] },
          createdAt: { gte: oneHourAgo },
        },
      });

      if (rotationsInLastHour >= link.maxRotationsPerHour) {
        log.error(
          { linkId: link.id, rotationsInLastHour, max: link.maxRotationsPerHour },
          'Limite de rotações por hora excedido para o link',
        );
        await prisma.groupLink.updateMany({
          where: { id: link.id },
          data: { status: 'ERROR', lastError: 'MAX_ROTATIONS_PER_HOUR_EXCEEDED' },
        });
        await publishEvent(link.tenantId, {
          type: 'group-link.error',
          groupLinkId: link.id,
          error: 'MAX_ROTATIONS_PER_HOUR_EXCEEDED',
        });
        return { error: 'MAX_ROTATIONS_PER_HOUR_EXCEEDED' };
      }

      // 3. Recuperação de falha e cálculo de nome do novo grupo
      const nextSeq = link.nextSequence;
      const targetNumber = link.startNumber + (nextSeq - 1);
      const expectedName = buildGroupName({
        baseName: link.baseName,
        customText: link.customText,
        textPosition: link.textPosition,
        numberPrefix: link.numberPrefix,
        number: targetNumber,
      });

      let managedGroup = await prisma.managedGroup.findFirst({
        where: { groupLinkId: link.id, sequence: nextSeq },
      });

      let jid = managedGroup?.jid ?? null;

      if (managedGroup && !jid) {
        try {
          const existingGroups = await gateway.fetchGroups(link.sessionId);
          const matched = existingGroups.find((g) => g.name === expectedName);
          if (matched) {
            jid = matched.jid;
            await prisma.managedGroup.updateMany({
              where: { id: managedGroup.id },
              data: { jid },
            });
          }
        } catch (e) {
          log.warn({ err: e }, 'falha ao buscar grupos existentes para adoção');
        }
      }

      if (!managedGroup) {
        managedGroup = await prisma.managedGroup.create({
          data: {
            tenantId: link.tenantId,
            groupLinkId: link.id,
            sequence: nextSeq,
            number: targetNumber,
            name: expectedName,
            status: 'CREATING',
            memberCount: 0,
          },
        });
      }

      // 4. Cria grupo via Baileys se ainda não houver JID
      if (!jid) {
        log.info({ expectedName, sessionId: link.sessionId }, 'Criando grupo no WhatsApp');
        const created = await gateway.createGroup(
          link.sessionId,
          expectedName,
          link.seedParticipants,
        );
        jid = created.jid;
        await prisma.managedGroup.updateMany({
          where: { id: managedGroup.id },
          data: { jid },
        });
      }

      // 5. Configurações pós-criação
      try {
        if (link.groupDescription || link.announceOnly) {
          await gateway.updateGroupSettings(link.sessionId, jid, {
            ...(link.groupDescription ? { description: link.groupDescription } : {}),
            announceOnly: link.announceOnly,
          });
        }
      } catch (err) {
        log.warn({ err, jid }, 'falha ao aplicar configurações pós-criação do grupo');
      }

      if (link.groupImageBase64) {
        try {
          const cleanBase64 = link.groupImageBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');
          const imgBuf = Buffer.from(cleanBase64, 'base64');
          await gateway.updateGroupPicture(link.sessionId, jid, imgBuf);
        } catch (err) {
          log.warn({ err, jid }, 'falha ao atualizar foto de perfil do grupo');
        }
      }

      // 6. Obtenção do código de convite (obrigatório)
      let inviteCode: string | null = null;
      let inviteLink: string | null = managedGroup.inviteLink ?? null;
      try {
        inviteCode = await gateway.getInviteCode(link.sessionId, jid);
        inviteLink = `https://chat.whatsapp.com/${inviteCode}`;
      } catch (err) {
        log.error({ err, jid }, 'falha ao obter inviteCode para o grupo');
        await prisma.managedGroup.updateMany({
          where: { id: managedGroup.id },
          data: { lastError: 'FAILED_TO_GET_INVITE_CODE' },
        });
        throw err;
      }

      // 7. Transação para ativar novo grupo e arquivar o antigo
      const initialMemberCount = 1 + (link.seedParticipants ? link.seedParticipants.length : 0);
      const now = new Date();

      await prisma.$transaction(async (tx) => {
        if (currentActive) {
          await tx.managedGroup.updateMany({
            where: { id: currentActive.id },
            data: {
              status: 'FULL',
              filledAt: now,
            },
          });
        }

        await tx.managedGroup.updateMany({
          where: { id: managedGroup!.id },
          data: {
            jid,
            inviteLink,
            status: 'ACTIVE',
            activatedAt: now,
            inviteSyncedAt: now,
            countSyncedAt: now,
            memberCount: initialMemberCount,
            lastError: null,
          },
        });

        await tx.groupLink.updateMany({
          where: { id: link.id },
          data: {
            nextSequence: nextSeq + 1,
            lastRotatedAt: now,
            lastError: null,
            status: 'ACTIVE',
          },
        });
      });

      // 8. Invalidação de cache e eventos
      await getRedis().del(`grouplink:slug:${link.slug}`);
      await publishEvent(link.tenantId, {
        type: 'group-link.rotated',
        groupLinkId: link.id,
        newGroupId: managedGroup.id,
        sequence: nextSeq,
      });
      await publishEvent(link.tenantId, {
        type: 'group-links.changed',
        tenantId: link.tenantId,
      });

      log.info({ groupLinkId: link.id, jid, sequence: nextSeq }, 'Grupo rotacionado com sucesso');
      return { ok: true, groupLinkId: link.id, sequence: nextSeq, jid };
    } finally {
      try {
        await getRedis().eval(RELEASE_LUA, 1, lockKey, lockOwner);
      } catch (err) {
        log.error({ err, linkId: link.id }, 'falha ao liberar lock de rotação');
      }
    }
  };
}
