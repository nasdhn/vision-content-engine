import { test, expect } from '@playwright/test';
import { wav } from '../fixtures/recordings/support.js';

const key = 'fixture-local-recording-access-key';

test('authenticated human upload, private preview, selection, last rejection and reselection', async ({
  page,
}) => {
  await page.goto('/production');
  await page.getByLabel('Clé d’accès locale').fill(key);
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await page.getByRole('link', { name: 'Ouvrir la production', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Une voix naturelle' })).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Plan créatif version' })
      .getByText('Voici comment retrouver votre preuve.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('1 s', { exact: true })).toBeVisible();

  await page
    .getByLabel('Ajouter des prises')
    .setInputFiles({ name: 'voice.wav', mimeType: 'audio/wav', buffer: wav() });

  await expect(page.getByRole('heading', { name: 'Prise 1 · Sélection requise' })).toBeVisible();

  const cookies = await page.context().cookies();
  expect(cookies.find((cookie) => cookie.name === '__Host-vce')).toMatchObject({
    secure: true,
    httpOnly: true,
    sameSite: 'Strict',
  });

  const preview = page.getByLabel('Écouter la prise 1');
  const url = await preview.getAttribute('src');
  expect(url).toContain('/api/assets/');

  const response = await page.request.get(url!);
  expect(response.ok()).toBe(true);
  expect(await response.body()).toEqual(wav());

  await page.getByRole('button', { name: 'Sélectionner', exact: true }).click();
  await expect(page.getByText('Prêt pour le montage')).toBeVisible();

  await page.getByRole('button', { name: 'Rejeter', exact: true }).click();
  await expect(page.getByText('En attente des éléments nécessaires')).toBeVisible();
  await expect(page.getByText('Sélection requise', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Sélectionner', exact: true }).click();
  await expect(page.getByText('Prêt pour le montage')).toBeVisible();

  const packs = await page.request.get('/api/recording-packs');
  expect((await packs.json())[0].requests[0].status).toBe('ACCEPTED');

  await page.screenshot({
    path: 'test-results/recording-pack-desktop.png',
    fullPage: true,
  });
});

test('mobile layout and keyboard login, validation feedback on unreadable drop upload', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/production');
  await page.getByLabel('Clé d’accès locale').fill(key);
  await page.getByLabel('Clé d’accès locale').press('Enter');
  await page.getByRole('link', { name: 'Ouvrir la production', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Une voix naturelle' })).toBeVisible();

  const data = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['not-media'], 'bad.mp4', { type: 'video/mp4' }));
    return transfer;
  });

  await page.locator('.drop').dispatchEvent('drop', {
    dataTransfer: data,
  });

  await expect(page.getByRole('alert')).toContainText('illisible');

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

  await page.screenshot({
    path: 'test-results/recording-pack-mobile.png',
    fullPage: true,
  });
});
