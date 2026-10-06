const fs = require('node:fs');
const path = require('node:path');

const CARTELLA = path.join(__dirname, '..', 'migrations');
// Chiave arbitraria per l'advisory lock: evita due migrazioni in parallelo.
const LOCK_ID = 727301;

// Applica in ordine i file migrations/NNN_nome.sql non ancora eseguiti, ognuno
// nella propria transazione. Restituisce i nomi dei file applicati.
async function eseguiMigrazioni(pool, log = () => {}) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const { rows } = await client.query('SELECT version FROM schema_migrations');
    const applicate = new Set(rows.map((r) => r.version));
    const file = fs.readdirSync(CARTELLA).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
    const eseguite = [];
    for (const nome of file) {
      if (applicate.has(nome)) continue;
      const sql = fs.readFileSync(path.join(CARTELLA, nome), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [nome]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migrazione ${nome} fallita: ${err.message}`);
      }
      log(`Applicata ${nome}`);
      eseguite.push(nome);
    }
    return eseguite;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    client.release();
  }
}

module.exports = { eseguiMigrazioni };
