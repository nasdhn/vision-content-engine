import { expect, test } from '@playwright/test';

const key = 'fixture-local-recording-access-key';

test.describe.configure({ mode: 'serial' });
let remainingRenderHref = '';

test('reviews exact final renders with structured rejection and server-resolved approval', async ({
  page,
}) => {
  await page.goto('/review');
  await page.getByLabel('Clé d’accès locale').fill(key);
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Review finale', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ouvrir la review finale' })).toHaveCount(3);

  await page.getByRole('link', { name: 'Ouvrir la review finale' }).first().click();
  await expect(page.getByLabel('Rendu final à valider')).toBeVisible();
  await expect(
    page.getByText('Rendu exploitable avec un avertissement non critique.'),
  ).toBeVisible();
  await expect(page.getByText('CTA TOO LONG')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Aller à 8.5 s' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rejeter le rendu' })).toBeDisabled();

  await page.getByLabel('Raison du rejet').selectOption('CUTS_TOO_MECHANICAL');
  await page.getByLabel('Commentaire de review').fill('Laisser davantage respirer les cuts.');
  await page.getByRole('button', { name: 'Rejeter le rendu' }).click();

  await expect(page).toHaveURL(/\/review$/);
  await expect(page.getByText('Rendu rejeté et feedback enregistré.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ouvrir la review finale' })).toHaveCount(2);

  await page.getByRole('link', { name: 'Ouvrir la review finale' }).first().click();
  await page.getByRole('button', { name: 'Approuver le rendu final' }).click();

  await expect(page).toHaveURL(/\/review$/);
  await expect(page.getByText('Rendu final approuvé.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ouvrir la review finale' })).toHaveCount(1);
  remainingRenderHref =
    (await page.getByRole('link', { name: 'Ouvrir la review finale' }).getAttribute('href')) ?? '';
  expect(remainingRenderHref).toMatch(/^\/review\/[0-9a-f-]+$/);
});

test('preserves a final-review deep link through mobile login without horizontal overflow', async ({
  page,
}) => {
  expect(remainingRenderHref).toBeTruthy();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(remainingRenderHref);
  await page.getByLabel('Clé d’accès locale').fill(key);
  await page.getByLabel('Clé d’accès locale').press('Enter');

  await expect(page).toHaveURL(new RegExp(`${remainingRenderHref}$`));
  await expect(page.getByLabel('Rendu final à valider')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Approuver ou rejeter ce master exact' }),
  ).toBeVisible();
  await expect(page.getByLabel('Raison du rejet')).toBeVisible();

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
