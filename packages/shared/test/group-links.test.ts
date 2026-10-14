import { describe, it, expect } from 'vitest';
import {
  buildGroupName,
  sanitizeGroupText,
  countGraphemes,
  sliceGraphemes,
  isValidSlug,
  groupLinkCreateSchema,
} from '../src/group-links';

describe('group-links shared helpers', () => {
  describe('sanitizeGroupText', () => {
    it('normaliza NFC e colapsa múltiplos espaços', () => {
      const input = '   Ofertas   \t  VIP   ';
      expect(sanitizeGroupText(input)).toBe('Ofertas VIP');
    });

    it('remove quebras de linha e caracteres de controle', () => {
      const input = 'Linha 1\r\nLinha 2\x00\x08 com\x1Fcontrole';
      expect(sanitizeGroupText(input)).toBe('Linha 1Linha 2 comcontrole');
    });

    it('preserva ZWJ (U+200D) em emojis compostos', () => {
      // 👩‍💻 é 👩 + \u200D + 💻
      const complexEmoji = '👩\u200D💻 Desenvolvedora';
      const sanitized = sanitizeGroupText(complexEmoji);
      expect(sanitized).toBe('👩‍💻 Desenvolvedora');
      expect(sanitized.includes('\u200D')).toBe(true);
    });

    it('preserva VS16 (U+FE0F) em emojis de variação', () => {
      // ⚡️ é ⚡ + \uFE0F
      const emojiWithVs16 = '⚡\uFE0F Ofertas Relâmpago';
      const sanitized = sanitizeGroupText(emojiWithVs16);
      expect(sanitized).toBe('⚡️ Ofertas Relâmpago');
      expect(sanitized.includes('\uFE0F')).toBe(true);
    });
  });

  describe('countGraphemes & sliceGraphemes', () => {
    it('conta corretamente grafemas com emojis compostos', () => {
      expect(countGraphemes('abc')).toBe(3);
      expect(countGraphemes('👨‍👩‍👧‍👦')).toBe(1); // 1 grafema apesar de múltiplos code points
      expect(countGraphemes('⚡️')).toBe(1);
    });

    it('corta no limite exato de grafemas sem quebrar emojis', () => {
      const text = 'Promo 👨‍👩‍👧‍👦 VIP';
      const sliced = sliceGraphemes(text, 7); // 'Promo ' (6) + '👨‍👩‍👧‍👦' (1) = 7
      expect(sliced).toBe('Promo 👨‍👩‍👧‍👦');
    });
  });

  describe('buildGroupName', () => {
    it('formata com PREFIX', () => {
      const name = buildGroupName({
        baseName: 'Achadinhos VIP',
        customText: '🔥 OFERTAS 🔥',
        textPosition: 'PREFIX',
        numberPrefix: '#',
        number: 1,
      });
      expect(name).toBe('🔥 OFERTAS 🔥 Achadinhos VIP #1');
    });

    it('formata com SUFFIX', () => {
      const name = buildGroupName({
        baseName: 'Achadinhos VIP',
        customText: '🔥 OFERTAS 🔥',
        textPosition: 'SUFFIX',
        numberPrefix: '#',
        number: 2,
      });
      expect(name).toBe('Achadinhos VIP #2 🔥 OFERTAS 🔥');
    });

    it('formata sem customText', () => {
      const name = buildGroupName({
        baseName: 'Achadinhos VIP',
        numberPrefix: '#',
        number: 10,
      });
      expect(name).toBe('Achadinhos VIP #10');
    });

    it('corta SOMENTE baseName em fronteira de grafema quando excede o limite', () => {
      const longBase = 'A'.repeat(80) + ' 👨‍👩‍👧‍👦 ' + 'B'.repeat(50);
      const name = buildGroupName({
        baseName: longBase,
        customText: '[OFICIAL]',
        textPosition: 'PREFIX',
        numberPrefix: '#',
        number: 999,
        maxLength: 35,
      });

      // customText = '[OFICIAL]' (9) + ' ' (1) + num '#999' (4) + ' ' (1) = 15 fixos
      // restam 20 grafemas para o baseName
      expect(name.startsWith('[OFICIAL] ')).toBe(true);
      expect(name.endsWith(' #999')).toBe(true);
      expect(countGraphemes(name)).toBeLessThanOrEqual(35);
    });
  });

  describe('isValidSlug & reservations', () => {
    it('valida slugs válidos', () => {
      expect(isValidSlug('meu-grupo')).toBe(true);
      expect(isValidSlug('ofertas2026')).toBe(true);
      expect(isValidSlug('promo-top-1')).toBe(true);
    });

    it('rejeita slugs reservados', () => {
      expect(isValidSlug('api')).toBe(false);
      expect(isValidSlug('login')).toBe(false);
      expect(isValidSlug('admin')).toBe(false);
      expect(isValidSlug('g')).toBe(false);
      expect(isValidSlug('app')).toBe(false);
      expect(isValidSlug('dashboard')).toBe(false);
    });

    it('rejeita formatos inválidos', () => {
      expect(isValidSlug('ab')).toBe(false); // curto < 3
      expect(isValidSlug('-comeca-com-hifen')).toBe(false);
      expect(isValidSlug('termina-com-hifen-')).toBe(false);
      expect(isValidSlug('com--hifen--duplo')).toBe(false);
      expect(isValidSlug('Com Maiuscula')).toBe(false);
      expect(isValidSlug('com_underline')).toBe(false);
    });
  });

  describe('groupLinkCreateSchema', () => {
    it('valida payload correto com valores padrão', () => {
      const parsed = groupLinkCreateSchema.parse({
        sessionId: 'sess-123',
        slug: 'promos-imperdiveis',
        label: 'Promos WhatsApp',
        baseName: 'Promos VIP',
      });

      expect(parsed.memberLimit).toBe(1000);
      expect(parsed.rotateMargin).toBe(20);
      expect(parsed.numberPrefix).toBe('#');
      expect(parsed.startNumber).toBe(1);
      expect(parsed.textPosition).toBe('PREFIX');
      expect(parsed.maxRotationsPerHour).toBe(3);
    });

    it('falha com slug reservado', () => {
      expect(() =>
        groupLinkCreateSchema.parse({
          sessionId: 'sess-123',
          slug: 'login',
          label: 'Promos',
          baseName: 'Promos',
        }),
      ).toThrow();
    });

    it('valida groupImageBase64 com formato correto', () => {
      const validBase64 = 'data:image/jpeg;base64,' + Buffer.from('fake-image-bytes').toString('base64');
      const parsed = groupLinkCreateSchema.parse({
        sessionId: 'sess-123',
        slug: 'promos-foto',
        label: 'Promos WhatsApp',
        baseName: 'Promos VIP',
        groupImageBase64: validBase64,
      });
      expect(parsed.groupImageBase64).toBe(validBase64);
    });

    it('rejeita groupImageBase64 com formato inválido', () => {
      expect(() =>
        groupLinkCreateSchema.parse({
          sessionId: 'sess-123',
          slug: 'promos-foto-invalida',
          label: 'Promos',
          baseName: 'Promos',
          groupImageBase64: 'data:text/plain;base64,123',
        }),
      ).toThrow();
    });

    it('rejeita groupImageBase64 excedendo limite de tamanho', () => {
      const oversized = 'data:image/png;base64,' + 'A'.repeat(700 * 1024);
      expect(() =>
        groupLinkCreateSchema.parse({
          sessionId: 'sess-123',
          slug: 'promos-foto-grande',
          label: 'Promos',
          baseName: 'Promos',
          groupImageBase64: oversized,
        }),
      ).toThrow();
    });
  });
});

