import { describe, it, expect } from 'vitest';
import { parseCookieString } from '../src/cookie-parser';

describe('parseCookieString', () => {
  it('separa múltiplos cookies no formato nome=valor; nome=valor', () => {
    expect(parseCookieString('MELI_SESSION=abc123; other=xyz', 'MERCADOLIVRE')).toEqual({
      MELI_SESSION: 'abc123',
      other: 'xyz',
    });
  });

  it('trata string sem ";" como valor único do cookie padrão do marketplace', () => {
    expect(parseCookieString('abc123', 'MERCADOLIVRE')).toEqual({ MELI_SESSION: 'abc123' });
    expect(parseCookieString('token-amazon', 'AMAZON')).toEqual({ 'session-id': 'token-amazon' });
    expect(parseCookieString('token-magalu', 'MAGALU')).toEqual({ magalu_session: 'token-magalu' });
  });

  it('trata valor único com "=" de padding base64 como valor único (não confunde com par nome=valor)', () => {
    const token = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0=';
    expect(parseCookieString(token, 'MERCADOLIVRE')).toEqual({ MELI_SESSION: token });
  });

  it('ignora espaços e segmentos vazios', () => {
    expect(parseCookieString('  a=1 ;  ; b=2  ', 'AMAZON')).toEqual({ a: '1', b: '2' });
  });

  it('string vazia retorna objeto vazio', () => {
    expect(parseCookieString('   ', 'MAGALU')).toEqual({});
  });
});
