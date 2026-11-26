import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RuleForm } from '@/components/automations/rule-form';

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn(), ApiClientError: class extends Error {} }));

import { apiFetch } from '@/lib/api';
const apiFetchMock = vi.mocked(apiFetch);

beforeEach(() => {
  apiFetchMock.mockReset();
  apiFetchMock.mockImplementation(async (path: string) => {
    if (path === '/wa/sessions') return [{ id: 's1', label: 'Chip 1', status: 'CONNECTED' }];
    if (path === '/wa/sessions/s1/groups') {
      return [{ id: 'g1', jid: 'g1@g.us', name: 'Grupo 1', botIsAdmin: true }];
    }
    if (path === '/telegram/chats') return [];
    if (path === '/templates') return [{ id: 't1', name: 'Padrão', isDefault: true }];
    if (path === '/automations') return { id: 'r1' };
    throw new Error(`unexpected call: ${path}`);
  });
});

function renderForm() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RuleForm onCreated={vi.fn()} />
    </QueryClientProvider>,
  );
}

async function fillRequired() {
  fireEvent.change(screen.getByLabelText(/nome da automação/i), { target: { value: 'Awin' } });
  fireEvent.change(screen.getByLabelText(/keywords obrigatórias/i), {
    target: { value: 'protetor' },
  });
  await screen.findByRole('option', { name: /chip 1/i });
  fireEvent.change(screen.getByLabelText(/sessão whatsapp/i), { target: { value: 's1' } });
  fireEvent.click(await screen.findByRole('checkbox', { name: /grupo 1/i }));
  await screen.findByRole('option', { name: /padrão/i });
  fireEvent.change(screen.getByLabelText(/template/i), { target: { value: 't1' } });
}

const postedBody = () =>
  (apiFetchMock.mock.calls.find(([p]) => p === '/automations')?.[1] as { json: any } | undefined)
    ?.json;

describe('RuleForm: opções de EPC da Awin', () => {
  it('só aparecem com a Awin marcada e vão no corpo da regra', async () => {
    renderForm();
    expect(screen.queryByLabelText(/priorizar lojas com melhor epc/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Shopee' }));
    fireEvent.click(screen.getByRole('button', { name: 'Awin' }));
    fireEvent.click(screen.getByLabelText(/priorizar lojas com melhor epc/i));
    fireEvent.change(screen.getByLabelText(/epc mínimo/i), { target: { value: '0,35' } });
    await fillRequired();
    fireEvent.click(screen.getByRole('button', { name: /criar automação/i }));
    await vi.waitFor(() => expect(postedBody()).toBeTruthy());
    expect(postedBody()).toMatchObject({
      marketplaces: ['AWIN'],
      awinPrioritizeEpc: true,
      awinMinEpc: 0.35,
    });
  });

  it('sem a Awin não envia as opções', async () => {
    renderForm();
    await fillRequired();
    fireEvent.click(screen.getByRole('button', { name: /criar automação/i }));
    await vi.waitFor(() => expect(postedBody()).toBeTruthy());
    expect(postedBody().awinPrioritizeEpc).toBe(false);
    expect(postedBody().awinMinEpc).toBeUndefined();
  });
});
