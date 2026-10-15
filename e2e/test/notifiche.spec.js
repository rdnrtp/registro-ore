// Pagina Notifiche e notifiche push nel service worker. Il servizio push
// vero (Google) non c'è: l'iscrizione del browser è simulata, la push
// arriva al service worker attraverso Chromium (CDP).
const { test, expect } = require('@playwright/test');
const { apiFinta, AVVISO } = require('./api-finta');

// Permesso e iscrizione del browser simulati; conta le richieste di permesso.
// (Funzione eseguita nella pagina: riceve il permesso come argomento.)
const browserFinto = (permesso) => {
  window.richiestePermesso = 0;
  let stato = permesso;
  let iscrizione = null;
  Object.defineProperty(Notification, 'permission', { get: () => stato, configurable: true });
  Notification.requestPermission = async () => {
    window.richiestePermesso += 1;
    if (stato === 'default') stato = 'granted';
    return stato;
  };
  PushManager.prototype.getSubscription = async () => iscrizione;
  PushManager.prototype.subscribe = async (opzioni) => {
    iscrizione = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/finto',
      options: opzioni,
      toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/finto', keys: { p256dh: 'x', auth: 'y' } }),
      unsubscribe: async () => {
        iscrizione = null;
        return true;
      },
    };
    return iscrizione;
  };
};

const titolo = (page) => page.getByRole('heading', { level: 1, name: 'Notifiche' });

test.describe('pagina Notifiche', () => {
  test.use({ serviceWorkers: 'allow' });

  test('il permesso si chiede solo dopo il tocco; poi prova e disattivazione', async ({ page }) => {
    await page.addInitScript(browserFinto, 'default');
    const s = await apiFinta(page);
    const richieste = [];
    page.on('request', (r) => r.url().includes('/api/push') && r.method() !== 'GET' && richieste.push(`${r.method()} ${new URL(r.url()).pathname}`));
    await page.goto('/#/notifiche');
    await expect(titolo(page)).toBeVisible();
    await expect(page.getByText('Le notifiche non sono attive su questo dispositivo.')).toBeVisible();
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.richiestePermesso)).toBe(0);

    s.dispositiviPush = 1;
    await page.getByRole('button', { name: 'Attiva notifiche' }).click();
    await expect(page.getByText('Le notifiche sono attive su questo dispositivo.')).toBeVisible();
    expect(await page.evaluate(() => window.richiestePermesso)).toBe(1);
    await page.getByRole('button', { name: 'Invia una notifica di prova' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Notifica di prova inviata' })).toBeVisible();
    await page.getByRole('button', { name: 'Disattiva su questo dispositivo' }).click();
    await expect(page.getByText('Le notifiche non sono attive su questo dispositivo.')).toBeVisible();
    expect(richieste).toEqual(['POST /api/push/iscrizioni', 'POST /api/push/prova', 'DELETE /api/push/iscrizioni']);
  });

  test('permesso negato: spiega come riattivarlo', async ({ page }) => {
    await page.addInitScript(browserFinto, 'denied');
    await apiFinta(page);
    await page.goto('/#/notifiche');
    await expect(page.getByText('Le notifiche sono bloccate')).toBeVisible();
    await expect(page.getByText('Informazioni app')).toBeVisible();
  });

  test('nessuna richiesta di permesso aprendo l\'app', async ({ page }) => {
    await page.addInitScript(browserFinto, 'default');
    await apiFinta(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Ottobre 2026' })).toBeVisible();
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.richiestePermesso)).toBe(0);
  });
});

test.describe('iPhone senza app sulla schermata Home', () => {
  test.use({
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  });

  test('spiega come aggiungerla, senza un pulsante che non funzionerebbe', async ({ page }) => {
    await apiFinta(page);
    await page.goto('/#/notifiche');
    await expect(page.getByText('Aggiungi alla schermata Home')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Attiva notifiche' })).toHaveCount(0);
  });
});

test.describe('service worker', () => {
  test.use({ serviceWorkers: 'allow' });

  // Chromium senza schermo non concede il permesso delle notifiche: nel
  // service worker showNotification viene sostituita da una che le registra.
  test('una push mostra la notifica con il titolo, il testo e la pagina da aprire', async ({ page, context }) => {
    await apiFinta(page);
    const cdp = await context.newCDPSession(page);
    const registrazioni = [];
    cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => registrazioni.push(...e.registrations));
    await cdp.send('ServiceWorker.enable');
    await page.goto('/');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect.poll(() => registrazioni.find((r) => !r.isDeleted)?.registrationId).toBeTruthy();
    const [sw] = context.serviceWorkers();
    await sw.evaluate(() => {
      self.mostrate = [];
      self.registration.showNotification = async (titolo, o) => {
        self.mostrate.push({ titolo, testo: o.body, link: o.data?.link, tag: o.tag });
      };
    });
    const contenuto = { titolo: 'Nuovo avviso: Chiusura', testo: 'Tocca per leggerlo in bacheca.', link: `#/bacheca/${AVVISO}`, tag: 'n1' };
    await cdp.send('ServiceWorker.deliverPushMessage', {
      origin: 'http://localhost:8088',
      registrationId: registrazioni.find((r) => !r.isDeleted).registrationId,
      data: JSON.stringify(contenuto),
    });
    const mostrate = () => sw.evaluate(() => self.mostrate);
    await expect.poll(mostrate).toEqual([{ titolo: contenuto.titolo, testo: contenuto.testo, link: contenuto.link, tag: 'n1' }]);
    // Nessuna cache, nemmeno dopo una push.
    expect(await page.evaluate(() => caches.keys())).toEqual([]);
  });
});
