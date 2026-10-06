const { Pool } = require('pg');

// pg restituisce i numeric come stringhe: per le quantità (al massimo 5 cifre,
// un decimale) la conversione a Number è sicura.
require('pg').types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
// Le date (senza ora) restano stringhe 'AAAA-MM-GG': niente fusi orari.
require('pg').types.setTypeParser(1082, (v) => v);

function creaPool(opzioni = {}) {
  return new Pool({ max: 10, ...opzioni });
}

// Esegue fn(client) in una transazione: COMMIT se termina, ROLLBACK se lancia.
async function transazione(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const risultato = await fn(client);
    await client.query('COMMIT');
    return risultato;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { creaPool, transazione };
