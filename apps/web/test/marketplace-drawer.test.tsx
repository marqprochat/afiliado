import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MarketplaceDrawer } from '@/components/marketplaces/marketplace-drawer';
import type { MarketplaceConnection } from '@/lib/types';

const baseConnection: MarketplaceConnection = {
  kind: 'AMAZON',
  status: 'UNCONFIGURED',
  affiliateTag: null,
  appId: null,
  hasSecret: false,
  mattWord: null,
  mattTool: null,
  mlSessionSyncedAt: null,
  mlSessionSource: null,
  amazonSessionSyncedAt: null,
  amazonSessionSource: null,
  magaluSessionSyncedAt: null,
  magaluSessionSource: null,
  lastCheckedAt: null,
  lastError: null,
};

describe('MarketplaceDrawer', () => {
  it('envia os campos preenchidos e o cookie ao clicar em Testar e Salvar', async () => {
    const onSubmit = vi.fn(async () => {});
    render(
      <MarketplaceDrawer
        kind="AMAZON"
        connection={baseConnection}
        open
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
        pending={false}
        feedback={null}
      />,
    );

    fireEvent.change(screen.getByLabelText(/tag de associado amazon/i), {
      target: { value: 'minha-20' },
    });
    fireEvent.change(screen.getByLabelText(/cookie de sessão/i), {
      target: { value: 'session-id=abc123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /testar e salvar/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      fields: { affiliateTag: 'minha-20' },
      cookie: 'session-id=abc123',
    });
  });

  it('não exibe campo de cookie para a Shopee', () => {
    render(
      <MarketplaceDrawer
        kind="SHOPEE"
        connection={{ ...baseConnection, kind: 'SHOPEE' }}
        open
        onOpenChange={vi.fn()}
        onSubmit={vi.fn(async () => {})}
        pending={false}
        feedback={null}
      />,
    );
    expect(screen.queryByLabelText(/cookie de sessão/i)).not.toBeInTheDocument();
  });

  it('preenche os campos quando `connection` chega depois da abertura do drawer (deep-link)', () => {
    const { rerender } = render(
      <MarketplaceDrawer
        kind="AMAZON"
        connection={undefined}
        open
        onOpenChange={vi.fn()}
        onSubmit={vi.fn(async () => {})}
        pending={false}
        feedback={null}
      />,
    );
    expect(screen.getByLabelText(/tag de associado amazon/i)).toHaveValue('');

    rerender(
      <MarketplaceDrawer
        kind="AMAZON"
        connection={{ ...baseConnection, affiliateTag: 'ja-salva-20' }}
        open
        onOpenChange={vi.fn()}
        onSubmit={vi.fn(async () => {})}
        pending={false}
        feedback={null}
      />,
    );

    expect(screen.getByLabelText(/tag de associado amazon/i)).toHaveValue('ja-salva-20');
  });

  it('mostra "já salvo" no placeholder do secret quando hasSecret é true', () => {
    render(
      <MarketplaceDrawer
        kind="SHOPEE"
        connection={{ ...baseConnection, kind: 'SHOPEE', hasSecret: true }}
        open
        onOpenChange={vi.fn()}
        onSubmit={vi.fn(async () => {})}
        pending={false}
        feedback={null}
      />,
    );
    expect(screen.getByLabelText(/secret/i)).toHaveAttribute('placeholder', '•••• (já salvo)');
  });
});
