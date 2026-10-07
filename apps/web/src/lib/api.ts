export class ApiClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export function getWsUrl(): string {
  if (typeof window !== 'undefined') {
    const envUrl = process.env.NEXT_PUBLIC_WS_URL;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const hostname = window.location.hostname;

    // Se houver uma URL customizada configurada e não for localhost enquanto o navegador acessa outro host
    if (envUrl && (!envUrl.includes('localhost') || hostname === 'localhost' || hostname === '127.0.0.1')) {
      return envUrl;
    }

    // Se acessado por IP ou domínio (ex: 192.168.15.7:3010), derivar porta da API (3011) ou mesma porta
    const port = window.location.port === '3010' ? '3011' : (window.location.port === '3000' ? '3001' : (window.location.port ? '3011' : ''));
    const host = port ? `${hostname}:${port}` : hostname;
    return `${protocol}//${host}/api/v1/ws`;
  }
  return process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3001/api/v1/ws';
}

export const WS_URL = 'ws://localhost:3001/api/v1/ws';

type Init = Omit<RequestInit, 'body'> & { json?: unknown; body?: BodyInit };

export async function apiFetch<T = unknown>(path: string, init: Init = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const h: Record<string, string> = { ...(headers as Record<string, string> | undefined) };
  let body = rest.body;
  if (json !== undefined) {
    h['content-type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (
    typeof body === 'string' &&
    !h['content-type'] &&
    (body.trimStart().startsWith('{') || body.trimStart().startsWith('['))
  ) {
    h['content-type'] = 'application/json';
  }
  const res = await fetch(`/api/v1${path}`, { ...rest, body, headers: h, credentials: 'include' });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as {
    error?: { code: string; message: string };
  } | null;
  if (!res.ok) {
    const code = data?.error?.code ?? 'INTERNAL';
    const message = data?.error?.message ?? `HTTP ${res.status}`;
    if (
      res.status === 401 &&
      typeof window !== 'undefined' &&
      window.location.pathname !== '/login'
    ) {
      window.location.assign('/login');
    }
    throw new ApiClientError(code, message, res.status);
  }
  return data as T;
}
