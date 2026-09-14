import { createHash } from 'node:crypto';

export function buildShopeeAuthHeader(
  appId: string,
  secret: string,
  payload: string,
  timestamp: number,
): string {
  const signature = createHash('sha256')
    .update(`${appId}${timestamp}${payload}${secret}`)
    .digest('hex');
  return `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`;
}
