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

// Il token contiene solo identità, organizzazione, versione delle sessioni
// dell'utente e id della sessione (riga di user_sessions): il ruolo e lo
// stato attivo si leggono dal database a ogni richiesta.
function firmaToken(config, utente, sessioneId) {
  return jwt.sign(
    { org: utente.organization_id, ver: utente.token_version, sid: sessioneId },
    config.jwtSecret,
    { subject: utente.id, expiresIn: `${config.jwtDurataOre}h`, algorithm: 'HS256' },
  );
}

// Registra una nuova sessione (login o link di invito) e restituisce il suo
// token. Toglie anche le sessioni scadute dell'utente.
async function apriSessione(db, config, utente) {
  await db.query('DELETE FROM user_sessions WHERE user_id = $1 AND expires_at <= now()', [utente.id]);
  const { rows } = await db.query(
    `INSERT INTO user_sessions (organization_id, user_id, expires_at)
     VALUES ($1, $2, now() + make_interval(hours => $3)) RETURNING id`,
    [utente.organization_id, utente.id, config.jwtDurataOre],
  );
  return firmaToken(config, utente, rows[0].id);
}

// Chiude la sessione del token indicato (uscita da questo dispositivo).
// Un token non valido o già chiuso non fa nulla.
async function chiudiSessione(db, config, token) {
  let dati;
  try {
    dati = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'], ignoreExpiration: true });
  } catch {
    return;
  }
  if (!isUuid(dati.sid) || !isUuid(dati.sub)) return;
  await db.query('DELETE FROM user_sessions WHERE id = $1 AND user_id = $2', [dati.sid, dati.sub]);
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
// La sessione deve esistere ancora in user_sessions: dopo "Esci" il token non
// vale più, anche se qualcuno ne ha conservato una copia.
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
    if (!isUuid(dati.sub) || !isUuid(dati.org) || !isUuid(dati.sid) || !Number.isInteger(dati.ver)) {
      cancellaCookie(res, config);
      return res.status(401).json({ errore: 'Sessione non valida o scaduta' });
    }
    const { rows } = await pool.query(
      `SELECT u.role FROM users u
         JOIN user_sessions s ON s.user_id = u.id AND s.organization_id = u.organization_id
        WHERE u.id = $1 AND u.organization_id = $2 AND u.active AND u.token_version = $3
          AND s.id = $4 AND s.expires_at > now()`,
      [dati.sub, dati.org, dati.ver, dati.sid],
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

module.exports = {
  COOKIE,
  RUOLI,
  firmaToken,
  apriSessione,
  chiudiSessione,
  impostaCookie,
  cancellaCookie,
  autenticato,
  richiediRuolo,
};
