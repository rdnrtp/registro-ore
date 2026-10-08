const { caricaConfig } = require('./config');
const { creaPool } = require('./db');
const { creaApp } = require('./app');
const { avviaLavori } = require('./avvio');

const config = caricaConfig();
const pool = creaPool();
const server = creaApp({ pool, config }).listen(config.port, () => {
  console.log(`API in ascolto sulla porta ${config.port}`);
});
const fermaLavori = avviaLavori(pool, config);

function chiudi() {
  fermaLavori();
  server.close(() => pool.end().finally(() => process.exit(0)));
}
process.on('SIGTERM', chiudi);
process.on('SIGINT', chiudi);
