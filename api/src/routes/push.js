const express = require('express');
const { transazione } = require('../db');
const { ErroreHttp } = require('../errori');
const { notifica } = require('../notifiche');

// Servizi push dei browser: il server manda richieste solo a questi
// indirizzi (un indirizzo qualsiasi scelto dal client gli farebbe
// contattare anche servizi interni).
const SERVIZI_PUSH = ['fcm.googleapis.com', 'android.googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com'];
const servizioNoto = (host) => SERVIZI_PUSH.some((s) => host === s || host.endsWith(`.${s}`));

// Notifiche di prova ammesse per utente in PAUSA_PROVA_SECONDI.
const MAX_PROVE = 3;
const PAUSA_PROVA_SECONDI = 60;

const nonValido = (messaggio) => new ErroreHttp(400, messaggio);

function leggiEndpoint(valore) {
  if (typeof valore !== 'string' || valore.length > 2000) throw nonValido('Iscrizione non valida');
  let url;
  try {
    url = new URL(valore);
  } catch {
    throw nonValido('Iscrizione non valida');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !servizioNoto(url.hostname)) {
    throw nonValido('Servizio di notifica del browser non riconosciuto');
  }
  return url.href;
}

function leggiChiave(valore, byte) {
  if (typeof valore !== 'string' || !/^[A-Za-z0-9_-]+={0,2}$/.test(valore)) throw nonValido('Iscrizione non valida');
  const b = Buffer.from(valore, 'base64url');
  if (b.length !== byte) throw nonValido('Iscrizione non valida');
  return b.toString('base64url');
}

// Notifiche push del dispositivo che l'utente sta usando. Ogni utente
// gestisce solo le proprie iscrizioni: nessuna rotta accetta un utente.
function rottePush({ pool, config }) {
  const router = express.Router();

  const contaDispositivi = async (db, req) =>
    (
      await db.query('SELECT count(*)::int AS n FROM push_subscriptions WHERE user_id = $1 AND organization_id = $2', [
        req.utente.id,
        req.utente.organizzazioneId,
      ])
    ).rows[0].n;

  // { chiave_pubblica (null = push spente sul server), dispositivi }
  router.get('/push', async (req, res) => {
    res.json({ chiave_pubblica: config.push?.chiavePubblica ?? null, dispositivi: await contaDispositivi(pool, req) });
  });

  // Attiva (o rinnova) le push sul dispositivo. Corpo: l'iscrizione del
  // browser, { endpoint, keys: { p256dh, auth } } (PushSubscription.toJSON()).
  // L'iscrizione è legata alla sessione corrente: "Esci" la cancella.
  router.post('/push/iscrizioni', async (req, res) => {
    if (!config.push) throw new ErroreHttp(503, 'Le notifiche push non sono attive su questo server.');
    const b = req.body ?? {};
    const endpoint = leggiEndpoint(b.endpoint);
    const p256dh = leggiChiave(b.keys?.p256dh, 65);
    const auth = leggiChiave(b.keys?.auth, 16);
    const { id, organizzazioneId: org, sessioneId } = req.utente;
    const dispositivi = await transazione(pool, async (client) => {
      // Stesso browser usato prima da un altro utente: l'iscrizione passa a
      // chi lo usa ora (le push ancora in coda per l'altro ripiegano sull'email).
      await client.query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND (user_id <> $2 OR organization_id <> $3)', [
        endpoint,
        id,
        org,
      ]);
      await client.query(
        `INSERT INTO push_subscriptions (organization_id, user_id, session_id, endpoint, p256dh, auth)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (endpoint) DO UPDATE
           SET session_id = EXCLUDED.session_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, updated_at = now()`,
        [org, id, sessioneId, endpoint, p256dh, auth],
      );
      return contaDispositivi(client, req);
    });
    res.json({ dispositivi });
  });

  // Disattiva le push sul dispositivo. Corpo: { endpoint }. Solo le proprie.
  router.delete('/push/iscrizioni', async (req, res) => {
    const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint : '';
    await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2 AND organization_id = $3', [
      endpoint,
      req.utente.id,
      req.utente.organizzazioneId,
    ]);
    res.json({ dispositivi: await contaDispositivi(pool, req) });
  });

  // Notifica di prova a tutti i dispositivi dell'utente, subito (anche nella
  // fascia di silenzio: l'ha chiesta lui).
  router.post('/push/prova', async (req, res) => {
    const { id, organizzazioneId: org } = req.utente;
    const dispositivi = await transazione(pool, async (client) => {
      await client.query('SELECT 1 FROM users WHERE id = $1 AND organization_id = $2 FOR NO KEY UPDATE', [id, org]);
      const n = await contaDispositivi(client, req);
      if (!n) throw new ErroreHttp(409, 'Le notifiche non sono attive su nessun dispositivo.');
      const { rows } = await client.query(
        `SELECT count(*)::int AS n FROM notifications
          WHERE user_id = $1 AND organization_id = $2 AND kind = 'prova'
            AND created_at > now() - make_interval(secs => $3)`,
        [id, org, PAUSA_PROVA_SECONDI],
      );
      if (rows[0].n >= MAX_PROVE) throw new ErroreHttp(429, 'Hai già mandato diverse prove: aspetta un minuto.');
      await notifica(client, config, {
        organizzazioneId: org,
        utenti: [id],
        tipo: 'prova',
        titolo: 'Notifica di prova',
        testo: 'Se vedi questo messaggio, le notifiche funzionano su questo dispositivo.',
        link: '#/notifiche',
      });
      return n;
    });
    res.json({ dispositivi });
  });

  return router;
}

module.exports = { rottePush };
