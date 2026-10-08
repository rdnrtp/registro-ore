const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { PASSWORD, configTest, preparaAmbiente, nuovaApp, accedi } = require('./helpers');

describe('sessioni: esci ed esci da tutti i dispositivi', () => {
  let pool, A, B, app;

  before(async () => {
    ({ pool, A, B } = await preparaAmbiente());
    app = nuovaApp(pool);
  });
  after(() => pool.end());

  // Login che restituisce il token del cookie, come lo conserverebbe un
  // browser (o chi ne ha fatto una copia).
  async function login(email) {
    const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
    assert.equal(res.status, 200);
    return /registro_ore_sessione=([^;]+)/.exec(res.headers['set-cookie'].join(';'))[1];
  }
  const conToken = (token) => ({
    get: (rotta) => request(app).get(rotta).set('Cookie', `registro_ore_sessione=${token}`),
    post: (rotta) => request(app).post(rotta).set('Cookie', `registro_ore_sessione=${token}`),
  });
  const sessioniDi = async (utenteId) =>
    (await pool.query('SELECT count(*)::int AS n FROM user_sessions WHERE user_id = $1', [utenteId])).rows[0].n;

  it('ogni login registra una sessione e il suo id è nel token', async () => {
    const prima = await sessioniDi(B.collaboratore.id);
    const token = await login(B.collaboratore.email);
    assert.equal(await sessioniDi(B.collaboratore.id), prima + 1);
    const { sid } = jwt.decode(token);
    const { rows } = await pool.query('SELECT user_id FROM user_sessions WHERE id = $1', [sid]);
    assert.equal(rows[0].user_id, B.collaboratore.id);
  });

  it('dopo "Esci" il token non vale più, nemmeno se ne è rimasta una copia', async () => {
    const token = await login(A.collaboratore.email);
    assert.equal((await conToken(token).get('/api/auth/me')).status, 200);
    const uscita = await conToken(token).post('/api/auth/logout');
    assert.equal(uscita.status, 200);
    assert.match(uscita.headers['set-cookie'].join(';'), /registro_ore_sessione=;/);
    // Il PC condiviso ha ancora il vecchio cookie: il server lo rifiuta.
    assert.equal((await conToken(token).get('/api/auth/me')).status, 401);
    assert.equal((await conToken(token).get('/api/mese/2026/10')).status, 401);
    const modifica = await request(app)
      .put('/api/giorni/2026-10-01')
      .set('Cookie', `registro_ore_sessione=${token}`)
      .send({ voci: [{ attivita_id: A.attivitaOre, quantita: 2 }] });
    assert.equal(modifica.status, 401);
  });

  it('"Esci" chiude solo il dispositivo da cui si esce', async () => {
    const telefono = await login(A.collaboratore.email);
    const reception = await login(A.collaboratore.email);
    await conToken(reception).post('/api/auth/logout');
    assert.equal((await conToken(reception).get('/api/auth/me')).status, 401);
    assert.equal((await conToken(telefono).get('/api/auth/me')).status, 200);
  });

  it('"Esci da tutti i dispositivi" chiude ogni sessione dell\'utente, compresa questa', async () => {
    const telefono = await login(A.collaboratore.email);
    const reception = await login(A.collaboratore.email);
    const n = await sessioniDi(A.collaboratore.id);
    const res = await conToken(telefono).post('/api/auth/esci-ovunque');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true, sessioni_chiuse: n });
    assert.match(res.headers['set-cookie'].join(';'), /registro_ore_sessione=;/);
    assert.equal((await conToken(telefono).get('/api/auth/me')).status, 401);
    assert.equal((await conToken(reception).get('/api/auth/me')).status, 401);
    assert.equal(await sessioniDi(A.collaboratore.id), 0);
    // Si può rientrare normalmente.
    assert.equal((await conToken(await login(A.collaboratore.email)).get('/api/auth/me')).status, 200);
  });

  it('"Esci da tutti i dispositivi" non tocca le sessioni degli altri utenti', async () => {
    const admin = await accedi(app, A.admin.email);
    const collega = await accedi(app, B.admin.email);
    await (await accedi(app, A.collaboratore.email)).post('/api/auth/esci-ovunque');
    assert.equal((await admin.get('/api/auth/me')).status, 200);
    assert.equal((await collega.get('/api/auth/me')).status, 200);
  });

  it('"Esci da tutti i dispositivi" richiede un accesso valido', async () => {
    assert.equal((await request(app).post('/api/auth/esci-ovunque')).status, 401);
    const token = await login(A.collaboratore.email);
    await conToken(token).post('/api/auth/logout');
    assert.equal((await conToken(token).post('/api/auth/esci-ovunque')).status, 401);
  });

  it('"Esci" con un token non valido o assente risponde comunque 200', async () => {
    assert.equal((await request(app).post('/api/auth/logout')).status, 200);
    assert.equal((await conToken('non-un-token').post('/api/auth/logout')).status, 200);
    const altroSegreto = jwt.sign({ org: A.id, ver: 0, sid: A.id }, 'un-altro-segreto-lungo-trentadue-caratteri!', {
      subject: A.admin.id,
    });
    assert.equal((await conToken(altroSegreto).post('/api/auth/logout')).status, 200);
  });

  it('un token firmato ma senza sessione (formato precedente) risponde 401', async () => {
    const vecchio = jwt.sign({ org: A.id, ver: 0 }, configTest.jwtSecret, { subject: A.collaboratore.id });
    assert.equal((await conToken(vecchio).get('/api/auth/me')).status, 401);
    const inventata = jwt.sign({ org: A.id, ver: 0, sid: A.id }, configTest.jwtSecret, { subject: A.collaboratore.id });
    assert.equal((await conToken(inventata).get('/api/auth/me')).status, 401);
  });

  it('il token di un utente non apre la sessione di un altro', async () => {
    const { sid } = jwt.decode(await login(A.admin.email));
    // Token ben firmato che abbina la sessione dell'amministratore a un altro utente.
    const misto = jwt.sign({ org: A.id, ver: 0, sid }, configTest.jwtSecret, { subject: A.collaboratore.id });
    assert.equal((await conToken(misto).get('/api/auth/me')).status, 401);
  });

  it('una sessione scaduta nel database non vale, e il login successivo la pulisce', async () => {
    const token = await login(B.collaboratore.email);
    const { sid } = jwt.decode(token);
    await pool.query("UPDATE user_sessions SET expires_at = now() - interval '1 minute' WHERE id = $1", [sid]);
    assert.equal((await conToken(token).get('/api/auth/me')).status, 401);
    await login(B.collaboratore.email);
    const { rows } = await pool.query('SELECT 1 FROM user_sessions WHERE id = $1', [sid]);
    assert.equal(rows.length, 0);
  });

  it("la disattivazione dell'utente cancella le sue sessioni", async () => {
    const token = await login(A.collaboratore.email);
    const admin = await accedi(app, A.admin.email);
    assert.equal((await admin.patch(`/api/utenti/${A.collaboratore.id}`).send({ attivo: false })).status, 200);
    try {
      assert.equal(await sessioniDi(A.collaboratore.id), 0);
      assert.equal((await conToken(token).get('/api/auth/me')).status, 401);
    } finally {
      await pool.query('UPDATE users SET active = true WHERE id = $1', [A.collaboratore.id]);
    }
  });
});
