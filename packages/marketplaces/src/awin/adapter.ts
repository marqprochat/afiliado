import type { AwinCredentials, ConnectionStatus, MarketplaceAdapter } from '../adapter';
import { UnsupportedError } from '../tag-adapter';
import { listDatafeeds, type AwinDatafeedOptions } from './datafeed';
import { buildAwinTrackingLink, DEFAULT_AWIN_PARTNERS } from './programmes';

export function createAwinAdapter(
  opts: AwinDatafeedOptions = {},
): MarketplaceAdapter<AwinCredentials> {
  return {
    kind: 'AWIN',

    async checkConnection(creds): Promise<ConnectionStatus> {
      if (!creds?.feedListUrl) {
        return { ok: false, error: 'Cole o link da lista de feeds da Awin' };
      }
      try {
        const feeds = await listDatafeeds(creds.feedListUrl, opts);
        const active = feeds.filter((f) => f.membershipStatus === 'active');
        if (active.length === 0) {
          return { ok: false, error: 'Nenhum programa aprovado na sua conta Awin' };
        }
        if (creds.feedIds?.length) {
          const available = new Set(active.map((f) => f.feedId));
          const missing = creds.feedIds.filter((id) => !available.has(id));
          if (missing.length > 0) {
            return {
              ok: false,
              error: `Feed ID(s) não encontrado(s) na sua conta Awin: ${missing.join(', ')}`,
            };
          }
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

    async toAffiliateLink(creds, url, subId) {
      let hostname: string;
      try {
        hostname = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
      } catch {
        hostname = '';
      }

      // 1. Se já for um deep link do awin1.com
      if (hostname === 'awin1.com') {
        if (!subId) return url;
        const u = new URL(url);
        u.searchParams.set('clickref', subId);
        return u.toString();
      }

      // 2. Se for um site parceiro (ex: drogal.com.br)
      const partners = { ...DEFAULT_AWIN_PARTNERS, ...(creds?.partners || {}) };
      const partner = partners[hostname];

      if (partner && creds?.publisherId) {
        return buildAwinTrackingLink({
          publisherId: creds.publisherId,
          advertiserId: partner.advertiserId,
          destinationUrl: url,
          ...(subId ? { subId } : {}),
        });
      }

      throw new UnsupportedError(
        'Awin: só é possível gerar link de afiliado para produtos de parceiros Awin aprovados ou do catálogo importado',
      );
    },
  };
}
