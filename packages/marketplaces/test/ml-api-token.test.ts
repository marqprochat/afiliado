import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  buildMlAuthUrl,
  ensureMlAccessToken,
  exchangeMlCode,
  generatePkce,
  refreshMlTokens,
  type MlApiTokens,
} from '../src/mercadolivre/api-token';

const cfg = { clientId: 'cid-123', clientSecret: 'secret-xyz' };
const NOW = Date.parse('2026-09-29T12:00:00.000Z');

function tokenFetch(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch;
}

function sentForm(fetchImpl: typeof fetch): URLSearchParams {
  const init = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock
    .calls[0]![1];
  return init.body as URLSearchParams;
}

describe('generatePkce', () => {
  it('o challenge é o SHA-256 base64url do verifier', () => {
    const { verifier, challenge } = generatePkce();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
  });

  it('gera valores diferentes a cada chamada', () => {
    expect(generatePkce().verifier).not.toBe(generatePkce().verifier);
  });
});

describe('buildMlAuthUrl', () => {
  it('monta a URL de autorização com PKCE S256 e state', () => {
    const url = new URL(
      buildMlAuthUrl({
        clientId: 'cid-123',
        redirectUri: 'https://painel.exemplo.com.br/callbackml',
        state: 'st-1',
        codeChallenge: 'ch-1',
      }),
    );
    expect(url.origin + url.pathname).toBe('https://auth.mercadolivre.com.br/authorization');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'cid-123',
      redirect_uri: 'https://painel.exemplo.com.br/callbackml',
      state: 'st-1',
      code_challenge: 'ch-1',
      code_challenge_method: 'S256',
    });
  });
});

describe('exchangeMlCode', () => {
  it('troca o código por tokens enviando o verifier e calcula o vencimento', async () => {
    const fetchImpl = tokenFetch(200, {
      access_token: 'acc-1',
      refresh_token: 'ref-1',
      expires_in: 21600,
      user_id: 229863486,
    });
    const tokens = await exchangeMlCode(
      cfg,
      {
        code: 'TG-abc',
        redirectUri: 'https://painel.exemplo.com.br/callbackml',
        verifier: 'ver-1',
      },
      { fetchImpl, now: () => NOW },
    );
    const form = sentForm(fetchImpl);
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('client_id')).toBe('cid-123');
    expect(form.get('client_secret')).toBe('secret-xyz');
    expect(form.get('code')).toBe('TG-abc');
    expect(form.get('redirect_uri')).toBe('https://painel.exemplo.com.br/callbackml');
    expect(form.get('code_verifier')).toBe('ver-1');
    expect(tokens).toEqual({
      refreshToken: 'ref-1',
      accessToken: 'acc-1',
      expiresAt: '2026-09-29T18:00:00.000Z',
      userId: '229863486',
      connectedAt: '2026-09-29T12:00:00.000Z',
    });
  });

  it('código recusado vira ML_API_UNAUTHORIZED sem vazar o segredo na mensagem', async () => {
    const fetchImpl = tokenFetch(400, {
      error: 'invalid_grant',
      message: 'Error validating grant',
    });
    const err = await exchangeMlCode(
      cfg,
      { code: 'ruim', redirectUri: 'https://x/callbackml', verifier: 'v' },
      { fetchImpl, now: () => NOW },
    ).catch((e) => e);
    expect(err).toMatchObject({ code: 'ML_API_UNAUTHORIZED' });
    expect(String(err.message)).toContain('invalid_grant');
    expect(String(err.message)).not.toContain('secret-xyz');
  });
});

describe('refreshMlTokens', () => {
  it('renova com o refresh_token e devolve o novo refresh_token', async () => {
    const fetchImpl = tokenFetch(200, {
      access_token: 'acc-2',
      refresh_token: 'ref-2',
      expires_in: 21600,
    });
    const tokens = await refreshMlTokens(cfg, 'ref-1', { fetchImpl, now: () => NOW });
    const form = sentForm(fetchImpl);
    expect(form.get('grant_type')).toBe('refresh_token');
    expect(form.get('refresh_token')).toBe('ref-1');
    expect(tokens.refreshToken).toBe('ref-2');
    expect(tokens.accessToken).toBe('acc-2');
    expect(tokens.expiresAt).toBe('2026-09-29T18:00:00.000Z');
  });

  it('se a resposta não trouxer novo refresh_token, mantém o antigo', async () => {
    const fetchImpl = tokenFetch(200, { access_token: 'acc-2', expires_in: 21600 });
    const tokens = await refreshMlTokens(cfg, 'ref-1', { fetchImpl, now: () => NOW });
    expect(tokens.refreshToken).toBe('ref-1');
  });
});

describe('ensureMlAccessToken', () => {
  const base: MlApiTokens = {
    refreshToken: 'ref-1',
    accessToken: 'acc-1',
    expiresAt: '2026-09-29T18:00:00.000Z',
    userId: '229863486',
    connectedAt: '2026-09-29T10:00:00.000Z',
  };

  it('reaproveita o access token ainda válido sem chamar a API nem gravar', async () => {
    const fetchImpl = tokenFetch(200, {});
    const save = vi.fn(async () => {});
    const res = await ensureMlAccessToken(base, cfg, save, { fetchImpl, now: () => NOW });
    expect(res.accessToken).toBe('acc-1');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('renova quando faltam menos de 5 minutos para vencer', async () => {
    const fetchImpl = tokenFetch(200, {
      access_token: 'acc-2',
      refresh_token: 'ref-2',
      expires_in: 21600,
    });
    const save = vi.fn(async () => {});
    const almostExpired = { ...base, expiresAt: '2026-09-29T12:04:00.000Z' };
    const res = await ensureMlAccessToken(almostExpired, cfg, save, { fetchImpl, now: () => NOW });
    expect(res.accessToken).toBe('acc-2');
  });

  it('grava o novo refresh_token ANTES de devolver o access token', async () => {
    const order: string[] = [];
    const fetchImpl = tokenFetch(200, {
      access_token: 'acc-2',
      refresh_token: 'ref-2',
      expires_in: 21600,
    });
    const save = vi.fn(async (t: MlApiTokens) => {
      order.push(`save:${t.refreshToken}`);
    });
    const expired = { ...base, accessToken: undefined, expiresAt: undefined };
    const res = await ensureMlAccessToken(expired, cfg, save, { fetchImpl, now: () => NOW });
    order.push(`return:${res.accessToken}`);
    expect(order).toEqual(['save:ref-2', 'return:acc-2']);
    expect(save.mock.calls[0]![0]).toMatchObject({
      refreshToken: 'ref-2',
      accessToken: 'acc-2',
      userId: '229863486',
      connectedAt: '2026-09-29T10:00:00.000Z',
    });
  });

  it('se a renovação falhar, propaga o erro e não grava nada', async () => {
    const fetchImpl = tokenFetch(400, { error: 'invalid_grant', message: 'refresh usado' });
    const save = vi.fn(async () => {});
    const expired = { ...base, accessToken: undefined, expiresAt: undefined };
    await expect(
      ensureMlAccessToken(expired, cfg, save, { fetchImpl, now: () => NOW }),
    ).rejects.toMatchObject({
      code: 'ML_API_UNAUTHORIZED',
    });
    expect(save).not.toHaveBeenCalled();
  });
});
