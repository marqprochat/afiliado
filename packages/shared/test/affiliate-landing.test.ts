import { describe, it, expect } from 'vitest';
import {
  formatGroupImage,
  mapGroupLinkToAuraNiche,
  type GroupLinkLike,
} from '../src/affiliate-landing';

describe('affiliate-landing helper functions', () => {
  describe('formatGroupImage', () => {
    it('retorna string vazia quando não há imagem cadastrada (sem forçar mock/fallback falso)', () => {
      expect(formatGroupImage(null)).toBe('');
      expect(formatGroupImage(undefined)).toBe('');
      expect(formatGroupImage('')).toBe('');
      expect(formatGroupImage('   ')).toBe('');
    });

    it('mantém URLs HTTP e HTTPS intactas', () => {
      expect(formatGroupImage('https://images.unsplash.com/photo-123')).toBe(
        'https://images.unsplash.com/photo-123',
      );
      expect(formatGroupImage('http://example.com/group.jpg')).toBe(
        'http://example.com/group.jpg',
      );
    });

    it('mantém caminhos relativos locais', () => {
      expect(formatGroupImage('/assets/custom/banner.png')).toBe('/assets/custom/banner.png');
    });

    it('formata strings base64 puras em data URL jpeg', () => {
      const rawBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
      expect(formatGroupImage(rawBase64)).toBe(`data:image/jpeg;base64,${rawBase64}`);
    });

    it('mantém data URLs base64 já formatadas', () => {
      const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...';
      expect(formatGroupImage(dataUrl)).toBe(dataUrl);
    });
  });

  describe('mapGroupLinkToAuraNiche', () => {
    it('mapeia fielmente todos os campos de um link de grupo cadastrado pelo afiliado', () => {
      const link: GroupLinkLike = {
        id: 'link-abc-123',
        slug: 'promos-tech',
        label: 'Tech & Informática VIP',
        baseName: 'Tech Promos',
        customText: 'Ofertas diárias de hardware e notebooks',
        groupDescription: 'Grupo VIP com os menores preços de tecnologia testados 24h.',
        groupImageBase64: 'data:image/jpeg;base64,samplebase64data',
        displayOrder: 1,
        clickCount: 80,
      };

      const niche = mapGroupLinkToAuraNiche(link, 0);

      expect(niche.id).toBe('promos-tech');
      expect(niche.orderNumber).toBe('01');
      expect(niche.name).toBe('Tech & Informática VIP');
      expect(niche.description).toBe('Grupo VIP com os menores preços de tecnologia testados 24h.');
      expect(niche.image).toBe('data:image/jpeg;base64,samplebase64data');
      expect(niche.whatsappLink).toBe('/g/promos-tech');
      expect(niche.tagline).toBe('Ofertas diárias de hardware e notebooks');
      expect(niche.categoryBadge).toBe('WhatsApp Oficial');
      expect(niche.dealsTodayCount).toBeGreaterThanOrEqual(15);
    });

    it('usa imagem vazia caso o afiliado não tenha cadastrado imagem no grupo', () => {
      const link: GroupLinkLike = {
        id: 'link-no-img',
        slug: 'cupons-geral',
        label: 'Cupons & Achadinhos',
        baseName: 'Cupons',
        customText: null,
        groupDescription: 'Cupons testados minuto a minuto.',
        groupImageBase64: null,
      };

      const niche = mapGroupLinkToAuraNiche(link, 2);

      expect(niche.orderNumber).toBe('03');
      expect(niche.name).toBe('Cupons & Achadinhos');
      expect(niche.image).toBe('');
      expect(niche.whatsappLink).toBe('/g/cupons-geral');
    });

    it('ordena corretamente os números dos nichos com padding de 2 dígitos', () => {
      const link: GroupLinkLike = {
        id: 'link-9',
        slug: 'grupo-dez',
        label: 'Grupo 10',
      };

      const niche = mapGroupLinkToAuraNiche(link, 9);
      expect(niche.orderNumber).toBe('10');
    });
  });
});
