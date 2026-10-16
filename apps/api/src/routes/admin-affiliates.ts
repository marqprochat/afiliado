import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hash } from '@node-rs/argon2';
import {
  Prisma,
  prisma,
  DEFAULT_SETTINGS,
  DEFAULT_TEMPLATE,
  type MarketplaceKind,
} from '@afilados/db';
import {
  ApiError,
  MARKETPLACE_KINDS,
  affiliateActiveSchema,
  affiliateCreateSchema,
  affiliateResetPasswordSchema,
  affiliateUpdateSchema,
} from '@afilados/shared';
import { requireAuth, requireSuperAdmin } from '../plugins/auth';
import {
  ADMIN_SESSION_COOKIE,
  IMPERSONATION_TTL_MS,
  SESSION_COOKIE,
  createSession,
  destroySession,
  sessionCookieOptions,
  validateSession,
} from '../lib/session';

const idParam = z.object({ id: z.string().min(1) });
const generatePassword = () => randomBytes(9).toString('base64url');

async function loadAffiliate(adminTenantId: string, id: string) {
  const tenant = await prisma.tenant.findFirst({ where: { id, parentTenantId: adminTenantId } });
  if (!tenant) throw ApiError.notFound('Afiliado não encontrado');
  const user = await prisma.user.findFirst({
    where: { tenantId: id, role: 'OWNER' },
    orderBy: { createdAt: 'asc' },
  });
  if (!user) throw ApiError.notFound('Afiliado sem usuário');
  return { tenant, user };
}

async function toRow(tenantId: string) {
  const [tenant, user, conns, wa, groups, sends] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
    prisma.user.findFirstOrThrow({
      where: { tenantId, role: 'OWNER' },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.marketplaceConnection.findMany({
      where: { tenantId, subId: { not: null } },
      select: { kind: true, subId: true },
    }),
    prisma.waSession.count({ where: { tenantId, status: 'CONNECTED' } }),
    prisma.waGroup.count({ where: { tenantId } }),
    prisma.sendLog.count({
      where: { tenantId, status: 'SENT', sentAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
    }),
  ]);
  return {
    id: tenant.id,
    userId: user.id,
    name: tenant.name,
    email: user.email,
    active: tenant.active,
    createdAt: tenant.createdAt,
    waConnected: wa > 0,
    groups,
    sends7d: sends,
    subIds: Object.fromEntries(conns.filter((c) => c.subId).map((c) => [c.kind, c.subId])),
  };
}

type Db = Prisma.TransactionClient | typeof prisma;

/** P2002 (unique) em user.email → 409; qualquer outro erro segue adiante. */
function mapEmailConflict(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
    throw ApiError.conflict('E-mail já cadastrado');
  }
  throw e;
}

async function applySubIds(
  db: Db,
  tenantId: string,
  subIds: Record<string, string | undefined> | undefined,
) {
  for (const [kind, raw] of Object.entries(subIds ?? {})) {
    if (raw === undefined || !MARKETPLACE_KINDS.includes(kind as MarketplaceKind)) continue;
    const value = raw.trim() || null;
    const existing = await db.marketplaceConnection.findFirst({
      where: { tenantId, kind: kind as MarketplaceKind },
    });
    if (existing) {
      await db.marketplaceConnection.update({
        where: { id: existing.id },
        data: { subId: value },
      });
    } else if (value) {
      await db.marketplaceConnection.create({
        data: { tenantId, kind: kind as MarketplaceKind, subId: value },
      });
    }
  }
}

