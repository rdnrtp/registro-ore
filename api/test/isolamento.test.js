// Un utente dell'organizzazione A non deve poter leggere dati
// dell'organizzazione B, nemmeno conoscendone gli identificativi.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { preparaAmbiente, nuovaApp, accedi } = require('./helpers');

describe('isolamento tra organizzazioni', () => {
  let pool, A, B, app, adminA, collabA;

  before(async () => {
    ({ pool, A, B } = await preparaAmbiente());
    app = nuovaApp(pool);
    adminA = await accedi(app, A.admin.email);
    collabA = await accedi(app, A.collaboratore.email);
  });
  after(() => pool.end());

  it('gli elenchi contengono solo dati della propria organizzazione', async () => {
    const attivita = (await adminA.get('/api/attivita')).body;
    assert.deepEqual(attivita.map((a) => a.id).sort(), [A.attivitaOre, A.attivitaSedute].sort());
    const settori = (await adminA.get('/api/settori')).body;
    assert.deepEqual(settori.map((s) => s.id), [A.settore]);
    const utenti = (await adminA.get('/api/utenti')).body;
    assert.ok(utenti.length > 0);
    assert.ok(utenti.every((u) => u.email.endsWith('@a.test')));
  });

  it("gli identificativi di B rispondono 404, come se non esistessero", async () => {
    const rotte = [
      `/api/attivita/${B.attivitaOre}`,
      `/api/attivita/${B.attivitaSedute}`,
      `/api/settori/${B.settore}`,
    ];
    for (const agente of [adminA, collabA]) {
      for (const rotta of rotte) {
        const res = await agente.get(rotta);
        assert.equal(res.status, 404, rotta);
        assert.deepEqual(res.body, { errore: 'Non trovato' });
      }
    }
    for (const id of [B.admin.id, B.collaboratore.id]) {
      assert.equal((await adminA.get(`/api/utenti/${id}`)).status, 404);
    }
  });

  it('gli stessi identificativi funzionano per un utente di B', async () => {
    const adminB = await accedi(app, B.admin.email);
    assert.equal((await adminB.get(`/api/attivita/${B.attivitaOre}`)).status, 200);
    assert.equal((await adminB.get(`/api/settori/${B.settore}`)).status, 200);
    assert.equal((await adminB.get(`/api/utenti/${B.collaboratore.id}`)).status, 200);
    assert.equal((await adminB.get(`/api/attivita/${A.attivitaOre}`)).status, 404);
  });

  it("l'organizzazione indicata nella richiesta viene ignorata", async () => {
    const tentativi = [
      adminA.get(`/api/attivita?organization_id=${B.id}&org=${B.id}`),
      adminA.get(`/api/settori?organizzazioneId=${B.id}`),
      adminA.get('/api/utenti').set('X-Organization-Id', B.id),
      adminA.get('/api/auth/me').query({ org: B.id }),
    ];
    const [attivita, settori, utenti, me] = await Promise.all(tentativi);
    assert.ok(attivita.body.every((a) => [A.attivitaOre, A.attivitaSedute].includes(a.id)));
    assert.deepEqual(settori.body.map((s) => s.id), [A.settore]);
    assert.ok(utenti.body.every((u) => u.email.endsWith('@a.test')));
    assert.equal(me.body.organizzazione.id, A.id);
  });

  it('un identificativo non valido risponde 404 e non errore 500', async () => {
    assert.equal((await adminA.get("/api/attivita/1' OR '1'='1")).status, 404);
    assert.equal((await adminA.get('/api/settori/123')).status, 404);
  });

  it('il database rifiuta collegamenti tra organizzazioni diverse', async () => {
    // Attività di A collegata a un settore di B.
    await assert.rejects(
      pool.query('INSERT INTO activity_sectors (organization_id, activity_id, sector_id) VALUES ($1, $2, $3)', [
        A.id,
        A.attivitaOre,
        B.settore,
      ]),
      { code: '23503' },
    );
    // Ore di un utente di A su un'attività di B.
    await assert.rejects(
      pool.query(
        `INSERT INTO time_entries (organization_id, user_id, activity_id, entry_date, quantity)
         VALUES ($1, $2, $3, '2026-10-01', 1)`,
        [A.id, A.collaboratore.id, B.attivitaOre],
      ),
      { code: '23503' },
    );
    // Riga intestata a B ma con un utente di A.
    await assert.rejects(
      pool.query(
        `INSERT INTO pt_sessions (organization_id, user_id, session_date, kind, client_name)
         VALUES ($1, $2, '2026-10-01', 'acqua', 'Cliente')`,
        [B.id, A.collaboratore.id],
      ),
      { code: '23503' },
    );
  });
});
