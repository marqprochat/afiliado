import { buildAffiliateUrl } from '@afilados/core';
import { hasTagCredentials, requiredTagFields, type TagCredentials } from '@afilados/shared';
import type { ConnectionStatus, MarketplaceAdapter } from './adapter';

export class UnsupportedError extends Error {
  constructor(message = 'disponível na fase 3') {
    super(message);
    this.name = 'UnsupportedError';
  }
}

export type TagKind = 'AMAZON' | 'MERCADOLIVRE' | 'MAGALU';

export function createTagAdapter(kind: TagKind): MarketplaceAdapter<TagCredentials> {
  return {
    kind,
    async checkConnection(creds): Promise<ConnectionStatus> {
      if (hasTagCredentials(kind, creds)) return { ok: true };
      return { ok: false, error: `Informe: ${requiredTagFields(kind).join(', ')}` };
    },
    async fetchByUrls() {
      throw new UnsupportedError();
    },
    async toAffiliateLink(creds, url) {
      return buildAffiliateUrl(kind, url, creds);
    },
  };
}
