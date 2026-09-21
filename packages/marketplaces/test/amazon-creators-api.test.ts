import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AmazonApiError, getAccessToken, resetAmazonApiState } from '../src/amazon/creators-api';

function fetchReturning(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe('getAccessToken', () => {
  beforeEach(() => {
    resetAmazonApiState();
  });

  it('faz POST no endpoint de token com client_credentials e devolve o access_token', async () => {
    const fetchImpl = fetchReturning(200, {
      access_token: 'tok-123',
      token_type: 'bearer',
      expires_in: 3600,
    });
    const token = await getAccessToken(
      { clientId: 'cid', clientSecret: 'csecret' },
      { fetchImpl, tokenEndpoint: 'https://api.amazon.com/auth/o2/token' },
    );
    expect(token).toBe('tok-123');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.amazon.com/auth/o2/token',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          grant_type: 'client_credentials',
          client_id: 'cid',
          client_secret: 'csecret',
          scope: 'creatorsapi::default',
        }),
      }),
    );
  });

  it('cacheia o token e não faz nova chamada enquanto ele não expirar', async () => {
    const fetchImpl = fetchReturning(200, { access_token: 'tok-abc', expires_in: 3600 });
    const creds = { clientId: 'cid2', clientSecret: 'csecret2' };
    await getAccessToken(creds, { fetchImpl });
    await getAccessToken(creds, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('lança AmazonApiError(AMAZON_API_UNAUTHORIZED) em 401', async () => {
    const fetchImpl = fetchReturning(401, { error: 'invalid_client' });
    await expect(
      getAccessToken({ clientId: 'bad', clientSecret: 'bad' }, { fetchImpl }),
    ).rejects.toThrow(AmazonApiError);
    try {
      await getAccessToken({ clientId: 'bad2', clientSecret: 'bad2' }, { fetchImpl });
    } catch (err) {
      expect((err as AmazonApiError).code).toBe('AMAZON_API_UNAUTHORIZED');
    }
  });

  it('lança AmazonApiError(AMAZON_API_ERROR) em outros erros HTTP', async () => {
    const fetchImpl = fetchReturning(500, {});
    await expect(
      getAccessToken({ clientId: 'x', clientSecret: 'y' }, { fetchImpl }),
    ).rejects.toMatchObject({ code: 'AMAZON_API_ERROR' });
  });
});
