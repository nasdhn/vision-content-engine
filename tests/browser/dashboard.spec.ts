import { test, expect } from '@playwright/test';

const key = 'fixture-local-recording-access-key';

test('dashboard shell shows canonical counts and navigates to Needs Attention', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Clé d’accès locale').fill(key);
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible();
  await expect(page.getByTestId('count-attention')).toHaveText('1');
  await expect(page.getByTestId('count-production')).toHaveText('1');

  await page.getByRole('link', { name: 'À traiter' }).first().click();

  await expect(page).toHaveURL(/\/attention$/);
  await expect(page.getByRole('heading', { name: 'À traiter', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Une voix naturelle' })).toBeVisible();
});

test('deep-link login preserves the requested dashboard route on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/attention');
  await page.getByLabel('Clé d’accès locale').fill(key);
  await page.getByLabel('Clé d’accès locale').press('Enter');

  await expect(page).toHaveURL(/\/attention$/);
  await expect(page.getByRole('heading', { name: 'À traiter', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Une voix naturelle' })).toBeVisible();

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
