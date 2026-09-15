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

test('espelhamento: criar regra → listada → alternar status', async ({ page }) => {
  await login(page);

  await page.goto('/espelhamento');
  await expect(page.getByRole('heading', { name: /espelhamento de grupos/i })).toBeVisible();

  // Preenche formulário de novo espelhamento
  await page.getByLabel('Nome do monitoramento').fill('Regra E2E Teste');
  await page.getByLabel('Sessão do WhatsApp').selectOption({ label: /E2E/ });

  // Seleciona grupo origem e destino
  const checkboxes = page.getByRole('checkbox');
  await checkboxes.nth(0).check(); // Grupo E2E na lista de origem
  await checkboxes.nth(3).check(); // Grupo E2E Destino na lista de destino

  await page.getByRole('button', { name: 'Adicionar monitoramento' }).click();

  // Confirma que a regra apareceu na lista
  await expect(page.getByText('Regra E2E Teste')).toBeVisible();
  await expect(page.getByText('Espelhamentos configurados (1)')).toBeVisible();

  // Alterna o switch de ativo/pausado
  const switchToggle = page.getByRole('switch');
  await expect(switchToggle).toBeChecked();
  await switchToggle.click();
  await expect(page.getByText('Pausado')).toBeVisible();
});
