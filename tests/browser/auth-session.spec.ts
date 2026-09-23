import { expect, test } from '@playwright/test';

const accessKey = 'fixture-local-recording-access-key';
const deepLink = `/learning/${'e'.repeat(64)}`;

for (const viewport of [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`keeps auth private and preserves a Learning deep link through login/logout at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const consoleMessages: string[] = [];
    page.on('console', (message) => consoleMessages.push(message.text()));
    page.on('pageerror', (error) => consoleMessages.push(error.message));
    await page.goto(deepLink);
    const keyInput = page.getByLabel('Clé d’accès locale');
    await keyInput.fill('incorrect-local-access-key-value-1234');
    await keyInput.press('Enter');
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(keyInput).toHaveValue('');
    await expect(page).toHaveURL(new RegExp(`${deepLink}$`));

    await keyInput.fill(accessKey);
    const loginResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/session') && response.request().method() === 'POST',
    );
    await keyInput.press('Enter');
    const login = await loginResponse;
    expect(login.status()).toBe(201);
    const header = await login.headerValue('set-cookie');
    expect(header).toMatch(
      /^__Host-vce=[a-f0-9]{64}; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800$/,
    );
    const { csrf } = (await login.json()) as { csrf: string };
    await expect(
      page.getByRole('heading', { name: 'Rapport hebdomadaire', exact: true }),
    ).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${deepLink}$`));
    const cookie = (await page.context().cookies()).find((entry) => entry.name === '__Host-vce')!;
    expect(cookie).toMatchObject({
      secure: true,
      httpOnly: true,
      sameSite: 'Strict',
      path: '/',
      domain: 'localhost',
    });
    expect(await page.evaluate(() => document.cookie)).not.toContain('__Host-vce');
    expect(
      await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } })),
    ).toEqual({ local: {}, session: {} });
    expect(page.url()).not.toContain(accessKey);
    expect(page.url()).not.toContain(csrf);
    expect(page.url()).not.toContain(cookie.value);
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Rapport hebdomadaire', exact: true }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Se déconnecter', exact: true }).click();
    await expect(keyInput).toBeVisible();
    await expect(keyInput).toHaveValue('');
    expect((await page.context().cookies()).some((entry) => entry.name === '__Host-vce')).toBe(
      false,
    );
    await expect(page).toHaveURL(new RegExp(`${deepLink}$`));
    // Replay the old cookie explicitly: server revocation, not just browser deletion.
    expect(
      (
        await page.request.get('/api/learning', {
          headers: { Cookie: `__Host-vce=${cookie.value}` },
        })
      ).status(),
    ).toBe(401);
    expect(
      (
        await page.request.post('/api/logout', {
          headers: {
            Cookie: `__Host-vce=${cookie.value}`,
            Origin: 'http://localhost:5174',
            'X-CSRF-Token': csrf,
          },
          data: {},
        })
      ).status(),
    ).toBe(401);
    await page.reload();
    await expect(keyInput).toBeVisible();
    expect(
      await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } })),
    ).toEqual({ local: {}, session: {} });
    for (const secret of [accessKey, csrf, cookie.value]) {
      expect(consoleMessages.join('\n')).not.toContain(secret);
    }
  });
}
