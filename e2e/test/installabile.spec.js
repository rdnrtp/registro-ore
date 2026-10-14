// App installabile: manifest, icone, service worker minimo (nessuna cache),
// aggiornamento automatico dopo un rilascio.
const { test, expect } = require('@playwright/test');
const { apiFinta } = require('./api-finta');

// Larghezza e altezza di un PNG (intestazione IHDR).
const latiPng = (b) => [b.readUInt32BE(16), b.readUInt32BE(20)];

test('manifest con nome, schermo intero, colori e icone', async ({ request }) => {
  const r = await request.get('/manifest.webmanifest');
  expect(r.status()).toBe(200);
  expect(r.headers()['content-type']).toBe('application/manifest+json');
  const m = await r.json();
  expect(m).toMatchObject({ id: '/', name: 'Presenze', short_name: 'Presenze', start_url: '/', scope: '/', display: 'standalone', theme_color: '#0b6e99' });
  for (const lato of [192, 512]) {
    for (const scopo of ['any', 'maskable']) {
      const icona = m.icons.find((i) => i.sizes === `${lato}x${lato}` && i.purpose === scopo);
      expect(icona, `icona ${lato} ${scopo}`).toBeTruthy();
      const f = await request.get(icona.src);
      expect(f.status()).toBe(200);
      expect(f.headers()['content-type']).toBe('image/png');
      expect(latiPng(await f.body())).toEqual([lato, lato]);
    }
  }
});

test('pagina pronta per Android e iPhone', async ({ page, request }) => {
  await apiFinta(page, { autenticato: false });
  await page.goto('/');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0b6e99');
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', 'Presenze');
  const apple = await request.get(await page.locator('link[rel="apple-touch-icon"]').getAttribute('href'));
  expect(latiPng(await apple.body())).toEqual([180, 180]);
});

test('index.html, sw.js e versione.json non restano mai in cache', async ({ request }) => {
  for (const percorso of ['/', '/index.html', '/sw.js', '/versione.json', '/manifest.webmanifest']) {
    const r = await request.get(percorso);
    expect(r.status(), percorso).toBe(200);
    expect(r.headers()['cache-control'], percorso).toBe('no-cache');
  }
  expect((await request.get('/sw.js')).headers()['content-type']).toMatch(/javascript/);
});

test.describe('service worker', () => {
  test.use({ serviceWorkers: 'allow' });

  test('si registra, controlla la pagina e non mette in cache niente', async ({ page, context }) => {
    await page.goto('/');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    // Le chiamate all'API e i file dell'app non passano dal service worker.
    const risposte = [];
    page.on('response', (r) => risposte.push(r));
    await page.reload();
    await expect(page.getByRole('button', { name: 'Accedi' })).toBeVisible();
    const api = risposte.filter((r) => new URL(r.url()).pathname.startsWith('/api/'));
    expect(api.length).toBeGreaterThan(0);
    for (const r of risposte) {
      if (r.request().resourceType() !== 'document') expect(r.fromServiceWorker(), r.url()).toBe(false);
    }
    expect(await page.evaluate(() => caches.keys())).toEqual([]);

    // Senza rete: messaggio in italiano invece dell'errore del browser.
    await context.setOffline(true);
    await page.reload().catch(() => {});
    await expect(page.getByRole('heading', { name: 'Nessuna connessione' })).toBeVisible();
    await context.setOffline(false);
  });
});

test.describe('dopo un rilascio', () => {
  // L'app è aperta da prima del rilascio: il server ora ha un'altra versione.
  async function apriConVersioneNuova(page) {
    await apiFinta(page);
    await page.route('**/versione.json', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ versione: 'rilascio-nuovo' }) }),
    );
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Ottobre 2026' })).toBeVisible();
    await page.evaluate(() => {
      window.segnoPaginaVecchia = true;
    });
  }
  // L'app torna in primo piano (telefono sbloccato, app riaperta).
  const tornaInPrimoPiano = (page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

  test('tornando in primo piano si ricarica da sola', async ({ page }) => {
    await apriConVersioneNuova(page);
    await Promise.all([page.waitForEvent('load'), tornaInPrimoPiano(page)]);
    expect(await page.evaluate(() => window.segnoPaginaVecchia ?? false)).toBe(false);
    await expect(page.getByRole('heading', { level: 1, name: 'Ottobre 2026' })).toBeVisible();
  });

  test('con una finestra aperta non ricarica: propone "Aggiorna"', async ({ page }) => {
    await apriConVersioneNuova(page);
    await page.locator('ol.giorni button').nth(13).click();
    await tornaInPrimoPiano(page);
    await expect(page.getByRole('status').filter({ hasText: 'versione nuova' })).toBeVisible();
    expect(await page.evaluate(() => window.segnoPaginaVecchia)).toBe(true);
    await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Aggiorna' }).click()]);
    expect(await page.evaluate(() => window.segnoPaginaVecchia ?? false)).toBe(false);
  });

  test('con la stessa versione non succede niente', async ({ page }) => {
    await apiFinta(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Ottobre 2026' })).toBeVisible();
    await page.evaluate(() => {
      window.segnoPaginaVecchia = true;
    });
    const controllo = page.waitForResponse('**/versione.json');
    await tornaInPrimoPiano(page);
    await controllo;
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.segnoPaginaVecchia)).toBe(true);
  });
});
