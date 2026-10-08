const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { caricaConfig, controllaProduzione } = require('../src/config');
const { statoApp } = require('../src/stato');
const { PASSWORD, configTest, preparaAmbiente, nuovaApp } = require('./helpers');

const ENV_VALIDO = {
  AMBIENTE: 'produzione',
  PGHOST: 'db',
  PGUSER: 'registro_ore',
  PGDATABASE: 'registro_ore',
  PGPASSWORD: 'Xq3v9LmT0aR7pZk2Wc5Nf8Jh',
  JWT_SECRET: 'k'.repeat(64),
  APP_URL: 'https://ore.impianto.it',
  SMTP_HOST: 'smtp.fornitore.eu',
  SMTP_PORT: '587',
  SMTP_USER: 'utente-smtp',
  SMTP_PASSWORD: 'password-smtp-lunga',
  POSTA_MITTENTE: 'registro@ore.impianto.it',
  ALLARMI_EMAIL: 'admin@impianto.it',
};

describe('configurazione di produzione', () => {
  it('accetta una configurazione completa e forza cookie sicuri e TLS', () => {
    const config = caricaConfig({ ...ENV_VALIDO, COOKIE_SECURE: 'false' });
    assert.equal(config.produzione, true);
    assert.equal(config.cookieSecure, true);
    assert.equal(config.posta.richiediTls, true);
    assert.equal(config.allarmiEmail, 'admin@impianto.it');
  });

  it('elenca ogni variabile mancante, senza mostrare i valori', () => {
    const { JWT_SECRET, SMTP_HOST, ...resto } = ENV_VALIDO;
    assert.ok(JWT_SECRET && SMTP_HOST);
    assert.throws(() => caricaConfig(resto), (err) => {
      assert.match(err.message, /JWT_SECRET manca/);
      assert.match(err.message, /SMTP_HOST manca/);
      return true;
    });
  });

  it('rifiuta i valori dei file di esempio', () => {
    const problemi = controllaProduzione({
      ...ENV_VALIDO,
      JWT_SECRET: 'cambia-questa-chiave-con-almeno-32-caratteri-casuali',
      PGPASSWORD: 'SOSTITUISCI_con_genera-segreti',
      APP_URL: 'https://SOSTITUISCI.esempio.it',
      ALLARMI_EMAIL: 'tu@esempio.it',
    });
    assert.deepEqual(problemi, [
      'PGPASSWORD contiene ancora il valore di esempio',
      'JWT_SECRET contiene ancora il valore di esempio',
      'APP_URL contiene ancora il valore di esempio',
      'ALLARMI_EMAIL contiene ancora il valore di esempio',
    ]);
    assert.ok(!problemi.join(' ').includes('cambia-questa-chiave'));
  });

  it("rifiuta HTTP, Mailpit, password corte e mittente localhost", () => {
    const problemi = controllaProduzione({
      ...ENV_VALIDO,
      APP_URL: 'http://ore.impianto.it',
      SMTP_HOST: 'mailpit',
      PGPASSWORD: 'corta',
      POSTA_MITTENTE: 'registro-ore@localhost',
    });
    assert.equal(problemi.length, 4);
  });

  it('in sviluppo i controlli non si applicano', () => {
    const config = caricaConfig({ JWT_SECRET: 'x'.repeat(32) });
    assert.equal(config.produzione, false);
    assert.equal(config.cookieSecure, false);
  });
});

describe('stato e origine delle richieste', () => {
  let pool, A, app;

  before(async () => {
    ({ pool, A } = await preparaAmbiente());
    app = nuovaApp(pool, { ...configTest, produzione: true, appUrl: 'https://ore.impianto.it' });
  });
  after(() => pool.end());

  it('/api/stato risponde 200 senza dati', async () => {
    const res = await request(app).get('/api/stato');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true, database: 'ok', posta: 'ok', lavori: 'ok' });
    assert.equal(res.headers['cache-control'], 'no-store');
  });

  it('segnala le email ferme da più di 30 minuti e i lavori fermi', async () => {
    const { rows } = await pool.query(
      `INSERT INTO email_outbox (organization_id, kind, from_name, to_addresses, subject, body_text, created_at)
       VALUES ($1, 'prova', 'Prova', '{x@a.test}', 'Prova', 'Prova', now() - interval '31 minutes') RETURNING id`,
      [A.id],
    );
    const res = await request(app).get('/api/stato');
    assert.equal(res.status, 503);
    assert.equal(res.body.posta, 'in ritardo');
    await pool.query('DELETE FROM email_outbox WHERE id = $1', [rows[0].id]);

    const giri = new Map([['Coda email', Date.now() - 6 * 60 * 1000]]);
    const stato = await statoApp(pool, giri);
    assert.equal(stato.ok, false);
    assert.equal(stato.lavori, 'fermi');
  });

  it("respinge le modifiche che arrivano da un'altra origine", async () => {
    const fuori = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'https://sito-estraneo.test')
      .send({ email: A.admin.email, password: PASSWORD });
    assert.equal(fuori.status, 403);

    const dentro = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'https://ore.impianto.it')
      .send({ email: A.admin.email, password: PASSWORD });
    assert.equal(dentro.status, 200);

    // Senza Origin (es. client non browser) la richiesta passa ai controlli soliti.
    const senza = await request(app).post('/api/auth/login').send({ email: A.admin.email, password: PASSWORD });
    assert.equal(senza.status, 200);
  });
});
