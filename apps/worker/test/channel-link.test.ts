import { describe, it, expect } from 'vitest';
import { channelizeLink, swapLinkInMessage } from '../src/lib/channel-link';
import type { OutgoingMessage } from '../src/wa/gateway';

const AWIN = 'https://www.awin1.com/cread.php?awinmid=1&awinaffid=2&clickref=aff';
const SITE = 'https://site.test/ofertas/tv-ab12';

describe('channelizeLink', () => {
  it('link do site recebe ?c=&b=', () => {
    expect(
      channelizeLink({
        link: SITE,
        viaSite: true,
        source: 'AWIN',
        trackCode: 'wAbc12',
        batchId: 'b1',
      }),
    ).toBe(`${SITE}?c=wAbc12&b=b1`);
  });

  it('Awin direto recebe clickref2/3 e mantém clickref', () => {
    const out = new URL(
      channelizeLink({
        link: AWIN,
        viaSite: false,
        source: 'AWIN',
        trackCode: 'wAbc12',
        batchId: 'b1',
      }),
    );
    expect(out.searchParams.get('clickref')).toBe('aff');
    expect(out.searchParams.get('clickref2')).toBe('wAbc12');
    expect(out.searchParams.get('clickref3')).toBe('b1');
  });

  it('demais lojas sem site ficam iguais', () => {
    const shopee = 'https://s.shopee.com.br/abc';
    expect(
      channelizeLink({
        link: shopee,
        viaSite: false,
        source: 'SHOPEE',
        trackCode: 'wAbc12',
        batchId: 'b1',
      }),
    ).toBe(shopee);
  });

  it('sem código de canal fica igual (mesmo com lote)', () => {
    expect(
      channelizeLink({ link: SITE, viaSite: true, source: 'AWIN', trackCode: null, batchId: 'b1' }),
    ).toBe(SITE);
    expect(
      channelizeLink({
        link: AWIN,
        viaSite: false,
        source: 'AWIN',
        trackCode: null,
        batchId: 'b1',
      }),
    ).toBe(AWIN);
  });
});

describe('swapLinkInMessage', () => {
  it('troca o link na legenda da imagem (todas as ocorrências)', () => {
    const msg: OutgoingMessage = { kind: 'image', imageUrl: 'x', caption: `a ${SITE} b ${SITE}` };
    const out = swapLinkInMessage(msg, SITE, `${SITE}?c=w1`);
    expect(out).toEqual({ kind: 'image', imageUrl: 'x', caption: `a ${SITE}?c=w1 b ${SITE}?c=w1` });
    expect(msg.kind === 'image' && msg.caption).toBe(`a ${SITE} b ${SITE}`);
  });

  it('troca texto e url da prévia', () => {
    const msg: OutgoingMessage = {
      kind: 'preview',
      text: `oi ${SITE}`,
      url: SITE,
      title: 't',
      description: 'd',
      thumbnailUrl: '',
    };
    expect(swapLinkInMessage(msg, SITE, 'https://n')).toMatchObject({
      text: 'oi https://n',
      url: 'https://n',
    });
  });

  it('mesmo link devolve a mesma mensagem', () => {
    const msg: OutgoingMessage = { kind: 'text', text: SITE };
    expect(swapLinkInMessage(msg, SITE, SITE)).toBe(msg);
  });
});
