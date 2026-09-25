import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MarketplacesClient } from '@/app/(app)/marketplaces/marketplaces-client';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams('open=AMAZON'),
}));

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));

import { apiFetch } from '@/lib/api';
const apiFetchMock = vi.mocked(apiFetch);

const baseConnection = {
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

const marketplaceList = [
  { ...baseConnection, kind: 'SHOPEE' },
  { ...baseConnection, kind: 'MERCADOLIVRE' },
  { ...baseConnection, kind: 'AMAZON' },
  { ...baseConnection, kind: 'MAGALU' },
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MarketplacesClient />
    </QueryClientProvider>,
  );
}

function calls(method: string, path?: string) {
  return apiFetchMock.mock.calls.filter(
    ([p, init]) =>
      (init as { method?: string } | undefined)?.method === method && (!path || p === path),
  );
}

function getCalls(path: string) {
  return apiFetchMock.mock.calls.filter(
    ([p, init]) => p === path && !(init as { method?: string } | undefined)?.method,
  );
}

beforeEach(() => {
  apiFetchMock.mockReset();
  replace.mockReset();
});

describe('MarketplacesClient handleSubmit', () => {
  it('não chama PUT quando payload.fields está vazio (só cookie preenchido)', async () => {
    apiFetchMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === '/marketplaces' && !init?.method) return marketplaceList;
      if (path === '/marketplaces/AMAZON/session' && init?.method === 'POST') {
        return { ...baseConnection, kind: 'AMAZON', status: 'OK', amazonSessionSyncedAt: 'now' };
      }
      if (path === '/marketplaces/AMAZON/check' && init?.method === 'POST') {
        return { ...baseConnection, kind: 'AMAZON', status: 'OK' };
      }
      throw new Error(`unexpected call: ${path} ${init?.method}`);
    });

    renderPage();
    await screen.findByLabelText(/tag de associado amazon/i);

    fireEvent.change(screen.getByLabelText(/cookie de sessão/i), {
      target: { value: 'session-id=abc123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /testar e salvar/i }));

    await waitFor(() => expect(calls('POST', '/marketplaces/AMAZON/check')).toHaveLength(1));

    expect(calls('PUT', '/marketplaces/AMAZON')).toHaveLength(0);
    expect(calls('POST', '/marketplaces/AMAZON/session')).toHaveLength(1);
  });

  it('refaz o refetch da lista mesmo quando o check falha após a sessão ser salva com sucesso', async () => {
    apiFetchMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === '/marketplaces' && !init?.method) return marketplaceList;
      if (path === '/marketplaces/AMAZON/session' && init?.method === 'POST') {
        return { ...baseConnection, kind: 'AMAZON', status: 'OK', amazonSessionSyncedAt: 'now' };
      }
      if (path === '/marketplaces/AMAZON/check' && init?.method === 'POST') {
        throw new Error('Falha na validação das credenciais.');
      }
      throw new Error(`unexpected call: ${path} ${init?.method}`);
    });

    renderPage();
    await screen.findByLabelText(/tag de associado amazon/i);

    const initialGetCount = getCalls('/marketplaces').length;

    fireEvent.change(screen.getByLabelText(/cookie de sessão/i), {
      target: { value: 'session-id=abc123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /testar e salvar/i }));

    await waitFor(() =>
      expect(getCalls('/marketplaces').length).toBeGreaterThan(initialGetCount),
    );
    // A sessão foi salva com sucesso mesmo com o check falhando depois.
    expect(calls('POST', '/marketplaces/AMAZON/session')).toHaveLength(1);
  });

  it('caminho feliz: fields + cookie + check todos com sucesso resultam em feedback de sucesso', async () => {
    apiFetchMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === '/marketplaces' && !init?.method) return marketplaceList;
      if (path === '/marketplaces/AMAZON' && init?.method === 'PUT') {
        return { ...baseConnection, kind: 'AMAZON', affiliateTag: 'minha-20' };
      }
      if (path === '/marketplaces/AMAZON/session' && init?.method === 'POST') {
        return { ...baseConnection, kind: 'AMAZON', status: 'OK', amazonSessionSyncedAt: 'now' };
      }
      if (path === '/marketplaces/AMAZON/check' && init?.method === 'POST') {
        return { ...baseConnection, kind: 'AMAZON', status: 'OK', affiliateTag: 'minha-20' };
      }
      throw new Error(`unexpected call: ${path} ${init?.method}`);
    });

    renderPage();
    await screen.findByLabelText(/tag de associado amazon/i);

    fireEvent.change(screen.getByLabelText(/tag de associado amazon/i), {
      target: { value: 'minha-20' },
    });
    fireEvent.change(screen.getByLabelText(/cookie de sessão/i), {
      target: { value: 'session-id=abc123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /testar e salvar/i }));

    expect(await screen.findByText(/conexão validada com sucesso/i)).toBeInTheDocument();
    expect(calls('PUT', '/marketplaces/AMAZON')).toHaveLength(1);
    expect(calls('POST', '/marketplaces/AMAZON/session')).toHaveLength(1);
    expect(calls('POST', '/marketplaces/AMAZON/check')).toHaveLength(1);
  });
});
