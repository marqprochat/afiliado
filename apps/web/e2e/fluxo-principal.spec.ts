import { test, expect, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

async function login(page: Page) {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('E-mail').fill('e2e@test.local');
  await page.getByLabel('Senha').fill('e2e-senha-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Visão Geral' })).toBeVisible({ timeout: 30_000 });
}

test('login → template → busca → fila → lote', async ({ page }) => {
  await login(page);

  await page.goto('/config/templates');
  await expect(page.getByTestId('preview')).toContainText('s.shopee.com.br/exemplo', {
    timeout: 10_000,
  });

  await page.goto('/produtos');
  await page.getByPlaceholder(/palavra-chave/i).fill('ryzen');
  await page.getByRole('button', { name: 'Buscar' }).click();
  await expect(page.getByRole('checkbox', { name: 'Selecionar' }).first()).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole('button', { name: /selecionar todos/i }).click();
  await page.getByRole('button', { name: 'Salvar selecionados' }).click();
  await expect(page.getByText(/produto\(s\) salvos na fila/)).toBeVisible();

  await page.goto('/enviar');
  await expect(page.getByText(/Produtos salvos \(2\//)).toBeVisible();
  await page.getByLabel('Nome do lote').fill('Lote E2E');
  await page.getByLabel('[GRUPO] Grupo E2E').check();
  await page.getByLabel(/intervalo/i).fill('1');
  await page.getByRole('button', { name: 'Criar lote' }).click();
  await expect(page.getByText('Lote criado e agendado')).toBeVisible();
  await expect(page.getByText('Lote E2E')).toBeVisible();
  await expect(page.getByText(/Agendado|Enviando|Concluído/).first()).toBeVisible();
});

test('logout invalida sessão', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/produtos');
  await expect(page).toHaveURL(/\/login$/);
});
