const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { configTest, preparaAmbiente, nuovaApp, accedi } = require('./helpers');

describe('accesso senza token valido', () => {
  let pool, A, app;

  before(async () => {
    ({ pool, A } = await preparaAmbiente());
    app = nuovaApp(pool);
  });
  after(() => pool.end());

  const rotteProtette = () => [
    '/api/auth/me',
    '/api/attivita',
    `/api/attivita/${A.attivitaOre}`,
    '/api/settori',
    `/api/settori/${A.settore}`,
    '/api/utenti',
    `/api/utenti/${A.admin.id}`,
    '/api/mese/2026/10',
    '/api/mese/2026/10/precompilazione',
    '/api/orario-tipo',
    '/api/mie-attivita',
  ];

  it('senza cookie ogni rotta protetta risponde 401', async () => {
    for (const rotta of rotteProtette()) {
      const res = await request(app).get(rotta);
      assert.equal(res.status, 401, rotta);
    }
  });

  it('senza cookie le rotte di modifica rispondono 401', async () => {
    const tentativi = [
      request(app).put('/api/giorni/2026-10-01').send({ voci: [{ attivita_id: A.attivitaOre, quantita: 1 }] }),
      request(app).post('/api/mese/2026/10/precompilazione'),
      request(app).put('/api/orario-tipo').send({ voci: [] }),
      request(app).put('/api/mie-attivita').send({ attivita: [] }),
      request(app).post('/api/sedute-pt').send({ data: '2026-10-01', tipo: 'acqua', cliente: 'C' }),
      request(app).delete('/api/sedute-pt/00000000-0000-0000-0000-000000000000'),
    ];
    for (const res of await Promise.all(tentativi)) assert.equal(res.status, 401, res.req.path);
  });

  it('il token nell\'header Authorization non viene accettato', async () => {
    const token = jwt.sign({ org: A.id, ruolo: 'amministratore' }, configTest.jwtSecret, { subject: A.admin.id });
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 401);
  });

  const conCookie = (token) => (rotta) => request(app).get(rotta).set('Cookie', `registro_ore_sessione=${token}`);

  it('un token firmato con un altro segreto risponde 401', async () => {
    const falso = jwt.sign({ org: A.id, ruolo: 'amministratore' }, 'un-altro-segreto-lungo-trentadue-caratteri!', {
      subject: A.admin.id,
    });
    for (const rotta of rotteProtette()) assert.equal((await conCookie(falso)(rotta)).status, 401, rotta);
  });

  it('un token scaduto risponde 401', async () => {
    const scaduto = jwt.sign({ org: A.id, ruolo: 'amministratore', exp: Math.floor(Date.now() / 1000) - 60 }, configTest.jwtSecret, {
      subject: A.admin.id,
    });
    assert.equal((await conCookie(scaduto)('/api/auth/me')).status, 401);
  });

  it('un token senza firma (alg none) risponde 401', async () => {
    const nonFirmato = jwt.sign({ org: A.id, ruolo: 'amministratore' }, null, { subject: A.admin.id, algorithm: 'none' });
    assert.equal((await conCookie(nonFirmato)('/api/auth/me')).status, 401);
  });

  it('un token con un ruolo sconosciuto risponde 401', async () => {
    const token = jwt.sign({ org: A.id, ruolo: 'superuser' }, configTest.jwtSecret, { subject: A.admin.id });
    assert.equal((await conCookie(token)('/api/attivita')).status, 401);
  });

  it('un utente disattivato dopo il login perde l\'accesso a /me', async () => {
    const agente = await accedi(app, A.collaboratore.email);
    await pool.query('UPDATE users SET active = false WHERE id = $1', [A.collaboratore.id]);
    try {
      assert.equal((await agente.get('/api/auth/me')).status, 401);
    } finally {
      await pool.query('UPDATE users SET active = true WHERE id = $1', [A.collaboratore.id]);
    }
  });
});

describe('ruoli', () => {
  let pool, A, app;

  before(async () => {
    ({ pool, A } = await preparaAmbiente());
    app = nuovaApp(pool);
  });
  after(() => pool.end());

  it('il collaboratore non può elencare gli utenti', async () => {
    const agente = await accedi(app, A.collaboratore.email);
    assert.equal((await agente.get('/api/utenti')).status, 403);
    assert.equal((await agente.get(`/api/utenti/${A.admin.id}`)).status, 403);
  });

  it("l'amministratore può elencare gli utenti", async () => {
    const agente = await accedi(app, A.admin.email);
    const res = await agente.get('/api/utenti');
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 3);
    assert.ok(res.body.every((u) => !('password_hash' in u)));
  });

  it('le email dei responsabili sono visibili solo all\'amministratore', async () => {
    const admin = await accedi(app, A.admin.email);
    const collab = await accedi(app, A.collaboratore.email);
    assert.deepEqual((await admin.get('/api/settori')).body[0].email_responsabili, ['resp@a.test']);
    assert.equal('email_responsabili' in (await collab.get('/api/settori')).body[0], false);
  });
});
