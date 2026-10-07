// Supporto comune ai test: database di prova azzerato e due organizzazioni
// complete (A e B) con settori, attività e utenti.
const { Client } = require('pg');
const request = require('supertest');
const { creaPool } = require('../src/db');
const { creaApp } = require('../src/app');
const { eseguiMigrazioni } = require('../src/migrazioni');
const { hashPassword } = require('../src/password');

const PASSWORD = 'password-di-prova-123';

const configTest = {
  port: 0,
  jwtSecret: 'segreto-dei-test-lungo-almeno-trentadue-caratteri',
  jwtDurataOre: 1,
  invitoDurataOre: 72,
  cookieSecure: false,
  trustProxy: 0,
  login: { finestraMinuti: 15, maxFallitiPerEmail: 5, maxFallitiPerIp: 30 },
};

async function creaDatabaseSeManca(nome) {
  const client = new Client({ database: 'postgres' });
  await client.connect();
  try {
    const { rows } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [nome]);
    if (!rows[0]) await client.query(`CREATE DATABASE "${nome}"`);
  } finally {
    await client.end();
  }
}

// Ricrea da zero lo schema del database di prova. Per sicurezza rifiuta di
// lavorare su un database il cui nome non finisce con "_test".
async function preparaDatabase() {
  const nome = process.env.PGDATABASE;
  if (!nome || !nome.endsWith('_test')) {
    throw new Error(`I test cancellano il database: PGDATABASE deve finire con "_test" (ora: "${nome}")`);
  }
  await creaDatabaseSeManca(nome);
  const pool = creaPool();
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await eseguiMigrazioni(pool);
  return pool;
}

async function creaOrganizzazione(pool, slug, hash) {
  const q = async (sql, params) => (await pool.query(sql, params)).rows[0];
  const org = await q('INSERT INTO organizations (slug, name) VALUES ($1, $2) RETURNING id', [slug, `Impianto ${slug.toUpperCase()}`]);
  const settore = await q(
    `INSERT INTO sectors (organization_id, name, manager_emails) VALUES ($1, 'Segreteria', $2) RETURNING id`,
    [org.id, [`resp@${slug}.test`]],
  );
  const attivitaOre = await q(
    `INSERT INTO activities (organization_id, name, template_label, unit, template_row, sort_order)
     VALUES ($1, 'Segreteria', 'Segreteria', 'ore', 4, 1) RETURNING id`,
    [org.id],
  );
  const attivitaSedute = await q(
    `INSERT INTO activities (organization_id, name, template_label, unit, template_row, sort_order)
     VALUES ($1, 'PT singola', 'PT singola', 'sedute', 13, 2) RETURNING id`,
    [org.id],
  );
  await pool.query('INSERT INTO activity_sectors (organization_id, activity_id, sector_id) VALUES ($1, $2, $3)', [
    org.id,
    attivitaOre.id,
    settore.id,
  ]);
  const utente = async (prefisso, ruolo, attivo = true) =>
    q(
      `INSERT INTO users (organization_id, email, first_name, last_name, role, password_hash, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, email`,
      [org.id, `${prefisso}@${slug}.test`, `Nome${prefisso}`, `Cognome${slug.toUpperCase()}`, ruolo, hash, attivo],
    );
  return {
    id: org.id,
    settore: settore.id,
    attivitaOre: attivitaOre.id,
    attivitaSedute: attivitaSedute.id,
    admin: await utente('admin', 'amministratore'),
    collaboratore: await utente('collab', 'collaboratore'),
    disattivato: await utente('ex', 'collaboratore', false),
  };
}

async function preparaAmbiente() {
  const pool = await preparaDatabase();
  const hash = await hashPassword(PASSWORD);
  const A = await creaOrganizzazione(pool, 'a', hash);
  const B = await creaOrganizzazione(pool, 'b', hash);
  return { pool, A, B };
}

function nuovaApp(pool, config = configTest) {
  return creaApp({ pool, config });
}

// Restituisce un agente supertest con il cookie di sessione già impostato.
async function accedi(app, email, password = PASSWORD) {
  const agente = request.agent(app);
  const res = await agente.post('/api/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`Login di ${email} fallito: ${res.status}`);
  return agente;
}

module.exports = { PASSWORD, configTest, preparaAmbiente, nuovaApp, accedi };
