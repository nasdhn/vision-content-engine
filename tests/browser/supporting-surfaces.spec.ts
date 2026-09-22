import { expect, test } from '@playwright/test';

const key = 'fixture-local-recording-access-key';

test.describe.configure({ mode: 'serial' });
let assetHref = '';

test('shows honest supporting surfaces and the Phase 8B TikTok manual analytics boundary', async ({
  page,
}) => {
  await page.goto('/calendar');
  await page.getByLabel('Clé d’accès locale').fill(key);
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Calendrier', exact: true })).toBeVisible();
  await expect(
    page
      .getByRole('article')
      .filter({ hasText: 'SCHEDULED' })
      .getByRole('heading', { name: 'Vision Instagram', exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Phase 7/)).toBeVisible();

  await page.getByRole('link', { name: 'Publiées' }).click();
  await expect(page.getByRole('heading', { name: 'Publiées', exact: true })).toBeVisible();
  await expect(page.getByText('Vision Instagram')).toBeVisible();

  await page.getByRole('link', { name: 'Assets' }).click();
  await expect(page.getByRole('heading', { name: 'Assets', exact: true })).toBeVisible();
  const assetLink = page.getByRole('link', { name: 'Inspecter l’asset' }).first();
  assetHref = (await assetLink.getAttribute('href')) ?? '';
  expect(assetHref).toMatch(/^\/assets\/[0-9a-f-]+$/);

  await page.getByRole('link', { name: 'Patterns' }).click();
  await expect(page.getByRole('heading', { name: 'Patterns', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Résultat d’abord' })).toBeVisible();

  await page.getByRole('link', { name: 'Templates' }).click();
  await expect(page.getByRole('heading', { name: 'Templates', exact: true })).toBeVisible();
  await expect(page.getByText('Aucun éditeur JSON n’est exposé.')).toBeVisible();

  await page.getByRole('link', { name: 'Réglages' }).click();
  await expect(page.getByRole('heading', { name: 'Réglages', exact: true })).toBeVisible();
  await expect(page.getByText('Vision Instagram')).toBeVisible();
  await expect(page.locator('body')).not.toContainText('secret://browser-fixture');

  await page.getByRole('link', { name: 'Analytics' }).click();
  await expect(page.getByRole('heading', { name: 'Analytics', exact: true })).toBeVisible();
  await expect(page.getByText(/TikTok reste en saisie manuelle/i)).toBeVisible();
  await expect(page.getByTestId('analytics-due-count')).toBeVisible();
});

test('preserves an asset deep link through mobile login and refresh without horizontal overflow', async ({
  page,
}) => {
  expect(assetHref).toBeTruthy();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(assetHref);
  await page.getByLabel('Clé d’accès locale').fill(key);
  await page.getByLabel('Clé d’accès locale').press('Enter');

  await expect(page).toHaveURL(new RegExp(`${assetHref}$`));
  await expect(page.getByRole('heading', { name: /^Asset / })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Lineage & usages' })).toBeVisible();
  await expect(page.getByText(/bucket\/object keys/i)).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(new RegExp(`${assetHref}$`));
  await expect(page.getByRole('heading', { name: /^Asset / })).toBeVisible();

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
