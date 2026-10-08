const express = require('express');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { COOKIE, apriSessione, chiudiSessione, impostaCookie, cancellaCookie, autenticato } = require('../auth');
const { verificaPassword, hashPassword } = require('../password');
const { normalizzaEmail } = require('../validazione');

function limitatoriLogin(config) {
  const comuni = {
    windowMs: config.login.finestraMinuti * 60 * 1000,
    // Contano solo i tentativi falliti.
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { errore: 'Troppi tentativi di accesso falliti. Riprova più tardi.' },
  };
  return [
    rateLimit({ ...comuni, limit: config.login.maxFallitiPerIp }),
    rateLimit({
      ...comuni,
      limit: config.login.maxFallitiPerEmail,
      keyGenerator: (req) => `${ipKeyGenerator(req.ip)}|${normalizzaEmail(req.body?.email ?? '')}`,
    }),
  ];
}

function rotteAuth({ pool, config }) {
  const router = express.Router();
  // Hash di confronto per le email inesistenti: la risposta impiega lo stesso
  // tempo e non rivela quali email sono registrate.
  const hashFittizio = hashPassword('password-fittizia-per-i-tempi');

  router.post('/login', ...limitatoriLogin(config), async (req, res) => {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
      return res.status(400).json({ errore: 'Inserisci email e password' });
    }
    const { rows } = await pool.query(
      'SELECT id, organization_id, role, password_hash, token_version, active FROM users WHERE email = $1',
      [normalizzaEmail(email)],
    );
    const utente = rows[0];
    // Senza password (invito non ancora usato) il confronto avviene comunque,
    // con l'hash fittizio, e fallisce.
    const hash = utente?.password_hash ?? (await hashFittizio);
    const valida = (await verificaPassword(password, hash)) && Boolean(utente?.password_hash);
    if (!utente || !valida || !utente.active) {
      return res.status(401).json({ errore: 'Email o password non corretti' });
    }
    impostaCookie(res, config, await apriSessione(pool, config, utente));
    res.json({ ok: true });
  });

  // Esci: chiude sul server la sessione di questo dispositivo, così il token
  // non vale più nemmeno se ne è rimasta una copia (es. PC condiviso).
  router.post('/logout', async (req, res) => {
    const token = req.cookies?.[COOKIE];
    if (token) await chiudiSessione(pool, config, token);
    cancellaCookie(res, config);
    res.json({ ok: true });
  });

  // Esci da tutti i dispositivi, compreso questo. Restituisce quante
  // sessioni sono state chiuse.
  router.post('/esci-ovunque', autenticato(pool, config), async (req, res) => {
    const { rowCount } = await pool.query('DELETE FROM user_sessions WHERE user_id = $1 AND organization_id = $2', [
      req.utente.id,
      req.utente.organizzazioneId,
    ]);
    cancellaCookie(res, config);
    res.json({ ok: true, sessioni_chiuse: rowCount });
  });

  router.get('/me', autenticato(pool, config), async (req, res) => {
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.role,
              o.id AS org_id, o.name AS org_name, o.slug AS org_slug
         FROM users u
         JOIN organizations o ON o.id = u.organization_id
        WHERE u.id = $1 AND u.organization_id = $2 AND u.active`,
      [req.utente.id, req.utente.organizzazioneId],
    );
    if (!rows[0]) {
      cancellaCookie(res, config);
      return res.status(401).json({ errore: 'Utente non più attivo' });
    }
    const u = rows[0];
    // Settori di cui è responsabile (vuoto per gli altri ruoli).
    const settori = await pool.query(
      `SELECT s.id, s.name AS nome FROM sector_managers m
         JOIN sectors s ON s.id = m.sector_id AND s.organization_id = m.organization_id
        WHERE m.user_id = $1 AND m.organization_id = $2 AND $3 = 'responsabile'
        ORDER BY s.sort_order, s.name`,
      [u.id, req.utente.organizzazioneId, u.role],
    );
    res.json({
      utente: { id: u.id, email: u.email, nome: u.first_name, cognome: u.last_name, ruolo: u.role, settori: settori.rows },
      organizzazione: { id: u.org_id, nome: u.org_name, slug: u.org_slug },
    });
  });

  return router;
}

module.exports = { rotteAuth };
