import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MarketplaceDrawer } from '@/components/marketplaces/marketplace-drawer';
import type { MarketplaceConnection } from '@/lib/types';

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));

const conn = (over: Partial<MarketplaceConnection> = {}) =>
  ({
    kind: 'MERCADOLIVRE',
    status: 'OK',
    affiliateTag: 'w',
    mattWord: 'w',
    mattTool: '1',
    hasMlApi: false,
    mlApiAvailable: false,
    mlSessionSyncedAt: null,
    mlSessionSource: null,
    ...over,
  }) as MarketplaceConnection;

function renderDrawer(connection: MarketplaceConnection, onSubmit = vi.fn(async () => {})) {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <MarketplaceDrawer
        kind="MERCADOLIVRE"
        connection={connection}
        open
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
        pending={false}
        feedback={null}
      />
    </QueryClientProvider>,
  );
  return onSubmit;
}

describe('MarketplaceDrawer: etiqueta do ML', () => {
  it('mostra a etiqueta salva e envia a nova', () => {
    const onSubmit = renderDrawer(conn({ mlAffiliateTag: 'minha-tag' }));
    const input = screen.getByLabelText(/etiqueta de afiliado/i) as HTMLInputElement;
    expect(input.value).toBe('minha-tag');
    fireEvent.change(input, { target: { value: 'outra' } });
    fireEvent.click(screen.getByRole('button', { name: /testar e salvar/i }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ fields: expect.objectContaining({ mlTag: 'outra' }) }),
    );
  });

  it('esvaziar a etiqueta salva envia mlTag vazio para limpar', () => {
    const onSubmit = renderDrawer(conn({ mlAffiliateTag: 'minha-tag' }));
    fireEvent.change(screen.getByLabelText(/etiqueta de afiliado/i), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /testar e salvar/i }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ fields: expect.objectContaining({ mlTag: '' }) }),
    );
  });

  it('sem etiqueta salva e campo vazio, não envia mlTag', () => {
    const onSubmit = renderDrawer(conn({ mlAffiliateTag: null }));
    fireEvent.click(screen.getByRole('button', { name: /testar e salvar/i }));
    const payload = (onSubmit.mock.calls[0] as unknown as [{ fields: Record<string, string> }])[0];
    expect(payload.fields).not.toHaveProperty('mlTag');
  });
});
