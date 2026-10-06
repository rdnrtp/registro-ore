const jwt = require('jsonwebtoken');

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

function firmaToken(config, utente) {
  return jwt.sign(
    { org: utente.organization_id, ruolo: utente.role },
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
function autenticato(config) {
  return (req, res, next) => {
    const token = req.cookies?.[COOKIE];
    if (!token) return res.status(401).json({ errore: 'Accesso non effettuato' });
    let dati;
    try {
      dati = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    } catch {
      cancellaCookie(res, config);
      return res.status(401).json({ errore: 'Sessione non valida o scaduta' });
    }
    if (!dati.sub || !dati.org || !RUOLI.includes(dati.ruolo)) {
      return res.status(401).json({ errore: 'Sessione non valida o scaduta' });
    }
    req.utente = Object.freeze({ id: dati.sub, organizzazioneId: dati.org, ruolo: dati.ruolo });
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
