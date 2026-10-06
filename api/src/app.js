const express = require('express');
const cookieParser = require('cookie-parser');
const { rotteAuth } = require('./routes/auth');
const { rotteOrganizzazione } = require('./routes/organizzazione');
const { rotteRegistro } = require('./routes/registro');
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
  app.use('/api/auth', rotteAuth({ pool, config }));
  app.use('/api', rotteOrganizzazione({ pool, config }));
  app.use('/api', rotteRegistro({ pool, config }));

  app.use('/api', (req, res) => res.status(404).json({ errore: 'Non trovato' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof ErroreHttp) return res.status(err.stato).json({ errore: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ errore: 'Richiesta non valida' });
    console.error(err);
    res.status(500).json({ errore: 'Errore interno' });
  });

  return app;
}

module.exports = { creaApp };
