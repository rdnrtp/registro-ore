const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { PASSWORD, configTest, preparaAmbiente, nuovaApp, accedi } = require('./helpers');

describe('login', () => {
  let pool, A, app;

  before(async () => {
    ({ pool, A } = await preparaAmbiente());
    app = nuovaApp(pool);
  });
  after(() => pool.end());

  it('riesce con credenziali corrette e imposta un cookie httpOnly', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: A.admin.email, password: PASSWORD });
    assert.equal(res.status, 200);
    const cookie = res.headers['set-cookie'].join(';');
    assert.match(cookie, /registro_ore_sessione=/);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    // Il token non viene restituito nel corpo della risposta.
    assert.deepEqual(res.body, { ok: true });
  });

  it('dopo il login /me restituisce nome e organizzazione', async () => {
    const agente = await accedi(app, A.admin.email);
    const res = await agente.get('/api/auth/me');
    assert.equal(res.status, 200);
    assert.equal(res.body.utente.nome, 'Nomeadmin');
    assert.equal(res.body.utente.cognome, 'CognomeA');
    assert.equal(res.body.utente.ruolo, 'amministratore');
    assert.equal(res.body.organizzazione.nome, 'Impianto A');
  });

  it("accetta l'email con maiuscole e spazi", async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: `  ${A.collaboratore.email.toUpperCase()} `, password: PASSWORD });
    assert.equal(res.status, 200);
  });

  it('fallisce con password sbagliata', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: A.admin.email, password: 'sbagliata-123' });
    assert.equal(res.status, 401);
    assert.equal(res.headers['set-cookie'], undefined);
  });

  it('fallisce con email inesistente, con lo stesso messaggio', async () => {
    const sbagliata = await request(app).post('/api/auth/login').send({ email: A.admin.email, password: 'x' });
    const inesistente = await request(app).post('/api/auth/login').send({ email: 'nessuno@a.test', password: 'x' });
    assert.equal(inesistente.status, 401);
    assert.equal(inesistente.body.errore, sbagliata.body.errore);
  });

  it('fallisce per un utente disattivato', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: A.disattivato.email, password: PASSWORD });
    assert.equal(res.status, 401);
  });

  it('rifiuta richieste senza email o password', async () => {
    assert.equal((await request(app).post('/api/auth/login').send({ email: A.admin.email })).status, 400);
    assert.equal((await request(app).post('/api/auth/login').send({ email: 1, password: 2 })).status, 400);
  });

  it('logout cancella il cookie', async () => {
    const agente = await accedi(app, A.admin.email);
    const res = await agente.post('/api/auth/logout');
    assert.equal(res.status, 200);
    assert.match(res.headers['set-cookie'].join(';'), /registro_ore_sessione=;/);
    assert.equal((await agente.get('/api/auth/me')).status, 401);
  });

  it('dopo troppi tentativi falliti blocca anche la password giusta', async () => {
    const appLimitata = nuovaApp(pool, { ...configTest, login: { ...configTest.login, maxFallitiPerEmail: 3 } });
    const prova = (password) =>
      request(appLimitata).post('/api/auth/login').send({ email: A.collaboratore.email, password });
    for (let i = 0; i < 3; i++) assert.equal((await prova('sbagliata')).status, 401);
    assert.equal((await prova('sbagliata')).status, 429);
    assert.equal((await prova(PASSWORD)).status, 429);
    // Le altre email non sono bloccate.
    const altra = await request(appLimitata).post('/api/auth/login').send({ email: A.admin.email, password: PASSWORD });
    assert.equal(altra.status, 200);
  });

  it('i login riusciti non consumano il limite', async () => {
    const appLimitata = nuovaApp(pool, { ...configTest, login: { ...configTest.login, maxFallitiPerEmail: 2 } });
    for (let i = 0; i < 4; i++) {
      const res = await request(appLimitata).post('/api/auth/login').send({ email: A.admin.email, password: PASSWORD });
      assert.equal(res.status, 200);
    }
  });
});
