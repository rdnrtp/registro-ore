// "Password dimenticata?" dalla pagina di accesso e comando d'emergenza
// link-password da terminale.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFile } = require('node:child_process');
const request = require('supertest');
const { PASSWORD, configTest, preparaAmbiente, nuovaApp, accedi, emailInCoda } = require('./helpers');

const NUOVA_PASSWORD = 'password-dopo-il-reset-1';

// Il comando da terminale, come lo lancerebbe l'amministratore sul server.
function linkPassword(argomenti) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [path.join(__dirname, '..', 'src', 'cli', 'link-password.js'), ...argomenti],
      { env: { ...process.env, JWT_SECRET: configTest.jwtSecret, APP_URL: configTest.appUrl, AMBIENTE: '' } },
      (err, stdout, stderr) => resolve({ codice: err ? err.code : 0, stdout, stderr }),
    );
  });
}

describe('password dimenticata', () => {
  let pool, A, app;

  before(async () => {
    ({ pool, A } = await preparaAmbiente());
    app = nuovaApp(pool);
  });
  after(() => pool.end());

  const chiedi = (email, agente = request(app)) => agente.post('/api/auth/password-dimenticata').send({ email });
  const voci = async (azione, utenteId) =>
    (await pool.query('SELECT * FROM audit_log WHERE action = $1 AND target_id = $2 ORDER BY created_at', [azione, utenteId])).rows;
  const codiceDa = (testo) => /#\/invito\/([A-Za-z0-9_-]{43})/.exec(testo)?.[1];

  it('la risposta è identica per un utente attivo, uno disattivato e un indirizzo sconosciuto', async () => {
    const risposte = await Promise.all([chiedi(A.collaboratore.email), chiedi(A.disattivato.email), chiedi('nessuno@a.test')]);
    for (const r of risposte) {
      assert.equal(r.status, 200);
      assert.deepEqual(r.body, { ok: true, durata_minuti: 60 });
    }
    // Email solo all'utente attivo.
    const email = await emailInCoda(pool, A.id, 'invito');
    assert.deepEqual(
      email.map((e) => e.to_addresses),
      [[A.collaboratore.email]],
    );
    // Nel registro: la richiesta e quella ignorata del disattivato.
    const [richiesta] = await voci('utente.reset_richiesto', A.collaboratore.id);
    assert.equal(richiesta.actor_id, null);
    assert.equal(richiesta.details.origine, 'richiesta');
    assert.equal(richiesta.details.email, A.collaboratore.email);
    const [ignorata] = await voci('utente.reset_ignorato', A.disattivato.id);
    assert.equal(ignorata.details.motivo, 'utente disattivato');
    assert.equal((await emailInCoda(pool, A.id)).filter((e) => e.to_addresses.includes(A.disattivato.email)).length, 0);
  });

  it('il link vale un\'ora, una volta sola, e usarlo chiude le sessioni su tutti i dispositivi', async () => {
    const altroDispositivo = await accedi(app, A.admin.email);
    assert.equal((await chiedi(A.admin.email)).status, 200);
    const [email] = (await emailInCoda(pool, A.id, 'invito')).filter((e) => e.to_addresses.includes(A.admin.email));
    assert.match(email.subject, /reimpostare la password/);
    const codice = codiceDa(email.body_text);
    assert.ok(codice, 'link nel testo dell\'email');

    const { rows } = await pool.query(
      `SELECT origin, extract(epoch FROM expires_at - created_at) / 60 AS minuti FROM user_invites WHERE user_id = $1 AND used_at IS NULL`,
      [A.admin.id],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].origin, 'richiesta');
    assert.equal(Math.round(rows[0].minuti), 60);

    // Finché il link non è usato, la password attuale vale ancora.
    assert.equal((await request(app).post('/api/auth/login').send({ email: A.admin.email, password: PASSWORD })).status, 200);
    assert.equal((await altroDispositivo.get('/api/auth/me')).status, 200);

    const info = await request(app).get(`/api/inviti/${codice}`);
    assert.equal(info.body.scopo, 'reimposta');
    assert.equal((await request(app).post(`/api/inviti/${codice}`).send({ password: NUOVA_PASSWORD })).status, 200);
    assert.equal((await altroDispositivo.get('/api/auth/me')).status, 401);
    assert.equal((await request(app).post(`/api/inviti/${codice}`).send({ password: 'ancora-un-altra-1' })).status, 410);
    assert.equal((await request(app).post('/api/auth/login').send({ email: A.admin.email, password: NUOVA_PASSWORD })).status, 200);

    const [uso] = await voci('utente.password_reimpostata', A.admin.id);
    assert.equal(uso.details.origine, 'richiesta');
  });

  it('una nuova richiesta annulla il link precedente', async () => {
    const utente = A.collaboratore;
    const prima = codiceDa((await emailInCoda(pool, A.id, 'invito')).find((e) => e.to_addresses.includes(utente.email)).body_text);
    // body_text di un'email non ancora inviata è ancora lì: il link precedente.
    assert.equal((await request(app).get(`/api/inviti/${prima}`)).status, 200);
    await chiedi(utente.email);
    assert.equal((await request(app).get(`/api/inviti/${prima}`)).status, 404);
  });

  it('email non valida = 400', async () => {
    assert.equal((await chiedi('non-una-email')).status, 400);
    assert.equal((await request(app).post('/api/auth/password-dimenticata').send({})).status, 400);
  });

  it('limite per email (anche da IP diversi) e per IP', async () => {
    // Un'app nuova (limitatori azzerati) che legge l'IP da X-Forwarded-For.
    const conProxy = nuovaApp(pool, { ...configTest, trustProxy: 1 });
    const da = (ip, email) => request(conProxy).post('/api/auth/password-dimenticata').set('X-Forwarded-For', ip).send({ email });
    for (let i = 1; i <= 3; i++) assert.equal((await da(`10.0.0.${i}`, 'limite@a.test')).status, 200);
    const quarta = await da('10.0.0.4', 'LIMITE@a.test');
    assert.equal(quarta.status, 429);
    assert.match(quarta.body.errore, /Troppe richieste/);
    // Lo stesso IP con indirizzi diversi: 10 richieste, poi basta.
    for (let i = 1; i <= 10; i++) assert.equal((await da('10.0.1.1', `ip${i}@a.test`)).status, 200);
    assert.equal((await da('10.0.1.1', 'ip11@a.test')).status, 429);
    assert.equal((await da('10.0.1.2', 'ip11@a.test')).status, 200);
  });

  describe('comando link-password', () => {
    it('stampa un link monouso che funziona anche senza email e lo registra', async () => {
      const agente = await accedi(app, A.collaboratore.email);
      const prima = (await emailInCoda(pool, A.id)).length;
      const r = await linkPassword(['--email', ` ${A.collaboratore.email.toUpperCase()} `, '--minuti', '30']);
      assert.equal(r.codice, 0, r.stderr);
      const codice = codiceDa(r.stdout);
      assert.ok(codice, r.stdout);
      assert.match(r.stdout, new RegExp(`${configTest.appUrl}/#/invito/`));
      assert.equal((await emailInCoda(pool, A.id)).length, prima, 'nessuna email in coda');

      const { rows } = await pool.query(
        `SELECT origin, created_by, extract(epoch FROM expires_at - created_at) / 60 AS minuti
           FROM user_invites WHERE user_id = $1 AND used_at IS NULL`,
        [A.collaboratore.id],
      );
      assert.equal(rows.length, 1, 'i link precedenti non usati sono annullati');
      assert.equal(rows[0].origin, 'terminale');
      assert.equal(rows[0].created_by, null);
      assert.equal(Math.round(rows[0].minuti), 30);
      const traccia = (await voci('utente.link_creato', A.collaboratore.id)).at(-1);
      assert.equal(traccia.actor_id, null);
      assert.equal(traccia.details.origine, 'terminale');

      assert.equal((await request(app).post(`/api/inviti/${codice}`).send({ password: NUOVA_PASSWORD })).status, 200);
      assert.equal((await agente.get('/api/auth/me')).status, 401, 'sessioni chiuse');
      assert.equal((await request(app).post(`/api/inviti/${codice}`).send({ password: NUOVA_PASSWORD })).status, 410);
      assert.equal((await voci('utente.password_reimpostata', A.collaboratore.id)).at(-1).details.origine, 'terminale');
    });

    it('rifiuta utenti inesistenti, disattivati e durate fuori misura', async () => {
      const inesistente = await linkPassword(['--email', 'nessuno@a.test']);
      assert.equal(inesistente.codice, 1);
      assert.match(inesistente.stderr, /Nessun utente/);
      const disattivato = await linkPassword(['--email', A.disattivato.email]);
      assert.equal(disattivato.codice, 1);
      assert.match(disattivato.stderr, /disattivato/);
      assert.equal((await linkPassword(['--email', A.admin.email, '--minuti', '99999'])).codice, 1);
      assert.equal((await linkPassword([])).codice, 1);
    });
  });
});
