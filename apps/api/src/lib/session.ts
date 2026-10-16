import { createHash, randomBytes } from 'node:crypto';
import { prisma, type User } from '@afilados/db';
import { isProd } from '../config';

export const SESSION_COOKIE = 'afilados_session';
/** Guarda o token da sessão do SuperAdmin enquanto ele "entra como" um afiliado. */
export const ADMIN_SESSION_COOKIE = 'afilados_admin_session';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const IMPERSONATION_TTL_MS = 8 * 60 * 60 * 1000;

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function sessionCookieOptions(expires: Date) {
  return { httpOnly: true, sameSite: 'lax' as const, secure: isProd, path: '/', expires };
}

export async function createSession(
  userId: string,
  opts: { impersonatorUserId?: string; ttlMs?: number } = {},
) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + (opts.ttlMs ?? TTL_MS));
  await prisma.session.create({
    data: {
      id: hashToken(token),
      userId,
      expiresAt,
      impersonatorUserId: opts.impersonatorUserId ?? null,
    },
  });
  return { token, expiresAt };
}

export interface ValidSession {
  user: User;
  tenantId: string;
  isAffiliate: boolean;
  impersonatorUserId: string | null;
  expiresAt: Date;
}

export async function validateSession(token: string): Promise<ValidSession | null> {
  const s = await prisma.session.findUnique({
    where: { id: hashToken(token) },
    include: { user: { include: { tenant: { select: { parentTenantId: true, active: true } } } } },
  });
  if (!s) return null;
  if (s.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: s.id } });
    return null;
  }
  const { tenant, ...user } = s.user;
  // Conta desativada perde o acesso; só o SuperAdmin (sessão de impersonação) ainda entra.
  if (!tenant.active && !s.impersonatorUserId) return null;
  if (s.impersonatorUserId) {
    // Sessão de impersonação só vale enquanto o impersonador ainda existir e for SuperAdmin.
    const impersonator = await prisma.user.findUnique({
      where: { id: s.impersonatorUserId },
      select: { isSuperAdmin: true },
    });
    if (!impersonator?.isSuperAdmin) {
      await prisma.session.deleteMany({ where: { id: s.id } });
      return null;
    }
  }
  return {
    user,
    tenantId: user.tenantId,
    isAffiliate: tenant.parentTenantId !== null,
    impersonatorUserId: s.impersonatorUserId,
    expiresAt: s.expiresAt,
  };
}

export async function destroySession(token: string) {
  await prisma.session.deleteMany({ where: { id: hashToken(token) } });
}
