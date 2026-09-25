import { describe, it, expect } from 'vitest';
import { whatsappToTelegramHtml } from '../src/telegram-format';

describe('whatsappToTelegramHtml', () => {
  it('converte *negrito*, _itálico_ e ~riscado~', () => {
    expect(whatsappToTelegramHtml('*Oferta* _imperdível_ ~de graça~')).toBe(
      '<b>Oferta</b> <i>imperdível</i> <s>de graça</s>',
    );
  });

  it('converte `código` e ```bloco```', () => {
    expect(whatsappToTelegramHtml('use `npm i` ou ```npm install```')).toBe(
      'use <code>npm i</code> ou <pre>npm install</pre>',
    );
  });

  it('escapa caracteres HTML fora de marcação', () => {
    expect(whatsappToTelegramHtml('R$ 10 < R$ 20 & cia')).toBe('R$ 10 &lt; R$ 20 &amp; cia');
  });

  it('não formata sublinhados dentro de URLs', () => {
    const text = 'Confira: https://s.shopee.com.br/abc_def_ghi *agora*';
    expect(whatsappToTelegramHtml(text)).toBe(
      'Confira: https://s.shopee.com.br/abc_def_ghi <b>agora</b>',
    );
  });

  it('mantém texto sem marcação intacto', () => {
    expect(whatsappToTelegramHtml('preço 19,90 - frete grátis')).toBe('preço 19,90 - frete grátis');
  });
});
