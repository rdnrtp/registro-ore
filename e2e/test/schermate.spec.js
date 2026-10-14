// Schermate a 360, 390, 412 px (telefoni) e 1280 px (computer) di tutte le
// pagine, in risultati/schermate/. Su ogni pagina: niente scorrimento
// orizzontale. Nella vista del mese: comandi ordinati e alti almeno 44 px.
// Pulsanti più bassi di 44 px: elenco in risultati/schermate/piccoli-*.json.
const fs = require('node:fs');
const path = require('node:path');
const { test, expect, devices } = require('@playwright/test');
const { apiFinta, COLLEGA } = require('./api-finta');

const CARTELLA = path.join(__dirname, '..', 'risultati', 'schermate');
const LARGHEZZE = [360, 390, 412, 1280];
// Telefono Android, senza la scelta del browser (è già Chromium).
const { defaultBrowserType, ...TELEFONO } = devices['Pixel 7'];

// [nome, percorso, opzioni dell'API finta, azione dopo il caricamento]
const PAGINE = [
  ['accesso', '/', { autenticato: false }],
  ['password-dimenticata', '/#/password-dimenticata', { autenticato: false }],
  ['mese', '/'],
  ['mese-altro', '/', {}, (page) => page.getByRole('button', { name: 'Altro' }).click()],
  ['mese-selezione', '/', {}, async (page) => {
    await page.getByRole('button', { name: 'Altro' }).click();
    await page.getByRole('dialog').getByRole('button', { name: /Seleziona giorni/ }).click();
  }],
  ['mese-precedente', '/', {}, (page) => page.getByRole('button', { name: 'Mese precedente' }).click()],
  ['mese-inviato', '/', { statoMese: 'inviato' }],
  ['bacheca', '/#/bacheca'],
  ['attivita', '/#/attivita'],
  ['orario', '/#/orario'],
  ['collaboratori', '/#/collaboratori/2026/10'],
  ['mese-collega', `/#/collaboratori/${COLLEGA}/2026/10`],
  ['gestione', '/#/gestione'],
  ['gestione-utenti', '/#/gestione/utenti'],
  ['gestione-attivita', '/#/gestione/attivita'],
  ['gestione-settori', '/#/gestione/settori'],
  ['gestione-bacheca', '/#/gestione/bacheca'],
  ['gestione-impianto', '/#/gestione/impianto'],
  ['gestione-email', '/#/gestione/email'],
  ['gestione-registro', '/#/gestione/registro'],
  ['responsabile-mese', '/', { ruolo: 'responsabile' }],
  ['collaboratore-mese', '/', { ruolo: 'collaboratore' }],
];

const piccoli = [];
test.afterAll(async ({}, info) => {
  fs.mkdirSync(CARTELLA, { recursive: true });
  fs.writeFileSync(path.join(CARTELLA, `piccoli-${info.workerIndex}.json`), JSON.stringify(piccoli, null, 2));
});

for (const larghezza of LARGHEZZE) {
  test.describe(`${larghezza} px`, () => {
    const telefono = larghezza < 600;
    test.use(
      telefono
        ? { ...TELEFONO, viewport: { width: larghezza, height: 800 } }
        : { viewport: { width: larghezza, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
    );

    for (const [nome, percorso, opzioni = {}, azione] of PAGINE) {
      test(nome, async ({ page }) => {
        const errori = [];
        page.on('pageerror', (e) => errori.push(e.message));
        await apiFinta(page, opzioni);
        await page.goto(percorso);
        await page.waitForLoadState('networkidle');
        if (azione) await azione(page);
        await expect(page.locator('.caricamento')).toHaveCount(0);
        await expect(page.locator('#root > *').first()).toBeVisible();
        expect(errori, 'errori nella pagina').toEqual([]);
        await page.screenshot({ path: path.join(CARTELLA, `${larghezza}-${nome}.png`), fullPage: false });

        const larghezze = await page.evaluate(() => ({ pagina: document.documentElement.scrollWidth, finestra: window.innerWidth }));
        expect(larghezze.pagina, 'scorrimento orizzontale').toBeLessThanOrEqual(larghezze.finestra);

        if (telefono) {
          const bassi = await page.evaluate(() =>
            [...document.querySelectorAll('button, a[href], select, input:not([type=hidden])')]
              .filter((el) => el.offsetParent !== null)
              .map((el) => ({ testo: (el.innerText || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 40), altezza: Math.round(el.getBoundingClientRect().height), classe: el.className }))
              .filter((x) => x.altezza > 0 && x.altezza < 44),
          );
          for (const b of bassi) piccoli.push({ larghezza, pagina: nome, ...b });
        }
      });
    }

    test('comandi del mese: in riga, alti almeno 44 px, Invia è il principale', async ({ page }) => {
      await apiFinta(page);
      await page.goto('/');
      const invia = await page.getByRole('button', { name: 'Invia il mese' }).boundingBox();
      const altro = await page.getByRole('button', { name: 'Altro' }).boundingBox();
      expect(invia.height).toBeGreaterThanOrEqual(44);
      expect(altro.height).toBe(invia.height);
      expect(altro.y).toBe(invia.y);
      expect(invia.width).toBeGreaterThan(altro.width);
      // Totale ben leggibile.
      const dimensione = await page.locator('.ore-mese b').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(dimensione).toBeGreaterThanOrEqual(20);
      await expect(page.locator('.ore-mese')).toHaveText('81 ore');
      // Nel pannello "Altro" ogni voce è alta almeno 44 px.
      await page.getByRole('button', { name: 'Altro' }).click();
      for (const voce of await page.getByRole('dialog').locator('.menu-azioni button').all()) {
        expect((await voce.boundingBox()).height).toBeGreaterThanOrEqual(44);
      }
    });
  });
}
