import { test, expect, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('E-mail').fill('e2e@test.local');
  await page.getByLabel('Senha').fill('e2e-senha-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Visão Geral' })).toBeVisible({ timeout: 30_000 });
}

test('dashboard: abre, troca período e filtra por grupo', async ({ page }) => {
  await login(page);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard & Métricas' })).toBeVisible();
  await expect(page.getByTestId('kpi-joins')).toHaveText('3', { timeout: 15_000 });
  await expect(page.getByTestId('kpi-leaves')).toHaveText('1');
  await expect(
    page.getByText(/Histórico de movimentação disponível a partir de \d{2}\/\d{2}\/\d{4}/),
  ).toBeVisible();
  for (const title of ['Grupos', 'Envios', 'Produtos', 'Cliques', 'Espelhamento e automações']) {
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
  }

  await page.getByRole('button', { name: '7 dias' }).click();
  await expect(page).toHaveURL(/period=7d/);
  await expect(page.getByRole('button', { name: '7 dias' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByTestId('kpi-joins')).toHaveText('3');

  await page.getByLabel('Grupo').selectOption({ label: 'Grupo E2E Destino' });
  await expect(page).toHaveURL(/groupJid=e2e-dest%40g\.us/);
  await expect(page.getByTestId('kpi-joins')).toHaveText('0');

  await page.goBack();
  await expect(page).not.toHaveURL(/groupJid=/);
  await expect(page.getByTestId('kpi-joins')).toHaveText('3');
});

test('dashboard no modo claro', async ({ page }) => {
  await login(page);
  await page.goto('/dashboard');
  await expect(page.getByTestId('kpi-joins')).toHaveText('3', { timeout: 15_000 });
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const dark = await background();
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  expect(await background()).not.toBe(dark);
  await expect(page.getByTestId('kpi-joins')).toBeVisible();
  await page.screenshot({ path: 'test-results/dashboard-claro.png', fullPage: true });
});
