import { expect, test } from '@playwright/test';

const key = 'fixture-local-recording-access-key';

test('operates distribution safely without bypassing reconciliation', async ({ page }) => {
  await page.goto('/distribution');
  await page.getByLabel('Clé d’accès locale').fill(key);
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Distribution', exact: true })).toBeVisible();
  const unknown = page.getByRole('article').filter({ hasText: 'PUBLISHING_UNKNOWN' });
  await expect(unknown).toContainText('Aucun retry direct');
  await unknown.getByRole('button', { name: 'Demander la réconciliation' }).click();
  await expect(page.getByRole('status')).toContainText('Réconciliation demandée');

  const account = page.getByRole('article').filter({ hasText: 'Vision Instagram' }).first();
  await account.getByRole('button', { name: 'Vérifier le compte' }).click();
  await expect(page.getByRole('status')).toContainText('Santé du compte vérifiée');
  await expect(account).toContainText('ACTIVE');
});

test('distribution controls remain usable on mobile without horizontal overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/distribution');
  await page.getByLabel('Clé d’accès locale').fill(key);
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Distribution', exact: true })).toBeVisible();
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
});
