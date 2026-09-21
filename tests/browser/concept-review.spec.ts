import { expect, test, type Page } from '@playwright/test';

const key = 'fixture-local-recording-access-key';

async function login(page: Page) {
  await page.getByLabel('Clé d’accès locale').fill(key);
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
}

test('reviews and approves the exact ConceptVersion from the queue', async ({ page }) => {
  await page.goto('/concepts');
  await login(page);

  await expect(page.getByRole('heading', { name: 'Concept à approuver' })).toBeVisible();
  await page.getByRole('link', { name: 'Ouvrir Concept à approuver' }).click();

  await expect(page).toHaveURL(/\/concepts\/[0-9a-f-]+$/);
  await expect(page.getByText('Voici la preuve avant la promesse.')).toBeVisible();

  await page.getByRole('button', { name: 'Approuver le concept', exact: true }).click();

  await expect(page).toHaveURL(/\/concepts$/);
  await expect(page.getByRole('heading', { name: 'Concept à approuver' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Concept à rejeter' })).toBeVisible();
});

test('rejects a concept with a structured reason on mobile without horizontal overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/concepts');
  await login(page);

  await page.getByRole('link', { name: 'Ouvrir Concept à rejeter' }).click();

  await page.getByLabel('Raison du rejet').selectOption('HOOK_WEAK');
  await page.getByLabel('Commentaire de review').fill('Le hook doit montrer le résultat plus tôt.');
  await page.getByRole('button', { name: 'Rejeter le concept', exact: true }).click();

  await expect(page).toHaveURL(/\/concepts$/);
  await expect(page.getByRole('heading', { name: 'Aucun concept à valider' })).toBeVisible();

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
