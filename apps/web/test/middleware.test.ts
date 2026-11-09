import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '../src/middleware';

function createRequest(path: string, hasSession = false): NextRequest {
  const url = `http://localhost:3000${path}`;
  const headers = new Headers();
  if (hasSession) {
    headers.set('cookie', 'afilados_session=session_token_123');
  }
  return new NextRequest(url, { headers });
}

describe('middleware', () => {
  describe('rotas públicas sem autenticação', () => {
    it.each([
      ['/ofertas'],
      ['/ofertas/iphone-15-pro-max'],
      ['/lp/canal-promos'],
      ['/landpage'],
      ['/callbackml'],
      ['/g/slug-grupo'],
      ['/downloads/afilados-connect.zip'],
      ['/dudu-hero.jpg'],
      ['/imagem.png'],
      ['/icone.svg'],
    ])('permite acesso deslogado a %s', (path) => {
      const req = createRequest(path, false);
      const res = middleware(req);
      // NextResponse.next() não tem cabeçalho de Location/redirect
      expect(res.headers.get('location')).toBeNull();
      expect(res.status).toBe(200);
    });
  });

  describe('rotas públicas com autenticação', () => {
    it.each([
      ['/ofertas'],
      ['/ofertas/notebook-dell'],
      ['/lp/canal-promos'],
      ['/landpage'],
    ])('permite acesso logado a %s', (path) => {
      const req = createRequest(path, true);
      const res = middleware(req);
      expect(res.headers.get('location')).toBeNull();
      expect(res.status).toBe(200);
    });
  });

  describe('rotas protegidas', () => {
    it.each([
      ['/'],
      ['/dashboard'],
      ['/produtos'],
      ['/config/conta'],
      ['/minha-landpage'],
      ['/catalogo-ofertas'],
      ['/afiliados'],
    ])('redireciona para /login se não autenticado em %s', (path) => {
      const req = createRequest(path, false);
      const res = middleware(req);
      expect(res.headers.get('location')).toBe('http://localhost:3000/login');
      expect(res.status).toBe(307);
    });

    it.each([
      ['/'],
      ['/dashboard'],
      ['/produtos'],
    ])('permite acesso autenticado em %s', (path) => {
      const req = createRequest(path, true);
      const res = middleware(req);
      expect(res.headers.get('location')).toBeNull();
      expect(res.status).toBe(200);
    });
  });

  describe('rota de login', () => {
    it('permite acessar /login quando deslogado', () => {
      const req = createRequest('/login', false);
      const res = middleware(req);
      expect(res.headers.get('location')).toBeNull();
      expect(res.status).toBe(200);
    });

    it('redireciona /login para / quando já logado', () => {
      const req = createRequest('/login', true);
      const res = middleware(req);
      expect(res.headers.get('location')).toBe('http://localhost:3000/');
      expect(res.status).toBe(307);
    });
  });
});
