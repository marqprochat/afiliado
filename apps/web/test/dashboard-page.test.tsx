import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DashboardClient } from '@/components/metrics/dashboard-client';
import {
  automationFixture,
  clicksFixture,
  groupsFixture,
  overviewFixture,
  sendsFixture,
} from './metrics-fixtures';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams('period=7d'),
}));
vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '@/lib/api';
const apiFetchMock = vi.mocked(apiFetch);

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DashboardClient />
    </QueryClientProvider>,
  );
}

describe('DashboardClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path.startsWith('/metrics/overview')) return overviewFixture;
      if (path.startsWith('/metrics/groups')) return groupsFixture;
      if (path.startsWith('/metrics/sends')) return sendsFixture;
      if (path.startsWith('/metrics/products')) throw new Error('falhou');
      if (path.startsWith('/metrics/clicks')) return clicksFixture;
      if (path.startsWith('/metrics/automation')) return automationFixture;
      throw new Error(`rota inesperada ${path}`);
    });
  });

  it('renderiza todas as seções e isola o erro de uma delas', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Dashboard & Métricas' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('kpi-joins')).toHaveTextContent('40'));
    for (const title of ['Grupos', 'Envios', 'Produtos', 'Cliques', 'Espelhamento e automações']) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Não foi possível carregar produtos.');
    expect(await screen.findByText('7 cliques no período')).toBeInTheDocument();

    const productCalls = () =>
      apiFetchMock.mock.calls.filter(([p]) => String(p).startsWith('/metrics/products')).length;
    const before = productCalls();
    fireEvent.click(within(alert).getByRole('button', { name: 'Tentar novamente' }));
    await waitFor(() => expect(productCalls()).toBe(before + 1));
  });

  it('chama a api com o período da URL', async () => {
    renderPage();
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    const overviewCall = apiFetchMock.mock.calls.find(([p]) =>
      String(p).startsWith('/metrics/overview?'),
    );
    expect(String(overviewCall?.[0])).toMatch(/from=.*&to=/);
  });

  it('troca período e grupo pela URL', async () => {
    renderPage();
    await screen.findByRole('option', { name: 'Grupo 1' });
    fireEvent.click(screen.getByRole('button', { name: '30 dias' }));
    expect(push).toHaveBeenLastCalledWith('/dashboard', { scroll: false });
    fireEvent.change(screen.getByLabelText('Grupo'), { target: { value: 'g1@g.us' } });
    expect(push).toHaveBeenLastCalledWith('/dashboard?period=7d&groupJid=g1%40g.us', {
      scroll: false,
    });
  });
});
