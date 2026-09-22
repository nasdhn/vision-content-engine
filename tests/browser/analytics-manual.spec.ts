import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const key = 'fixture-local-recording-access-key';

async function login(page: Page, path: string) {
  await page.goto(path);
  await page.getByLabel('Clé d’accès locale').fill(key);
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
}

test('records a due TikTok manual metric snapshot without fabricating missing values', async ({
  page,
}) => {
  await login(page, '/analytics');
  await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible();
  await expect(page.getByTestId('analytics-due-count')).toHaveText('1');
  const views = page.locator('input[data-testid^="analytics-"][data-testid$="-views"]').first();
  await views.fill('321');
  const likes = page.locator('input[data-testid^="analytics-"][data-testid$="-likes"]').first();
  await likes.fill('0');
  await page.locator('button[data-testid^="analytics-submit-"]').first().click();
  await expect(page.getByText('Mesure TikTok enregistrée.')).toBeVisible();
  await expect(page.getByTestId('analytics-due-count')).toHaveText('0');
  await expect(page.getByTestId('analytics-completed-count')).toHaveText('1');
});

test('keeps the TikTok manual analytics form usable on mobile without horizontal overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, '/analytics');
  await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});
