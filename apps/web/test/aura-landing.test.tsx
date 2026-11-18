import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { AuraLandingView } from '../src/components/aura-landing/AuraLandingView';
import type { AuraNicheItem } from '@afilados/shared';

describe('AuraLandingView', () => {
  it('renderiza corretamente quando o afiliado possui 0 grupos (não exibe os 4 nichos falsos de beleza, bebê, mercado e casa)', () => {
    const profile = {
      title: 'Minha Página',
      headline: 'Grupos VIP de Ofertas',
      subheadline: 'Entre no nosso grupo exclusivo para receber promoções.',
      showNiches: true,
      whatsappGeneralUrl: 'https://chat.whatsapp.com/test-geral',
    };

    render(<AuraLandingView profile={profile} niches={[]} allowThemeToggle={false} />);

    // Não deve exibir nenhum dos 4 nichos fictícios padrão
    expect(screen.queryByText(/BELEZA, COSMÉTICOS E CUIDADO/i)).toBeNull();
    expect(screen.queryByText(/BEBÊ E CRIANÇA/i)).toBeNull();
    expect(screen.queryByText(/MERCADO & DESPENSA/i)).toBeNull();
    expect(screen.queryByText(/CASA, DECORAÇÃO E UTENSILIOS/i)).toBeNull();

    // Deve exibir o card alternativo da comunidade com botão geral
    expect(screen.getByText(/Comunidade VIP Oficial/i)).toBeDefined();
    expect(screen.getByText(/Grupos de Ofertas Exclusivas/i)).toBeDefined();
  });

  it('renderiza estritamente os nichos reais cadastrados pelo afiliado com suas fotos e descrições', () => {
    const realNiches: AuraNicheItem[] = [
      {
        id: 'nicho-tech',
        orderNumber: '01',
        name: 'Hardware & Tech VIP',
        tagline: 'Ofertas em Hardware & Tech',
        description: 'Os melhores preços em placas de vídeo e computadores.',
        image: 'data:image/jpeg;base64,mockimagedata',
        whatsappLink: '/g/nicho-tech',
        categoryBadge: 'Tecnologia',
        dealsTodayCount: 20,
        popularItems: ['RTX 4070', 'Ryzen 7', 'Monitores 144Hz'],
      },
    ];

    const profile = {
      title: 'Página Tech',
      headline: 'Ofertas Tech',
      subheadline: 'Descontos em informática no WhatsApp',
      showNiches: true,
    };

    render(<AuraLandingView profile={profile} niches={realNiches} allowThemeToggle={false} />);

    // Deve exibir o nicho real cadastrado no Hero e na Grid
    expect(screen.getAllByText(/Hardware & Tech VIP/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Os melhores preços em placas de vídeo e computadores/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/RTX 4070/i).length).toBeGreaterThanOrEqual(1);

    // Não deve exibir nichos falsos
    expect(screen.queryByText(/BELEZA, COSMÉTICOS E CUIDADO/i)).toBeNull();
  });
});
