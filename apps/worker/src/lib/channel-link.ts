import { withSiteChannelParams } from '@afilados/core';
import { withAwinChannelRefs } from '@afilados/marketplaces';
import type { OutgoingMessage } from '../wa/gateway';

export interface ChannelizeLinkInput {
  /** Link que vai na mensagem (página do site ou link de afiliado). */
  link: string;
  /** `link` é a página do site (/ofertas/<slug>), não o link da loja. */
  viaSite: boolean;
  /** Origem do produto (ProductSource). */
  source: string;
  trackCode: string | null;
  batchId: string | null;
}

/**
 * Link de um canal: site → `?c=<código>&b=<lote>`; Awin direto → `clickref2`/`clickref3`;
 * demais lojas sem site → inalterado. Sem código de canal (canal desconhecido) → inalterado.
 */
export function channelizeLink(input: ChannelizeLinkInput): string {
  const { link, viaSite, source, trackCode, batchId } = input;
  if (!trackCode) return link;
  if (viaSite) return withSiteChannelParams(link, { channel: trackCode, batch: batchId });
  if (source === 'AWIN') return withAwinChannelRefs(link, { channel: trackCode, batch: batchId });
  return link;
}

/** Troca só o link numa mensagem já renderizada (o template é renderizado uma vez por item). */
export function swapLinkInMessage(
  message: OutgoingMessage,
  from: string,
  to: string,
): OutgoingMessage {
  if (!from || from === to) return message;
  const swap = (s: string) => s.split(from).join(to);
  switch (message.kind) {
    case 'image':
      return { ...message, caption: swap(message.caption) };
    case 'preview':
      return {
        ...message,
        text: swap(message.text),
        url: message.url === from ? to : swap(message.url),
      };
    case 'text':
      return { ...message, text: swap(message.text) };
  }
}
