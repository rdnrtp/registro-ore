// Creazione degli utenti con link di invito, scelta della password, link per
// la password dimenticata.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { PASSWORD, configTest, preparaAmbiente, nuovaApp, accedi } = require('./helpers');

const NUOVA_PASSWORD = 'una-password-nuova-1';

describe('inviti', () => {
  let pool, A, app, admin;

  before(async () => {
    ({ pool, A } = await preparaAmbiente());
    app = nuovaApp(pool);
    admin = await accedi(app, A.admin.email);
  });
  after(() => pool.end());

  const crea = (dati) =>
    admin.post('/api/utenti').send({ nome: 'Nuovo', cognome: 'Collega', ruolo: 'collaboratore', ...dati });
  const login = (email, password) => request(app).post('/api/auth/login').send({ email, password });
  const usa = (codice, password = NUOVA_PASSWORD, agente = request(app)) => agente.post(`/api/inviti/${codice}`).send({ password });

  it("l'amministratore crea un utente senza password e riceve il link", async () => {
    const res = await crea({ email: '  Nuovo.Collega@A.test ' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.utente.email, 'nuovo.collega@a.test');
    assert.equal(res.body.utente.password_impostata, false);
    assert.match(res.body.invito.codice, /^[A-Za-z0-9_-]{43}$/);
    const scadenza = new Date(res.body.invito.scadenza).getTime();
    const attesa = Date.now() + configTest.invitoDurataOre * 3600 * 1000;
    assert.ok(Math.abs(scadenza - attesa) < 60_000, 'scadenza secondo INVITO_DURATA_ORE');
    // Nel database c'è solo l'hash del codice.
    const { rows } = await pool.query('SELECT token_hash FROM user_invites WHERE user_id = $1', [res.body.utente.id]);
    assert.equal(rows.length, 1);
    assert.notEqual(rows[0].token_hash, res.body.invito.codice);
    assert.doesNotMatch(JSON.stringify((await admin.get(`/api/utenti/${res.body.utente.id}`)).body), new RegExp(res.body.invito.codice));
    // Senza password non si accede, con nessuna password.
    assert.equal((await login('nuovo.collega@a.test', '')).status, 400);
    assert.equal((await login('nuovo.collega@a.test', 'qualsiasi-password')).status, 401);
  });

  it('il link mostra a chi è destinato e fa scegliere la password, una volta sola', async () => {
    const { body } = await crea({ email: 'monouso@a.test', nome: 'Mario', cognome: 'Rossi' });
    const codice = body.invito.codice;
    const info = await request(app).get(`/api/inviti/${codice}`);
    assert.equal(info.status, 200);
    assert.deepEqual(info.body, { nome: 'Mario', cognome: 'Rossi', email: 'monouso@a.test', organizzazione: 'Impianto A', scopo: 'nuovo' });

    const corta = await usa(codice, 'corta');
    assert.equal(corta.status, 400);
    assert.match(corta.body.errore, /almeno 10 caratteri/);
    assert.equal((await usa(codice, 'x'.repeat(73))).status, 400);

    // Il primo uso imposta la password ed effettua l'accesso.
    const agente = request.agent(app);
    const res = await usa(codice, NUOVA_PASSWORD, agente);
    assert.equal(res.status, 200);
    assert.match(res.headers['set-cookie'].join(';'), /registro_ore_sessione=/);
    assert.equal((await agente.get('/api/auth/me')).body.utente.email, 'monouso@a.test');
    assert.equal((await login('monouso@a.test', NUOVA_PASSWORD)).status, 200);

    // Il secondo no, nemmeno con un'altra password.
    const secondo = await usa(codice, 'un-altra-password-99');
    assert.equal(secondo.status, 410);
    assert.match(secondo.body.errore, /già stato usato/);
    assert.equal((await request(app).get(`/api/inviti/${codice}`)).status, 410);
    assert.equal((await login('monouso@a.test', 'un-altra-password-99')).status, 401);
  });

  it('due richieste contemporanee con lo stesso link: ne riesce una sola', async () => {
    const { body } = await crea({ email: 'parallelo@a.test' });
    const risposte = await Promise.all([usa(body.invito.codice, 'prima-password-123'), usa(body.invito.codice, 'seconda-password-456')]);
    assert.deepEqual(risposte.map((r) => r.status).sort(), [200, 410]);
    const vincente = risposte[0].status === 200 ? 'prima-password-123' : 'seconda-password-456';
    assert.equal((await login('parallelo@a.test', vincente)).status, 200);
  });

  it('un link scaduto non funziona', async () => {
    const { body } = await crea({ email: 'scaduto@a.test' });
    await pool.query("UPDATE user_invites SET expires_at = now() - interval '1 minute' WHERE user_id = $1", [body.utente.id]);
    const info = await request(app).get(`/api/inviti/${body.invito.codice}`);
    assert.equal(info.status, 410);
    assert.match(info.body.errore, /scaduto/);
    assert.equal((await usa(body.invito.codice)).status, 410);
    assert.equal((await login('scaduto@a.test', NUOVA_PASSWORD)).status, 401);
  });

  it('un nuovo link annulla quello precedente', async () => {
    const { body } = await crea({ email: 'secondo.link@a.test' });
    const nuovo = await admin.post(`/api/utenti/${body.utente.id}/invito`);
    assert.equal(nuovo.status, 201);
    assert.equal((await usa(body.invito.codice)).status, 404);
    assert.equal((await usa(nuovo.body.codice)).status, 200);
  });

  it('codici non validi o inventati rispondono 404', async () => {
    for (const codice of ['abc', 'x'.repeat(43), "'; DROP TABLE users; --", 'A'.repeat(200)]) {
      assert.equal((await request(app).get(`/api/inviti/${encodeURIComponent(codice)}`)).status, 404, codice);
      assert.equal((await usa(encodeURIComponent(codice))).status, 404, codice);
    }
  });

  describe('password dimenticata', () => {
    it('il nuovo link non cambia la password finché non viene usato, poi chiude le sessioni aperte', async () => {
      const vecchiaSessione = await accedi(app, A.collaboratore.email);
      const link = await admin.post(`/api/utenti/${A.collaboratore.id}/invito`);
      assert.equal(link.status, 201);
      assert.equal((await request(app).get(`/api/inviti/${link.body.codice}`)).body.scopo, 'reimposta');
      // Fino all'uso del link la vecchia password funziona.
      assert.equal((await login(A.collaboratore.email, PASSWORD)).status, 200);
      assert.equal((await vecchiaSessione.get('/api/auth/me')).status, 200);

      assert.equal((await usa(link.body.codice)).status, 200);
      assert.equal((await login(A.collaboratore.email, PASSWORD)).status, 401);
      assert.equal((await login(A.collaboratore.email, NUOVA_PASSWORD)).status, 200);
      // La sessione aperta con la vecchia password non vale più.
      assert.equal((await vecchiaSessione.get('/api/mese/2026/10')).status, 401);
    });
  });

  describe('utenti disattivati', () => {
    it('la disattivazione annulla i link non usati e non se ne possono creare di nuovi', async () => {
      const { body } = await crea({ email: 'da.disattivare@a.test' });
      assert.equal((await admin.patch(`/api/utenti/${body.utente.id}`).send({ attivo: false })).status, 200);
      assert.equal((await usa(body.invito.codice)).status, 404);
      const nuovo = await admin.post(`/api/utenti/${body.utente.id}/invito`);
      assert.equal(nuovo.status, 409);
      assert.match(nuovo.body.errore, /riattivalo/);
      // Riattivato, un nuovo link funziona.
      await admin.patch(`/api/utenti/${body.utente.id}`).send({ attivo: true });
      const ancora = await admin.post(`/api/utenti/${body.utente.id}/invito`);
      assert.equal((await usa(ancora.body.codice)).status, 200);
    });
  });

  it('chi non è amministratore non crea utenti né link', async () => {
    const collab = await accedi(app, A.collaboratore.email, NUOVA_PASSWORD);
    assert.equal((await collab.post('/api/utenti').send({ nome: 'X', cognome: 'Y', email: 'x@a.test', ruolo: 'amministratore' })).status, 403);
    assert.equal((await collab.post(`/api/utenti/${A.collaboratore.id}/invito`)).status, 403);
    const { rows } = await pool.query("SELECT 1 FROM users WHERE email = 'x@a.test'");
    assert.equal(rows.length, 0);
  });

  it('creazione e uso dei link sono nella traccia delle modifiche', async () => {
    const { voci } = (await admin.get('/api/registro-modifiche')).body;
    const azioni = new Set(voci.map((v) => v.azione));
    for (const a of ['utente.creato', 'utente.attivato', 'utente.link_creato', 'utente.password_reimpostata', 'utente.disattivato']) {
      assert.ok(azioni.has(a), a);
    }
    const creato = voci.find((v) => v.azione === 'utente.creato' && v.dettagli.email === 'monouso@a.test');
    assert.equal(creato.autore, 'Nomeadmin CognomeA');
    // Mai codici o password nella traccia.
    assert.doesNotMatch(JSON.stringify(voci), /password-|token_hash|codice/);
  });
});
