import { describe, it, expect } from 'vitest';
import {
  automationRuleCreateSchema,
  automationRuleUpdateSchema,
  automationQueueLinkSchema,
  automationQueueCouponSchema,
  automationDiscoveringKey,
} from '../src/automation';

describe('automationRuleCreateSchema', () => {
  it('aceita uma regra válida', () => {
    const parsed = automationRuleCreateSchema.parse({
      name: 'Eletrônicos até R$300',
      marketplaces: ['SHOPEE'],
      keywords: ['fone', 'carregador'],
      blockedKeywords: ['usado'],
      minDiscountPct: 20,
      maxPrice: 300,
      maxOffersPerDay: 15,
      intervalMin: 45,
      sessionId: 'sess1',
      groupJids: ['g1@g.us'],
      templateId: 'tpl1',
      mediaMode: 'IMAGE',
    });
    expect(parsed.keywords).toEqual(['fone', 'carregador']);
  });

  it('rejeita regra sem keywords', () => {
    expect(() =>
      automationRuleCreateSchema.parse({
        name: 'x',
        marketplaces: ['SHOPEE'],
        keywords: [],
        blockedKeywords: [],
        maxOffersPerDay: 15,
        intervalMin: 45,
        sessionId: 'sess1',
        groupJids: ['g1@g.us'],
        templateId: 'tpl1',
      }),
    ).toThrow();
  });

  it('rejeita marketplaces vazio', () => {
    expect(() =>
      automationRuleCreateSchema.parse({
        name: 'x',
        marketplaces: [],
        keywords: ['a'],
        blockedKeywords: [],
        maxOffersPerDay: 15,
        intervalMin: 45,
        sessionId: 'sess1',
        groupJids: ['g1@g.us'],
        templateId: 'tpl1',
      }),
    ).toThrow();
  });
});

describe('automationQueueLinkSchema', () => {
  it('exige uma URL', () => {
    expect(() => automationQueueLinkSchema.parse({ url: '' })).toThrow();
    expect(automationQueueLinkSchema.parse({ url: 'https://shopee.com.br/p/1' }).url).toBe(
      'https://shopee.com.br/p/1',
    );
  });
});

describe('automationQueueCouponSchema', () => {
  it('exige templateId e ou couponId ou dados de um cupom novo', () => {
    expect(() => automationQueueCouponSchema.parse({ templateId: 'tpl-cupom' })).toThrow();
    const withExisting = automationQueueCouponSchema.parse({
      templateId: 'tpl-cupom',
      couponId: 'cp1',
    });
    expect(withExisting.couponId).toBe('cp1');
    const withNew = automationQueueCouponSchema.parse({
      templateId: 'tpl-cupom',
      coupon: { store: 'AMAZON', code: 'PROMO10', description: '10% off' },
    });
    expect(withNew.coupon?.code).toBe('PROMO10');
  });
});

describe('automationDiscoveringKey', () => {
  it('gera uma chave estável e única por regra', () => {
    expect(automationDiscoveringKey('rule-1')).toBe('automation-discovering:rule-1');
    expect(automationDiscoveringKey('rule-2')).not.toBe(automationDiscoveringKey('rule-1'));
  });
});

describe('opções de EPC da Awin na regra', () => {
  const base = {
    name: 'Awin',
    marketplaces: ['AWIN'],
    keywords: ['protetor'],
    sessionId: 'sess1',
    groupJids: ['g1@g.us'],
    templateId: 'tpl1',
  };

  it('padrão: não prioriza e sem EPC mínimo', () => {
    const parsed = automationRuleCreateSchema.parse(base);
    expect(parsed.awinPrioritizeEpc).toBe(false);
    expect(parsed.awinMinEpc).toBeUndefined();
  });

  it('aceita prioridade e EPC mínimo; rejeita EPC negativo', () => {
    const parsed = automationRuleCreateSchema.parse({
      ...base,
      awinPrioritizeEpc: true,
      awinMinEpc: 0.25,
    });
    expect(parsed).toMatchObject({ awinPrioritizeEpc: true, awinMinEpc: 0.25 });
    expect(() => automationRuleCreateSchema.parse({ ...base, awinMinEpc: -1 })).toThrow();
  });

  it('edição aceita limpar o EPC mínimo com null e não força a prioridade', () => {
    const parsed = automationRuleUpdateSchema.parse({ awinMinEpc: null });
    expect(parsed.awinMinEpc).toBeNull();
    expect(parsed.awinPrioritizeEpc).toBeUndefined();
  });
});
