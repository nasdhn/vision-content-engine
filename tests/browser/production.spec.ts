import { test, expect } from '@playwright/test';

const key = 'fixture-local-recording-access-key';

test('shows canonical production stage and opens the exact CreativePlanVersion detail', async ({
  page,
}) => {
  await page.goto('/production');
  await page.getByLabel('Clé d’accès locale').fill(key);
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Production', exact: true })).toBeVisible();
  await expect(page.getByText('En attente de moi', { exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Ouvrir la production', exact: true }).click();

  await expect(page).toHaveURL(/\/production\/[0-9a-f-]+$/);
  await expect(
    page.getByRole('heading', { name: 'État de production', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recording Pack', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Une voix naturelle' })).toBeVisible();
  await expect(page.getByText('Fournir ou sélectionner les enregistrements requis.')).toBeVisible();
});
