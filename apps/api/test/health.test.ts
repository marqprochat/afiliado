import { describe, it, expect, afterAll } from 'vitest';
import { buildApp } from '../src/app';

const app = await buildApp({ logger: false });
afterAll(() => app.close());

describe('GET /api/v1/health', () => {
  it('responde ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
  it('rota inexistente devolve envelope de erro', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/nao-existe' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Rota não encontrada' } });
  });
});
