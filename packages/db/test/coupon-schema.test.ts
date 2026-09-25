import { describe, it, expect } from 'vitest';
import { prisma } from '../src';

describe('schema de cupons e histórico de verificação', () => {
  it('cria cupom com defaults corretos (origin=MANUAL, status=UNVERIFIED, scope="")', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'coupon-defaults-test' } });
    try {
      const coupon = await prisma.coupon.create({
        data: {
          tenantId: tenant.id,
          store: 'ALIEXPRESS',
          code: 'PROMO10',
          description: 'Cupom teste',
        },
      });

      expect(coupon.origin).toBe('MANUAL');
      expect(coupon.status).toBe('UNVERIFIED');
      expect(coupon.scope).toBe('');
      expect(coupon.updatedAt).toBeInstanceOf(Date);
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
    }
  });

  it('permite mesmo store e code com scope diferente, mas bloqueia com mesmo scope (P2002)', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'coupon-unique-test' } });
    try {
      const couponA = await prisma.coupon.create({
        data: {
          tenantId: tenant.id,
          store: 'AWIN',
          scope: 'advertiser_123',
          code: 'OFF20',
          description: 'Desconto anunciante 123',
        },
      });

      const couponB = await prisma.coupon.create({
        data: {
          tenantId: tenant.id,
          store: 'AWIN',
          scope: 'advertiser_456',
          code: 'OFF20',
          description: 'Desconto anunciante 456',
        },
      });

      expect(couponA.id).not.toBe(couponB.id);

      // Conflito com mesmo scope
      await expect(
        prisma.coupon.create({
          data: {
            tenantId: tenant.id,
            store: 'AWIN',
            scope: 'advertiser_123',
            code: 'OFF20',
            description: 'Duplicado',
          },
        }),
      ).rejects.toThrow();
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
    }
  });

  it('apagar cupom remove os CouponCheck em cascata', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'coupon-cascade-test' } });
    try {
      const coupon = await prisma.coupon.create({
        data: {
          tenantId: tenant.id,
          store: 'AMAZON',
          code: 'PRIME10',
          description: 'Cupom Amazon',
        },
      });

      const check = await prisma.couponCheck.create({
        data: {
          tenantId: tenant.id,
          couponId: coupon.id,
          result: 'VALID',
          method: 'MANUAL',
          note: 'Testado no checkout',
        },
      });

      expect(check.id).toBeDefined();

      // Deletar o cupom
      await prisma.coupon.delete({ where: { id: coupon.id } });

      const checkAfter = await prisma.couponCheck.findUnique({ where: { id: check.id } });
      expect(checkAfter).toBeNull();
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
    }
  });
});
