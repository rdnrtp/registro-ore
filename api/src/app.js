const express = require('express');
const cookieParser = require('cookie-parser');
const { autenticato } = require('./auth');
const { rotteAuth } = require('./routes/auth');
const { rotteInviti } = require('./routes/inviti');
const { rotteOrganizzazione } = require('./routes/organizzazione');
const { rotteRegistro } = require('./routes/registro');
const { rotteUtenti } = require('./routes/utenti');
const { rotteConfigurazione } = require('./routes/configurazione');
const { rotteModello } = require('./routes/modello');
const { rotteCollaboratori } = require('./routes/collaboratori');
const { rotteEsportazione } = require('./routes/esportazione');
const { rotteInvio } = require('./routes/invio');
const { rottePosta } = require('./routes/posta');
const { rotteBacheca } = require('./routes/bacheca');
const { rottePush } = require('./routes/push');
const { rotteSpese } = require('./routes/spese');
const { ErroreHttp } = require('./errori');
const { statoApp } = require('./stato');
const { ultimiGiri } = require('./avvio');

// Difesa in più contro le richieste partite da altri siti (oltre al cookie
// SameSite=Lax): una modifica con un'intestazione Origin diversa
// dall'indirizzo dell'app è respinta. Solo in produzione, dove l'indirizzo è
// uno solo (in sviluppo l'app si apre anche da IP e porte diverse).
function stessaOrigine(appUrl) {
  const origine = new URL(appUrl).origin;
  return (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const arrivo = req.get('origin');
    if (arrivo && arrivo !== origine) return res.status(403).json({ errore: 'Richiesta non consentita' });
    next();
  };
}

function creaApp({ pool, config }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  if (config.produzione) app.use('/api', stessaOrigine(config.appUrl));

  // Controllo interno di Docker: l'API risponde e il database anche.
  app.get('/api/salute', async (req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });
  // Per il monitoraggio esterno: anche posta e lavori in sottofondo.
  app.get('/api/stato', async (req, res) => {
    const stato = await statoApp(pool, ultimiGiri);
    res.set('Cache-Control', 'no-store').status(stato.ok ? 200 : 503).json(stato);
  });
  // Rotte pubbliche: accesso, uscita (/me si protegge da sé) e link di invito.
  app.use('/api/auth', rotteAuth({ pool, config }));
  app.use('/api/inviti', rotteInviti({ pool, config }));
  // Tutte le altre richiedono un utente autenticato e attivo: req.utente.
  app.use('/api', autenticato(pool, config));
  app.use('/api', rotteOrganizzazione({ pool, config }));
  app.use('/api', rotteRegistro({ pool, config }));
  app.use('/api', rotteUtenti({ pool, config }));
  app.use('/api', rotteConfigurazione({ pool, config }));
  app.use('/api', rotteModello({ pool, config }));
  app.use('/api', rotteCollaboratori({ pool, config }));
  app.use('/api', rotteEsportazione({ pool, config }));
  app.use('/api', rotteInvio({ pool, config }));
  app.use('/api', rottePosta({ pool, config }));
  app.use('/api', rotteBacheca({ pool, config }));
  app.use('/api', rottePush({ pool, config }));
  app.use('/api', rotteSpese({ pool, config }));

  app.use('/api', (req, res) => res.status(404).json({ errore: 'Non trovato' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof ErroreHttp) return res.status(err.stato).json({ errore: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ errore: 'Richiesta non valida' });
    if (err.type === 'entity.too.large') return res.status(413).json({ errore: 'File o richiesta troppo grande' });
    console.error(err);
    res.status(500).json({ errore: 'Errore interno' });
  });

  return app;
}

module.exports = { creaApp };