export async function adminAffiliatesRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // Voltar ao admin: sessão atual é a de impersonação, então não passa por requireSuperAdmin.
  app.post('/admin/impersonation/stop', async (req, reply) => {
    const adminToken = req.cookies[ADMIN_SESSION_COOKIE];
    const current = req.cookies[SESSION_COOKIE];
    if (!req.impersonatorUserId || !adminToken || !current) {
      throw ApiError.validation('Nenhuma sessão de impersonação ativa');
    }
    const admin = await validateSession(adminToken);
    if (!admin || admin.user.id !== req.impersonatorUserId) {
      // Cookie do admin inválido/forjado: derruba a sessão de impersonação e limpa os cookies
      // para o usuário não ficar preso numa sessão sem saída.
      await destroySession(current);
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      reply.clearCookie(ADMIN_SESSION_COOKIE, { path: '/' });
      return reply
        .status(401)
        .send({ error: { code: 'UNAUTHORIZED', message: 'Não autenticado' } });
    }
    await destroySession(current);
    reply.setCookie(SESSION_COOKIE, adminToken, sessionCookieOptions(admin.expiresAt));
    reply.clearCookie(ADMIN_SESSION_COOKIE, { path: '/' });
    return reply.status(204).send();
  });

  app.register(async (admin) => {
    admin.addHook('preHandler', requireSuperAdmin);

    admin.get('/admin/affiliates', async (req) => {
      const tenants = await prisma.tenant.findMany({
        where: { parentTenantId: req.tenantId },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      return Promise.all(tenants.map((t) => toRow(t.id)));
    });

    admin.post('/admin/affiliates', async (req, reply) => {
      const body = affiliateCreateSchema.parse(req.body);
      const email = body.email.toLowerCase();
      if (await prisma.user.findUnique({ where: { email } })) {
        throw ApiError.conflict('E-mail já cadastrado');
      }
      const password = body.password ?? generatePassword();
      const passwordHash = await hash(password);
      const tenantId = await prisma
        .$transaction(async (tx) => {
          const tenant = await tx.tenant.create({
            data: { name: body.name, parentTenantId: req.tenantId },
          });
          await tx.user.create({
            data: { tenantId: tenant.id, email, name: body.name, role: 'OWNER', passwordHash },
          });
          await tx.operatingWindow.create({ data: { tenantId: tenant.id } });
          await tx.template.create({
            data: { tenantId: tenant.id, name: 'Padrão', body: DEFAULT_TEMPLATE, isDefault: true },
          });
          for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
            await tx.setting.create({ data: { tenantId: tenant.id, key, value: value as object } });
          }
          await applySubIds(tx, tenant.id, body.subIds);
          return tenant.id;
        })
        .catch(mapEmailConflict);
      const row = await toRow(tenantId);
      return reply.status(201).send(body.password ? row : { ...row, initialPassword: password });
    });

    admin.patch('/admin/affiliates/:id', async (req) => {
      const { id } = idParam.parse(req.params);
      const body = affiliateUpdateSchema.parse(req.body);
      const { user } = await loadAffiliate(req.tenantId, id);
      if (body.email && body.email.toLowerCase() !== user.email) {
        const taken = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
        if (taken) throw ApiError.conflict('E-mail já cadastrado');
        await prisma.user
          .update({ where: { id: user.id }, data: { email: body.email.toLowerCase() } })
          .catch(mapEmailConflict);
      }
      if (body.name) {
        await prisma.tenant.update({ where: { id }, data: { name: body.name } });
        await prisma.user.update({ where: { id: user.id }, data: { name: body.name } });
      }
      await applySubIds(prisma, id, body.subIds);
      return toRow(id);
    });

    admin.post('/admin/affiliates/:id/active', async (req, reply) => {
      const { id } = idParam.parse(req.params);
      const { active } = affiliateActiveSchema.parse(req.body);
      await loadAffiliate(req.tenantId, id);
      await prisma.tenant.update({ where: { id }, data: { active } });
      if (!active) {
        await prisma.session.deleteMany({
          where: { user: { tenantId: id }, impersonatorUserId: null },
        });
      } else {
        // Jobs descartados enquanto inativo deixam lotes parados em andamento; pausa para o
        // afiliado retomar com o botão existente (que re-enfileira os itens).
        await prisma.batch.updateMany({
          where: { tenantId: id, status: { in: ['SCHEDULED', 'RUNNING'] } },
          data: { status: 'PAUSED' },
        });
      }
      return reply.status(204).send();
    });

    admin.post('/admin/affiliates/:id/reset-password', async (req) => {
      const { id } = idParam.parse(req.params);
      const body = affiliateResetPasswordSchema.parse(req.body ?? {});
      const { user } = await loadAffiliate(req.tenantId, id);
      const password = body.password ?? generatePassword();
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hash(password) },
      });
      await prisma.session.deleteMany({ where: { userId: user.id } });
      return { password };
    });

    admin.post('/admin/affiliates/:id/impersonate', async (req, reply) => {
      const { id } = idParam.parse(req.params);
      const { user } = await loadAffiliate(req.tenantId, id);
      const adminToken = req.cookies[SESSION_COOKIE];
      if (!adminToken) throw ApiError.unauthorized();
      const adminSession = await validateSession(adminToken);
      if (!adminSession) throw ApiError.unauthorized();
      const { token, expiresAt } = await createSession(user.id, {
        impersonatorUserId: req.user!.id,
        ttlMs: IMPERSONATION_TTL_MS,
      });
      reply.setCookie(
        ADMIN_SESSION_COOKIE,
        adminToken,
        sessionCookieOptions(adminSession.expiresAt),
      );
      reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
      return reply.status(204).send();
    });
  });
}
