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
const { ErroreHttp } = require('./errori');

function creaApp({ pool, config }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.get('/api/salute', async (req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true });
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
