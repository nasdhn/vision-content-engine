import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const key = 'fixture-local-recording-access-key';

async function login(page: Page) {
  await page.goto('/analytics');
  await page.getByLabel('Clé d’accès locale').fill(key);
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
}

test('shows canonical Analytics evidence without merging inferred attribution or null into zero', async ({
  page,
}) => {
  await login(page);

  await expect(page.getByRole('heading', { name: 'Analytics', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'De la visite au client' })).toBeVisible();
  await expect(page.getByTestId('analytics-direct-total')).toHaveText('2');
  await expect(page.getByTestId('analytics-inferred-total')).toHaveText('1');
  await expect(
    page.getByTestId('analytics-publication-likes').filter({ hasText: '0' }).first(),
  ).toBeVisible();
  await expect(
    page.getByTestId('analytics-publication-comments').filter({ hasText: 'Indisponible' }).first(),
  ).toBeVisible();
  await expect(page.getByText(/ne doivent pas être comparées automatiquement/i)).toBeVisible();
  await expect(page.getByText(/sans classement ni score/i)).toBeVisible();
});

test('keeps the full Analytics read model usable on mobile without horizontal overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await expect(page.getByRole('heading', { name: 'Analytics', exact: true })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});
