import { createHash, randomBytes } from 'node:crypto';
import { prisma, type User } from '@afilados/db';

export const SESSION_COOKIE = 'afilados_session';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + TTL_MS);
  await prisma.session.create({ data: { id: hashToken(token), userId, expiresAt } });
  return { token, expiresAt };
}

export async function validateSession(
  token: string,
): Promise<{ user: User; tenantId: string } | null> {
  const s = await prisma.session.findUnique({
    where: { id: hashToken(token) },
    include: { user: true },
  });
  if (!s) return null;
  if (s.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: s.id } });
    return null;
  }
  return { user: s.user, tenantId: s.user.tenantId };
}

export async function destroySession(token: string) {
  await prisma.session.deleteMany({ where: { id: hashToken(token) } });
}
