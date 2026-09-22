import { expect, test } from '@playwright/test';

const key = 'fixture-local-recording-access-key';

test('executes the TikTok manual handoff without any fake remote publishing', async ({ page }) => {
  await page.goto('/manual-publish');
  await page.getByLabel('Clé d’accès locale').fill(key);
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();

  await expect(
    page.getByRole('heading', { name: 'À publier sur TikTok', exact: true }),
  ).toBeVisible();
  const card = page.getByRole('article').filter({ hasText: 'Vision TikTok' });
  await expect(card).toContainText('PRÊT MANUELLEMENT');
  await card.getByRole('link', { name: 'Ouvrir le handoff' }).click();

  await expect(page).toHaveURL(/\/manual-publish\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: 'Vision TikTok', exact: true })).toBeVisible();
  await expect(page.getByLabel('Prévisualisation privée TikTok')).toBeVisible();
  await expect(page.getByText('Voici comment Vision transforme une recherche')).toBeVisible();
  await expect(page.getByText(/divulgation commerciale approprié/i)).toBeVisible();

  const download = page.getByRole('link', { name: 'Télécharger la vidéo' });
  await expect(download).toHaveAttribute('href', /\/api\/manual-publish\/[0-9a-f-]+\/download$/);

  const publishButton = page.getByRole('button', { name: 'Marquer comme publiée' });
  await expect(publishButton).toBeDisabled();
  await page
    .getByLabel('URL TikTok publiée — optionnelle')
    .fill('https://www.tiktok.com/@vision/video/123456789');
  await page
    .getByLabel('Je confirme que cette vidéo a réellement été publiée dans TikTok.')
    .check();
  await expect(publishButton).toBeEnabled();
  await publishButton.click();

  await expect(page).toHaveURL(/\/published$/);
  await expect(page.getByRole('heading', { name: 'Publiées', exact: true })).toBeVisible();
  const published = page.getByRole('article').filter({
    has: page.locator('a[href="https://www.tiktok.com/@vision/video/123456789"]'),
  });
  await expect(published).toBeVisible();
  await expect(
    published.getByRole('link', { name: 'Ouvrir la publication distante' }),
  ).toHaveAttribute('href', 'https://www.tiktok.com/@vision/video/123456789');
});
