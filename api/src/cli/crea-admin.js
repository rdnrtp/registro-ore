// Crea un utente amministratore in un'organizzazione già esistente.
// Uso: npm run crea-admin -- --org bv --email nome@esempio.it --nome Mario --cognome Rossi
// La password viene chiesta a terminale (senza mostrarla), due volte.
const readline = require('node:readline');
const { parseArgs } = require('node:util');
const { creaPool } = require('../db');
const { hashPassword, LUNGHEZZA_MINIMA } = require('../password');
const { normalizzaEmail } = require('../validazione');

function chiediNascosto(domanda) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let mostrata = false;
    // Non riscrive a video i caratteri digitati, solo la domanda.
    rl._writeToOutput = (testo) => {
      if (!mostrata) {
        process.stdout.write(testo);
        mostrata = true;
      }
    };
    rl.question(domanda, (risposta) => {
      rl.close();
      process.stdout.write('\n');
      resolve(risposta);
    });
  });
}

async function main() {
  const { values } = parseArgs({
    options: {
      org: { type: 'string' },
      email: { type: 'string' },
      nome: { type: 'string' },
      cognome: { type: 'string' },
    },
  });
  const mancanti = ['org', 'email', 'nome', 'cognome'].filter((k) => !values[k]?.trim());
  if (mancanti.length) {
    throw new Error(
      `Parametri mancanti: ${mancanti.map((k) => `--${k}`).join(', ')}\n` +
        'Uso: npm run crea-admin -- --org bv --email nome@esempio.it --nome Mario --cognome Rossi',
    );
  }
  const email = normalizzaEmail(values.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`Email non valida: ${values.email}`);
  if (!process.stdin.isTTY) {
    throw new Error('Serve un terminale interattivo per inserire la password (usa "docker compose exec", non "-T").');
  }

  const pool = creaPool();
  try {
    const org = await pool.query('SELECT id, name FROM organizations WHERE slug = $1', [values.org]);
    if (!org.rows[0]) {
      throw new Error(`Organizzazione "${values.org}" inesistente. Caricala prima con "npm run carica-organizzazione".`);
    }
    const esistente = await pool.query('SELECT 1 FROM users WHERE email = $1', [email]);
    if (esistente.rows[0]) throw new Error(`Esiste già un utente con email ${email}`);

    const password = await chiediNascosto(`Password (almeno ${LUNGHEZZA_MINIMA} caratteri): `);
    if (password.length < LUNGHEZZA_MINIMA) throw new Error(`Password troppo corta: servono almeno ${LUNGHEZZA_MINIMA} caratteri.`);
    const conferma = await chiediNascosto('Ripeti la password: ');
    if (password !== conferma) throw new Error('Le due password non coincidono.');

    await pool.query(
      `INSERT INTO users (organization_id, email, first_name, last_name, role, password_hash)
       VALUES ($1, $2, $3, $4, 'amministratore', $5)`,
      [org.rows[0].id, email, values.nome.trim(), values.cognome.trim(), await hashPassword(password)],
    );
    console.log(`Amministratore ${email} creato nell'organizzazione ${org.rows[0].name}.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
