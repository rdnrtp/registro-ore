// Tasto Indietro (Android, browser): chiude la finestra aperta; da una
// sezione torna al Mese; dal Mese esce. Le sezioni scelte dalla barra in
// basso non si accumulano nella cronologia.
// "Esce" = il browser torna alla pagina di prima (qui about:blank).
const { test, expect } = require('@playwright/test');
const { apiFinta, AVVISO } = require('./api-finta');

// Apre l'app come prima pagina dopo una scheda vuota.
async function apri(page, percorso = '/') {
  await apiFinta(page);
  await page.goto('about:blank');
  await page.goto(percorso);
  await expect(page.getByRole('navigation', { name: 'Sezioni' })).toBeVisible();
}

const scheda = (page, nome) => page.getByRole('navigation', { name: 'Sezioni' }).getByRole('link', { name: nome });
const finestra = (page) => page.getByRole('dialog');
const suMese = async (page) => {
  await expect(page).toHaveURL(/\/#\/$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Ottobre 2026' })).toBeVisible();
};
const indietro = (page) => page.goBack({ waitUntil: 'commit' }).catch(() => null);
const esce = async (page) => {
  await indietro(page);
  await expect(page).toHaveURL('about:blank');
};

test('dal Mese Indietro esce', async ({ page }) => {
  await apri(page);
  await suMese(page);
  await esce(page);
});

test('le sezioni della barra non si accumulano: Indietro torna al Mese, poi esce', async ({ page }) => {
  await apri(page);
  for (const nome of ['Bacheca', 'Attività', 'Orario', 'Colleghi', 'Gestione']) {
    await scheda(page, nome).click();
    await expect(scheda(page, nome)).toHaveAttribute('aria-current', 'page');
  }
  await indietro(page);
  await suMese(page);
  await esce(page);
});

test('tornare al Mese dalla barra non lascia pagine dietro', async ({ page }) => {
  await apri(page);
  await scheda(page, 'Bacheca').click();
  await scheda(page, 'Mese').click();
  await suMese(page);
  await esce(page);
});

test('Indietro chiude la scheda del giorno e basta', async ({ page }) => {
  await apri(page);
  await page.locator('ol.giorni button').nth(13).click();
  await expect(finestra(page)).toBeVisible();
  await indietro(page);
  await expect(finestra(page)).toHaveCount(0);
  await suMese(page);
  await esce(page);
});

test('una finestra chiusa con × non lascia voci da togliere con Indietro', async ({ page }) => {
  await apri(page);
  await page.locator('ol.giorni button').nth(13).click();
  await finestra(page).getByRole('button', { name: 'Chiudi' }).first().click();
  await expect(finestra(page)).toHaveCount(0);
  await page.locator('ol.giorni button').nth(2).click();
  await finestra(page).getByRole('button', { name: 'Annulla' }).click();
  await expect(finestra(page)).toHaveCount(0);
  await esce(page);
});

test('"Altro" e poi una sua azione: Indietro chiude la conferma, poi esce', async ({ page }) => {
  await apri(page);
  await page.getByRole('button', { name: 'Altro' }).click();
  await expect(finestra(page)).toContainText('Precompila il mese');
  await finestra(page).getByRole('button', { name: /Precompila il mese/ }).click();
  await expect(finestra(page)).toContainText("L'orario tipo verrà applicato");
  await indietro(page);
  await expect(finestra(page)).toHaveCount(0);
  await suMese(page);
  await esce(page);
});

test('Indietro esce dalla selezione dei giorni', async ({ page }) => {
  await apri(page);
  await page.getByRole('button', { name: 'Altro' }).click();
  await finestra(page).getByRole('button', { name: /Seleziona giorni/ }).click();
  await expect(page.getByRole('toolbar', { name: 'Giorni selezionati' })).toBeVisible();
  await indietro(page);
  await expect(page.getByRole('toolbar', { name: 'Giorni selezionati' })).toHaveCount(0);
  await esce(page);
});

test('mese di un collega: Indietro torna all\'elenco, poi al Mese, poi esce', async ({ page }) => {
  await apri(page);
  await scheda(page, 'Colleghi').click();
  await page.getByRole('link', { name: /Rossi Maria/ }).click();
  await expect(page.locator('.persona-mese')).toHaveText('Maria Rossi');
  // Cambiare mese nella vista del collega non aggiunge voci.
  await page.getByRole('button', { name: 'Mese precedente' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Settembre 2026' })).toBeVisible();
  await indietro(page);
  await expect(page).toHaveURL(/#\/collaboratori\/2026\/\d+$/);
  await expect(page.getByRole('link', { name: /Rossi Maria/ })).toBeVisible();
  await indietro(page);
  await suMese(page);
  await esce(page);
});

test('Gestione → Utenti: Indietro torna a Gestione, poi al Mese', async ({ page }) => {
  await apri(page);
  await scheda(page, 'Gestione').click();
  await page.getByRole('link', { name: /Utenti/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Utenti' })).toBeVisible();
  await indietro(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Gestione' })).toBeVisible();
  await indietro(page);
  await suMese(page);
  await esce(page);
});

test('aperta da un link (es. email di un avviso): Indietro risale fino al Mese', async ({ page }) => {
  await apri(page, `/#/bacheca/${AVVISO}`);
  await expect(finestra(page)).toContainText('Sabato 24 ottobre');
  await indietro(page);
  await expect(finestra(page)).toHaveCount(0);
  await expect(page).toHaveURL(/#\/bacheca$/);
  await indietro(page);
  await suMese(page);
  await esce(page);
});

test('dopo una ricarica la cronologia resta quella giusta', async ({ page }) => {
  await apri(page);
  await scheda(page, 'Gestione').click();
  await page.getByRole('link', { name: /Registro delle modifiche/ }).click();
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Registro delle modifiche' })).toBeVisible();
  await indietro(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Gestione' })).toBeVisible();
  await indietro(page);
  await suMese(page);
  await esce(page);
});

test('il pannello "Esci" si chiude con Indietro', async ({ page }) => {
  await apri(page);
  await page.getByRole('button', { name: 'Esci' }).click();
  await expect(finestra(page)).toContainText('Esci da tutti i dispositivi');
  await indietro(page);
  await expect(finestra(page)).toHaveCount(0);
  await esce(page);
});
