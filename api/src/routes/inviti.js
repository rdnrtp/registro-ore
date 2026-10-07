const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { firmaToken, impostaCookie } = require('../auth');
const { transazione } = require('../db');
const { ErroreHttp } = require('../errori');
const { hashCodice, CODICE } = require('../inviti');
const { hashPassword, LUNGHEZZA_MINIMA, LUNGHEZZA_MASSIMA } = require('../password');
const { traccia } = require('../traccia');

// Link di invito, pubblici: chi apre il link sceglie la propria password.
// Lo stesso link serve al nuovo utente e a chi ha dimenticato la password.
// Ogni link vale una volta sola e scade (INVITO_DURATA_ORE).
function rotteInviti({ pool, config }) {
  const router = express.Router();

  // I codici sono casuali e lunghi: il limite frena solo i tentativi a vuoto.
  router.use(
    rateLimit({
      windowMs: config.login.finestraMinuti * 60 * 1000,
      limit: config.login.maxFallitiPerIp,
      skipSuccessfulRequests: true,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { errore: 'Troppi tentativi. Riprova più tardi.' },
    }),
  );

  const nonValido = () => new ErroreHttp(404, "Il link non è valido. Chiedi un nuovo link all'amministratore.");

  // Invito ancora utilizzabile, altrimenti lancia l'errore adatto.
  async function leggiInvito(db, codice, perAggiornare = false) {
    if (!CODICE.test(codice ?? '')) throw nonValido();
    const { rows } = await db.query(
      `SELECT i.id, i.user_id, i.organization_id, i.used_at, i.expires_at <= now() AS scaduto,
              u.first_name, u.last_name, u.email, u.active, u.password_hash IS NOT NULL AS ha_password,
              o.name AS org_name
         FROM user_invites i
         JOIN users u ON u.id = i.user_id AND u.organization_id = i.organization_id
         JOIN organizations o ON o.id = i.organization_id
        WHERE i.token_hash = $1
        ${perAggiornare ? 'FOR UPDATE OF i, u' : ''}`,
      [hashCodice(codice)],
    );
    const invito = rows[0];
    if (!invito || !invito.active) throw nonValido();
    if (invito.used_at) {
      throw new ErroreHttp(410, "Questo link è già stato usato. Se non ricordi la password, chiedi un nuovo link all'amministratore.");
    }
    if (invito.scaduto) throw new ErroreHttp(410, "Questo link è scaduto. Chiedi un nuovo link all'amministratore.");
    return invito;
  }

  router.get('/:codice', async (req, res) => {
    const i = await leggiInvito(pool, req.params.codice);
    res.json({
      nome: i.first_name,
      cognome: i.last_name,
      email: i.email,
      organizzazione: i.org_name,
      scopo: i.ha_password ? 'reimposta' : 'nuovo',
    });
  });

  // Corpo: { password }. Imposta la password, consuma il link, chiude le
  // sessioni aperte con la password precedente ed effettua l'accesso.
  router.post('/:codice', async (req, res) => {
    const password = req.body?.password;
    if (typeof password !== 'string' || password.length < LUNGHEZZA_MINIMA) {
      throw new ErroreHttp(400, `La password deve avere almeno ${LUNGHEZZA_MINIMA} caratteri.`);
    }
    if (Buffer.byteLength(password) > LUNGHEZZA_MASSIMA) {
      throw new ErroreHttp(400, `La password può avere al massimo ${LUNGHEZZA_MASSIMA} caratteri.`);
    }
    // Prima un controllo senza blocchi, per non calcolare l'hash (lento) per un link non valido.
    await leggiInvito(pool, req.params.codice);
    const hash = await hashPassword(password);
    const utente = await transazione(pool, async (client) => {
      const i = await leggiInvito(client, req.params.codice, true);
      await client.query('UPDATE user_invites SET used_at = now() WHERE id = $1', [i.id]);
      const { rows } = await client.query(
        `UPDATE users SET password_hash = $3, token_version = token_version + 1
          WHERE id = $1 AND organization_id = $2
          RETURNING id, organization_id, role, token_version`,
        [i.user_id, i.organization_id, hash],
      );
      await traccia(client, {
        organizzazioneId: i.organization_id,
        utente: { id: i.user_id },
        azione: i.ha_password ? 'utente.password_reimpostata' : 'utente.attivato',
        tipo: 'utente',
        id: i.user_id,
      });
      return rows[0];
    });
    impostaCookie(res, config, firmaToken(config, utente));
    res.json({ ok: true });
  });

  return router;
}

module.exports = { rotteInviti };
