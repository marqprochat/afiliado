import type { Redis } from 'ioredis';

// KEYS[1]=bucket  ARGV[1]=ratePerMs  ARGV[2]=capacity  ARGV[3]=nowMs
// Retorna 0 se consumiu um token, senão ms até o próximo token.
const LUA = `
local b = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(b[1]); local ts = tonumber(b[2])
local rate = tonumber(ARGV[1]); local cap = tonumber(ARGV[2]); local now = tonumber(ARGV[3])
if tokens == nil then tokens = cap; ts = now end
tokens = math.min(cap, tokens + (now - ts) * rate)
local wait = 0
if tokens >= 1 then tokens = tokens - 1 else wait = math.ceil((1 - tokens) / rate) end
redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', KEYS[1], math.ceil(cap / rate) + 60000)
return wait
`;

export class TokenBucket {
  private readonly ratePerMs: number;
  constructor(
    private readonly redis: Redis,
    private readonly key: string,
    ratePerMin: number,
    private readonly capacity = ratePerMin,
  ) {
    this.ratePerMs = ratePerMin / 60_000;
  }
  /** 0 = token consumido; >0 = ms a esperar antes de tentar de novo. */
  async take(): Promise<number> {
    const r = await this.redis.eval(LUA, 1, this.key, this.ratePerMs, this.capacity, Date.now());
    return Number(r);
  }
}

export async function waitForToken(
  bucket: { take(): Promise<number> },
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
) {
  for (;;) {
    const wait = await bucket.take();
    if (wait === 0) return;
    await sleep(wait);
  }
}

export function jitter(ms: number, pct = 0.15, rng: () => number = Math.random) {
  const delta = ms * pct;
  return Math.round(ms - delta + rng() * 2 * delta);
}
