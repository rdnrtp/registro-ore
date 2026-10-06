// Uso: npm run migra
const { creaPool } = require('../db');
const { eseguiMigrazioni } = require('../migrazioni');

(async () => {
  const pool = creaPool();
  try {
    const eseguite = await eseguiMigrazioni(pool, console.log);
    console.log(eseguite.length ? `Migrazioni applicate: ${eseguite.length}` : 'Database già aggiornato.');
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
