import { describe, it, expect, afterAll } from 'vitest';
import { fetchRenderedHtml, closeBrowser } from '../src/scrapers/browser';

describe('fetchRenderedHtml', () => {
  afterAll(async () => {
    await closeBrowser();
  });

  it('renderiza uma página simples e retorna o HTML final', async () => {
    const html = await fetchRenderedHtml('data:text/html,<html><body><h1>ok</h1></body></html>');
    expect(html).toContain('<h1>ok</h1>');
  }, 30_000);

  it('reaproveita o mesmo browser em chamadas sucessivas (não relança a cada chamada)', async () => {
    const html1 = await fetchRenderedHtml('data:text/html,<html><body>a</body></html>');
    const html2 = await fetchRenderedHtml('data:text/html,<html><body>b</body></html>');
    expect(html1).toContain('a');
    expect(html2).toContain('b');
  }, 30_000);

  it('injeta cookies de sessão no contexto antes de navegar', async () => {
    // data: URL não tem domínio real p/ setar cookie, então este teste sobe um servidor
    // HTTP local mínimo que ecoa o cookie recebido — mais confiável que tentar validar
    // contra um domínio real dentro do teste unitário.
    const http = await import('node:http');
    const server = http.createServer((req, res) => {
      res.end(`<html><body>cookie recebido: ${req.headers.cookie ?? 'nenhum'}</body></html>`);
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as { port: number }).port;

    const html = await fetchRenderedHtml(`http://127.0.0.1:${port}/`, {
      cookies: { domain: '127.0.0.1', values: { sessionid: 'abc123' } },
    });
    expect(html).toContain('sessionid=abc123');

    await new Promise<void>((resolve) => server.close(() => resolve()));
  }, 30_000);
});
