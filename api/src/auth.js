const jwt = require('jsonwebtoken');
const { isUuid } = require('./validazione');

const COOKIE = 'registro_ore_sessione';
const RUOLI = ['collaboratore', 'responsabile', 'amministratore'];

function opzioniCookie(config) {
  return {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax',
    path: '/',
  };
}

// Il token contiene solo identità, organizzazione e versione della sessione:
// il ruolo e lo stato attivo si leggono dal database a ogni richiesta.
function firmaToken(config, utente) {
  return jwt.sign(
    { org: utente.organization_id, ver: utente.token_version },
    config.jwtSecret,
    { subject: utente.id, expiresIn: `${config.jwtDurataOre}h`, algorithm: 'HS256' },
  );
}

function impostaCookie(res, config, token) {
  res.cookie(COOKIE, token, { ...opzioniCookie(config), maxAge: config.jwtDurataOre * 3600 * 1000 });
}

function cancellaCookie(res, config) {
  res.clearCookie(COOKIE, opzioniCookie(config));
}

// Verifica il token nel cookie e mette in req.utente identità, ruolo e
// organizzazione. Sono le uniche fonti valide per queste informazioni: corpo,
// query e parametri della richiesta non vanno mai usati al loro posto.
// Ruolo e stato attivo vengono dal database a ogni richiesta: un utente
// disattivato o con la password reimpostata è respinto subito, e un cambio di
// ruolo vale dalla richiesta successiva, senza aspettare la scadenza del token.
function autenticato(pool, config) {
  return async (req, res, next) => {
    const token = req.cookies?.[COOKIE];
    if (!token) return res.status(401).json({ errore: 'Accesso non effettuato' });
    let dati;
    try {
      dati = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    } catch {
      cancellaCookie(res, config);
      return res.status(401).json({ errore: 'Sessione non valida o scaduta' });
    }
    if (!isUuid(dati.sub) || !isUuid(dati.org) || !Number.isInteger(dati.ver)) {
      cancellaCookie(res, config);
      return res.status(401).json({ errore: 'Sessione non valida o scaduta' });
    }
    const { rows } = await pool.query(
      'SELECT role FROM users WHERE id = $1 AND organization_id = $2 AND active AND token_version = $3',
      [dati.sub, dati.org, dati.ver],
    );
    if (!rows[0] || !RUOLI.includes(rows[0].role)) {
      cancellaCookie(res, config);
      return res.status(401).json({ errore: 'Sessione non valida o scaduta' });
    }
    req.utente = Object.freeze({ id: dati.sub, organizzazioneId: dati.org, ruolo: rows[0].role });
    next();
  };
}

function richiediRuolo(...ammessi) {
  return (req, res, next) => {
    if (!req.utente) return res.status(401).json({ errore: 'Accesso non effettuato' });
    if (!ammessi.includes(req.utente.ruolo)) return res.status(403).json({ errore: 'Operazione non consentita' });
    next();
  };
}

module.exports = { COOKIE, RUOLI, firmaToken, impostaCookie, cancellaCookie, autenticato, richiediRuolo };
