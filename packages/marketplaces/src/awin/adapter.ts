import type { AwinCredentials, ConnectionStatus, MarketplaceAdapter } from '../adapter';
import { UnsupportedError } from '../tag-adapter';
import { listDatafeeds, type AwinDatafeedOptions } from './datafeed';

export function createAwinAdapter(opts: AwinDatafeedOptions = {}): MarketplaceAdapter<AwinCredentials> {
  return {
    kind: 'AWIN',

    async checkConnection(creds): Promise<ConnectionStatus> {
      if (!creds?.datafeedApiKey || !creds.feedIds?.length) {
        return { ok: false, error: 'Informe a Datafeed API Key e ao menos um Feed ID' };
      }
      try {
        const feeds = await listDatafeeds(creds.datafeedApiKey, opts);
        const available = new Set(feeds.map((f) => f.feedId));
        const missing = creds.feedIds.filter((id) => !available.has(id));
        if (missing.length > 0) {
          return { ok: false, error: `Feed ID(s) não encontrado(s) na sua conta Awin: ${missing.join(', ')}` };
        }
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },

    async fetchByUrls(): Promise<[]> {
      // Não há endpoint de lookup por URL ao vivo na Awin — resolvido pela camada de
      // aplicação consultando o cache local (AwinCatalogProduct), fora deste pacote.
      return [];
    },

    async toAffiliateLink(_creds, url, subId) {
      if (!url.includes('awin1.com')) {
        throw new UnsupportedError(
          'Awin: só é possível gerar link de afiliado para produtos vindos do catálogo importado',
        );
      }
      if (!subId) return url;
      const u = new URL(url);
      u.searchParams.set('clickref', subId);
      return u.toString();
    },
  };
}
