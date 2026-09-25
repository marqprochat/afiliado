import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
  amazonClientId: null,
  hasAmazonApiSecret: false,
  mlSessionSyncedAt: null,
  mlSessionSource: null,
  amazonSessionSyncedAt: null,
  amazonSessionSource: null,
  magaluSessionSyncedAt: null,
  magaluSessionSource: null,
  hasAwinFeedListUrl: false,
  awinFeedIds: [],
  awinPublisherId: null,
  hasAwinOffersApiToken: false,
  aliexpressAppKey: null,
  hasAliexpressAppSecret: false,
  aliexpressTrackingId: null,
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

  it('envia amazonClientId/amazonClientSecret quando preenchidos', async () => {
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
    fireEvent.change(screen.getByLabelText(/client id/i), { target: { value: 'cid-1' } });
    fireEvent.change(screen.getByLabelText(/client secret/i), { target: { value: 'sec-1' } });
    fireEvent.click(screen.getByRole('button', { name: /testar e salvar/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      fields: { amazonClientId: 'cid-1', amazonClientSecret: 'sec-1' },
      cookie: '',
    });
  });

  it('bloqueia o submit e mostra validação ao preencher só o Client ID (sem o Secret)', async () => {
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
    fireEvent.change(screen.getByLabelText(/client id/i), { target: { value: 'cid-only' } });
    fireEvent.click(screen.getByRole('button', { name: /testar e salvar/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(await screen.findByText(/client id e client secret/i)).toBeInTheDocument();
  });

  it('mostra "já salvo" no placeholder do Client Secret da Amazon quando hasAmazonApiSecret é true', () => {
    render(
      <MarketplaceDrawer
        kind="AMAZON"
        connection={{ ...baseConnection, hasAmazonApiSecret: true }}
        open
        onOpenChange={vi.fn()}
        onSubmit={vi.fn(async () => {})}
        pending={false}
        feedback={null}
      />,
    );
    expect(screen.getByLabelText(/client secret/i)).toHaveAttribute('placeholder', '•••• (já salvo)');
  });

  it('permite preencher e enviar Publisher ID e Token de Ofertas da Awin', async () => {
    const onSubmit = vi.fn(async () => {});
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MarketplaceDrawer
          kind="AWIN"
          connection={{
            ...baseConnection,
            kind: 'AWIN',
            hasAwinFeedListUrl: true,
            awinPublisherId: '987654',
            hasAwinOffersApiToken: true,
          }}
          open
          onOpenChange={vi.fn()}
          onSubmit={onSubmit}
          pending={false}
          feedback={null}
        />
      </QueryClientProvider>,
    );

    // Confirma que carregou o publisherId salvo
    const pubIdInput = screen.getByLabelText(/publisher id/i) as HTMLInputElement;
    expect(pubIdInput.value).toBe('987654');

    // Modifica o publisherId e preenche novo token
    fireEvent.change(pubIdInput, { target: { value: '112233' } });
    fireEvent.change(screen.getByLabelText(/token da offers api/i), {
      target: { value: 'token-offers-secret' },
    });

    fireEvent.click(screen.getByRole('button', { name: /testar e salvar/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      fields: {
        publisherId: '112233',
        offersApiToken: 'token-offers-secret',
      },
      cookie: '',
    });
  });
});
