import { chromium, type Browser } from 'playwright';

let browserPromise: Promise<Browser> | null = null;

function launchBrowser(): Promise<Browser> {
  return chromium.launch({ headless: true });
}

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) browserPromise = launchBrowser();
  return browserPromise;
}

export interface FetchRenderedHtmlOptions {
  timeoutMs?: number;
  /** Se informado, espera esse seletor aparecer antes de capturar o HTML (mais confiável que timeout fixo). */
  waitForSelector?: string;
}

const REALISTIC_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

export async function fetchRenderedHtml(
  url: string,
  opts: FetchRenderedHtmlOptions = {},
): Promise<string> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: REALISTIC_USER_AGENT,
    viewport: { width: 1366, height: 768 },
    locale: 'pt-BR',
  });
  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: opts.timeoutMs ?? 15_000 });
    if (opts.waitForSelector) {
      await page.waitForSelector(opts.waitForSelector, { timeout: opts.timeoutMs ?? 15_000 }).catch(() => {});
    } else {
      await page.waitForTimeout(1_500);
    }
    return await page.content();
  } finally {
    await context.close();
  }
}

export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return;
  const browser = await browserPromise;
  browserPromise = null;
  await browser.close();
}
