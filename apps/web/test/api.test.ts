import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiFetch, ApiClientError } from '@/lib/api';

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

describe('apiFetch', () => {
  it('prefixa /api/v1, envia JSON e cookies', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const r = await apiFetch<{ ok: boolean }>('/health', { method: 'POST', json: { a: 1 } });
    expect(r).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/health');
    expect(init.credentials).toBe('include');
    expect(init.headers['content-type']).toBe('application/json');
    expect(init.body).toBe('{"a":1}');
  });
  it('204 devolve undefined', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    expect(await apiFetch('/auth/logout', { method: 'POST' })).toBeUndefined();
  });
  it('erro vira ApiClientError com code/status', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'QUEUE_FULL', message: 'Fila cheia' } }), {
        status: 400,
      }),
    );
    await expect(apiFetch('/queue', { method: 'POST', json: {} })).rejects.toMatchObject({
      name: 'ApiClientError',
      code: 'QUEUE_FULL',
      message: 'Fila cheia',
      status: 400,
    });
  });
  it('401 fora do /login redireciona', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { pathname: '/produtos', assign });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'x' } }), {
        status: 401,
      }),
    );
    await expect(apiFetch('/me')).rejects.toBeInstanceOf(ApiClientError);
    expect(assign).toHaveBeenCalledWith('/login');
  });
});
