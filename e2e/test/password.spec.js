// "Password dimenticata?" dalla pagina di accesso.
const { test, expect } = require('@playwright/test');
const { apiFinta } = require('./api-finta');

test("dalla pagina di accesso si chiede il link; il messaggio non dice se l'email esiste", async ({ page }) => {
  const api = await apiFinta(page, { autenticato: false });
  await page.goto('about:blank');
  await page.goto('/');
  await page.getByRole('link', { name: 'Password dimenticata?' }).click();
  await expect(page.getByRole('heading', { name: 'Password dimenticata' })).toBeVisible();
  await page.getByLabel('Email').fill('maria@bv.test');
  await page.getByRole('button', { name: 'Mandami il link' }).click();
  await expect(page.getByRole('heading', { name: 'Controlla la posta' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText("Se maria@bv.test è l'indirizzo di un account attivo");
  await expect(page.getByText('scade dopo 60 minuti')).toBeVisible();
  expect(api.richiesteReset).toEqual([{ email: 'maria@bv.test' }]);
  // Indietro torna alla pagina di accesso.
  await page.goBack();
  await expect(page.getByRole('button', { name: 'Accedi' })).toBeVisible();
});

test("il collegamento è un'area di tocco di almeno 44 px", async ({ page }) => {
  await apiFinta(page, { autenticato: false });
  await page.goto('/');
  const box = await page.getByRole('link', { name: 'Password dimenticata?' }).boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
});
