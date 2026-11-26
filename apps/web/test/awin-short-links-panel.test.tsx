import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AwinShortLinksPanel } from '@/components/marketplaces/awin-short-links-panel';

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));

import { apiFetch } from '@/lib/api';
const apiFetchMock = vi.mocked(apiFetch);

let state: { enabled: boolean; quota: unknown; available: boolean; error?: string };

beforeEach(() => {
  state = { enabled: false, available: true, quota: { limit: 50, usage: 12, remaining: 38 } };
  apiFetchMock.mockReset();
  apiFetchMock.mockImplementation(async (path: string, init?: { json?: unknown }) => {
    if (path === '/marketplaces/awin/links/quota') return { ...state };
    if (path === '/marketplaces/awin/short-links') {
      state.enabled = (init?.json as { enabled: boolean }).enabled;
      return { enabled: state.enabled };
    }
    throw new Error(`unexpected call: ${path}`);
  });
});

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AwinShortLinksPanel />
    </QueryClientProvider>,
  );
}

describe('AwinShortLinksPanel', () => {
  it('mostra a cota usada hoje e o toggle desligado', async () => {
    renderPanel();
    expect(await screen.findByText('Links curtos usados hoje: 12 de 50')).toBeTruthy();
    const toggle = screen.getByRole('switch', { name: /links curtos no envio/i });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('ligar o toggle grava o setting', async () => {
    renderPanel();
    const toggle = await screen.findByRole('switch', { name: /links curtos no envio/i });
    await screen.findByText(/usados hoje/);
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith('/marketplaces/awin/short-links', {
        method: 'PUT',
        json: { enabled: true },
      }),
    );
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
  });

  it('cota sem limite informado e erro da Awin', async () => {
    state = { enabled: true, available: true, quota: { limit: null, usage: 3, remaining: null } };
    const { unmount } = renderPanel();
    expect(await screen.findByText('Links curtos usados hoje: 3')).toBeTruthy();
    unmount();
    state = { enabled: false, available: true, quota: null, error: 'Token inválido' };
    renderPanel();
    expect(await screen.findByText(/não foi possível consultar a cota/i)).toBeTruthy();
  });
});
