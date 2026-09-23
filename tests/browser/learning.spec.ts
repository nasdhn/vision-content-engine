import { expect, test } from '@playwright/test';

const key = 'fixture-local-recording-access-key';

test.describe.configure({ mode: 'serial' });

test('shows the complete frozen weekly report and keeps Recommendation actions human', async ({
  page,
}) => {
  await page.goto('/learning');
  await page.getByLabel('Clé d’accès locale').fill(key);
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Learning', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Ouvrir le rapport' }).first().click();

  await expect(
    page.getByRole('heading', { name: 'Rapport hebdomadaire', exact: true }),
  ).toBeVisible();
  for (const heading of [
    'Business outcomes',
    'Funnel',
    'Platform performance',
    'Content / Pattern signals',
    'Editing signals',
    'Experiments',
    'Anomalies / data quality',
    'Recommendations for next week',
  ]) {
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  }

  await expect(page.getByText('WEAK SIGNAL').first()).toBeVisible();
  await expect(page.getByText('Limites', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('canonical-metrics-v1').first()).toBeVisible();
  await expect(page.getByText('Valeurs 120').first()).toBeVisible();
  await expect(page.getByText('Hook test', { exact: true })).toBeVisible();
  await expect(page.getByText('Comparer deux variantes sur views.', { exact: true })).toBeVisible();
  await expect(page.getByText(/Arm A/)).toBeVisible();
  await expect(page.getByText(/Métriques NULL/)).toBeVisible();
  await expect(page.getByText('3900 minor units EUR', { exact: false }).first()).toBeVisible();
  await expect(page.getByText(/3900 minor units EUR.*VISION_APP/).first()).toBeVisible();
  await expect(page.getByText(/source context/)).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/winner\s*:/i);

  const recommendation = page
    .getByRole('article')
    .filter({ hasText: 'Tester une accroche résultat' });
  await recommendation.getByRole('button', { name: 'Accepter', exact: true }).click();
  await expect(recommendation).toContainText('ACCEPTED');

  await recommendation.getByRole('button', { name: 'Create experiment proposal' }).click();
  await expect(recommendation).toContainText('Experiment DRAFT');
  await expect(recommendation).toContainText('aucune génération automatique');
});

test('preserves a Learning deep link on mobile without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/learning');
  await page.getByLabel('Clé d’accès locale').fill(key);
  await page.getByLabel('Clé d’accès locale').press('Enter');

  const href = await page
    .getByRole('link', { name: 'Ouvrir le rapport' })
    .first()
    .getAttribute('href');
  expect(href).toMatch(/^\/learning\/[a-f0-9]{64}$/);

  await page.goto(href!);
  await page.reload();

  await expect(page).toHaveURL(new RegExp(`${href}$`));
  await expect(
    page.getByRole('heading', { name: 'Rapport hebdomadaire', exact: true }),
  ).toBeVisible();

  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
});
