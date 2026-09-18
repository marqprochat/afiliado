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
});
