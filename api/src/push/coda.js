// Coda delle notifiche push (tabella push_outbox), inviata dall'API in
// sottofondo (avvio.js) come la coda delle email.
//
// - Una riga per notifica e dispositivo, presa da un solo elaboratore alla
//   volta (FOR UPDATE SKIP LOCKED) e segnata "in_invio" prima dell'invio.
// - Fascia di silenzio: dalle 22 alle 7 (ora italiana) le push non partono;
//   una riga che arriva al suo turno in quella fascia slitta alle 7:00
//   (tranne la notifica di prova, chiesta dall'utente in quel momento).
// - Dispositivo non più valido (il servizio risponde 404 o 410: app
//   disinstallata, permesso tolto, iscrizione scaduta): l'iscrizione viene
//   cancellata. Se la notifica non è arrivata su nessun altro dispositivo,
//   ripiega sull'email (ripiegaSuEmail); le notifiche successive, senza più
//   dispositivi, vanno per email da sole.
// - Errore temporaneo (rete, 429, 5xx): nuovo tentativo dopo 1, 2, 4…
//   minuti, fino a PUSH_MAX_TENTATIVI; poi errore e ripiego sull'email.
// - Una riga rimasta "in_invio" (API fermata durante l'invio) torna in
//   attesa: un doppione non fa danni, perché il telefono sostituisce una
//   notifica con lo stesso "tag" (l'id della notifica) invece di mostrarne due.
const { transazione } = require('../db');
const { ripiegaSuEmail, regola } = require('../notifiche');
const { inSilenzio, fuoriDalSilenzio } = require('../tempo');

const DURATA_INVIO_MINUTI = 2;
const ritardoSecondi = (tentativi) => Math.min(60 * 2 ** Math.max(tentativi - 1, 0), 3600);
const nonValido = (err) => err?.statusCode === 404 || err?.statusCode === 410;
// 429 (troppe richieste) e 5xx: il servizio push riproverà a rispondere.
const temporaneo = (err) => !Number.isInteger(err?.statusCode) || err.statusCode === 429 || err.statusCode >= 500;
const descriviErrore = (err) =>
  String(err?.statusCode ? `${err.statusCode} ${err.body || err.message || ''}` : err?.message || err).trim().slice(0, 500);

async function riprendiInterrotte(pool, adesso) {
  await pool.query(
    `UPDATE push_outbox SET status = 'in_attesa', locked_until = NULL
      WHERE status = 'in_invio' AND locked_until < $1`,
    [adesso],
  );
}

// Prossima riga da elaborare: { riga } da inviare, oppure null se non ce ne
// sono. Le righe senza dispositivo o nella fascia di silenzio si sistemano
// qui (errore + ripiego, oppure rinvio alle 7) e si passa alla successiva.
async function prenota(pool, config, adesso) {
  for (;;) {
    const esito = await transazione(pool, async (client) => {
      const { rows } = await client.query(
        `SELECT o.id, o.notification_id, o.subscription_id, o.attempts,
                n.kind, n.title, n.short_body, n.link,
                s.endpoint, s.p256dh, s.auth
           FROM push_outbox o
           JOIN notifications n ON n.id = o.notification_id
           LEFT JOIN push_subscriptions s ON s.id = o.subscription_id
          WHERE o.status = 'in_attesa' AND (o.next_attempt_at <= $1 OR o.subscription_id IS NULL)
          ORDER BY o.next_attempt_at, o.created_at
          LIMIT 1
          FOR UPDATE OF o SKIP LOCKED`,
        [adesso],
      );
      const r = rows[0];
      if (!r) return { fine: true };
      if (!r.subscription_id) {
        await client.query(
          `UPDATE push_outbox SET status = 'errore', last_error = 'Dispositivo non più iscritto' WHERE id = $1`,
          [r.id],
        );
        await ripiegaSuEmail(client, config, r.notification_id);
        return { saltata: true };
      }
      if (!regola(r.kind).subito && inSilenzio(adesso)) {
        await client.query('UPDATE push_outbox SET next_attempt_at = $2 WHERE id = $1', [r.id, fuoriDalSilenzio(adesso)]);
        return { saltata: true };
      }
      await client.query(
        `UPDATE push_outbox SET status = 'in_invio', attempts = attempts + 1,
                locked_until = $2::timestamptz + make_interval(mins => $3)
          WHERE id = $1`,
        [r.id, adesso, DURATA_INVIO_MINUTI],
      );
      return { riga: { ...r, attempts: r.attempts + 1 } };
    });
    if (!esito.saltata) return esito.riga ?? null;
  }
}

// Contenuto della push: lo legge il service worker (frontend/public/sw.js).
const contenuto = (r) => ({ titolo: r.title, testo: r.short_body ?? '', link: r.link ?? '#/', tag: r.notification_id });

async function registraEsito(pool, config, riga, adesso, err) {
  if (!err) {
    await pool.query(`UPDATE push_outbox SET status = 'inviata', sent_at = now(), locked_until = NULL, last_error = NULL WHERE id = $1`, [riga.id]);
    await pool.query('UPDATE push_subscriptions SET last_success_at = now() WHERE id = $1', [riga.subscription_id]);
    return 'inviata';
  }
  const ancora = temporaneo(err) && riga.attempts < config.push.maxTentativi;
  if (ancora) {
    await pool.query(
      `UPDATE push_outbox SET status = 'in_attesa', locked_until = NULL, last_error = $2,
              next_attempt_at = $3::timestamptz + make_interval(secs => $4)
        WHERE id = $1`,
      [riga.id, descriviErrore(err), adesso, ritardoSecondi(riga.attempts)],
    );
    return 'in_attesa';
  }
  return transazione(pool, async (client) => {
    await client.query(`UPDATE push_outbox SET status = 'errore', locked_until = NULL, last_error = $2 WHERE id = $1`, [
      riga.id,
      nonValido(err) ? `Dispositivo non più valido (${err.statusCode})` : descriviErrore(err),
    ]);
    // Le altre push in attesa per lo stesso dispositivo restano senza
    // dispositivo (ON DELETE SET NULL) e vengono chiuse al prossimo giro.
    if (nonValido(err)) await client.query('DELETE FROM push_subscriptions WHERE id = $1', [riga.subscription_id]);
    await ripiegaSuEmail(client, config, riga.notification_id);
    return nonValido(err) ? 'dispositivo_tolto' : 'errore';
  });
}

// Invia le push in attesa, al massimo `limite`. invia = funzione di
// src/push/invio.js (o una finta nei test).
// Restituisce { inviate, rinviate, errori, dispositivi_tolti }.
async function elaboraCodaPush(pool, { invia, config, adesso = new Date(), limite = 50, log = () => {} }) {
  await riprendiInterrotte(pool, adesso);
  const conteggio = { inviate: 0, rinviate: 0, errori: 0, dispositivi_tolti: 0 };
  for (let i = 0; i < limite; i++) {
    const riga = await prenota(pool, config, adesso);
    if (!riga) break;
    let errore = null;
    try {
      await invia(riga, contenuto(riga));
    } catch (err) {
      errore = err;
      log(`Push ${riga.id} (tentativo ${riga.attempts}): ${descriviErrore(err)}`);
    }
    const stato = await registraEsito(pool, config, riga, adesso, errore);
    if (stato === 'inviata') conteggio.inviate++;
    else if (stato === 'in_attesa') conteggio.rinviate++;
    else if (stato === 'dispositivo_tolto') conteggio.dispositivi_tolti++;
    else conteggio.errori++;
  }
  return conteggio;
}

module.exports = { elaboraCodaPush };
