import type { FastifyInstance } from 'fastify';
import { ApiError, manualSendSchema, type DispatchResult } from '@afilados/shared';
import { requireAuth } from '../plugins/auth';
import { getOperatingWindow, getSettings, toCoreWindow } from '../lib/settings';
import {
  assertDispatchTargets,
  createDispatchBatch,
  dispatchBatchName,
  requireConnectedSession,
} from '../lib/dispatch';

export async function manualSendRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.post('/manual-send', { bodyLimit: 8 * 1024 * 1024 }, async (req, reply) => {
    const body = manualSendSchema.parse(req.body);
    const session = await requireConnectedSession(req.db, body.sessionId);
    await assertDispatchTargets(req.db, session.id, body);

    // O lote exige um template, mas a mensagem livre não o usa: pega o padrão (ou o mais antigo).
    const template =
      (await req.db.template.findFirst({ where: { isDefault: true } })) ??
      (await req.db.template.findFirst({ orderBy: { createdAt: 'asc' } }));
    if (!template) throw ApiError.validation('Cadastre um template antes de enviar');

    const imageBuffer = body.imageBytes
      ? Buffer.from(body.imageBytes.buffer, body.imageBytes.byteOffset, body.imageBytes.byteLength)
      : undefined;

    const window = toCoreWindow(await getOperatingWindow(req.db, req.tenantId));
    const now = new Date();
    const result = await createDispatchBatch({
      db: req.db,
      tenantId: req.tenantId,
      sessionId: session.id,
      templateId: template.id,
      name: dispatchBatchName('Envio manual', now, window.timezone),
      groupJids: body.groupJids,
      telegramChatIds: body.telegramChatIds,
      mode: body.mode,
      intervalMin: body.intervalMin,
      items: [
        {
          customText: body.text,
          ...(body.imageUrl ? { customImageUrl: body.imageUrl } : {}),
          ...(imageBuffer && body.imageType
            ? { customImageData: imageBuffer, customImageType: body.imageType }
            : {}),
        },
      ],
      window,
      ratePerMin: (await getSettings(req.db)).globalRateLimitPerMin,
      now,
    });
    const out: DispatchResult = {
      batchId: result.batchId,
      name: result.name,
      mode: body.mode,
      itemCount: result.itemCount,
      firstRunAt: result.firstRunAt.toISOString(),
      skipped: [],
    };
    return reply.status(201).send(out);
  });
}
