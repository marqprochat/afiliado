import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CallbackMlPage from '@/app/callbackml/page';

const CALLBACK_URL = '/api/v1/marketplaces/mercadolivre/oauth/callback';

function respond(status: number, body: unknown = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function openAt(search: string) {
  window.history.pushState({}, '', `/callbackml${search}`);
}

describe('página /callbackml (retorno do OAuth do Mercado Livre)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.pushState({}, '', '/');
  });

  it('conclui a conexão enviando code e state com a sessão do painel', async () => {
    const fetchMock = vi.fn(async () => respond(200, { hasMlApi: true }));
    vi.stubGlobal('fetch', fetchMock);
    openAt('?code=TG-abc&state=st-1');

    render(<CallbackMlPage />);

    expect(await screen.findByText(/conectado! voltando/i)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      CALLBACK_URL,
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ code: 'TG-abc', state: 'st-1' }),
      }),
    );
  });

  it('sem sessão (401) não perde o código: oferece tentar de novo e reenvia os mesmos dados', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respond(401, { error: { message: 'não autenticado' } }))
      .mockResolvedValueOnce(respond(200, {}));
    vi.stubGlobal('fetch', fetchMock);
    openAt('?code=TG-abc&state=st-1');

    render(<CallbackMlPage />);

    const retry = await screen.findByRole('button', { name: /tentar de novo/i });
    fireEvent.click(retry);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const bodies = fetchMock.mock.calls.map((c) => (c[1] as RequestInit).body);
    expect(bodies[1]).toBe(bodies[0]);
    expect(await screen.findByText(/conectado! voltando/i)).toBeTruthy();
  });

  it('erro da API mostra a mensagem e o endereço para uso manual', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        respond(400, { error: { message: 'Autorização expirada ou inválida — refaça a conexão' } }),
      ),
    );
    openAt('?code=TG-abc&state=st-1');

    render(<CallbackMlPage />);

    expect(await screen.findByText(/autorização expirada ou inválida/i)).toBeTruthy();
    expect(screen.getByText(/uso manual/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /tentar de novo/i })).toBeNull();
  });

  it('erro devolvido pelo Mercado Livre na URL não chama a API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    openAt('?error=access_denied');

    render(<CallbackMlPage />);

    expect(await screen.findByText(/access_denied/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sem código na URL explica como conectar e não chama a API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    openAt('');

    render(<CallbackMlPage />);

    expect(await screen.findByText(/nenhum código de autorização/i)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
