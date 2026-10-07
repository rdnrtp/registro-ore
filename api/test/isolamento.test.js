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

  it("registrazioni e sedute: gli identificativi di B rispondono 404", async () => {
    const collabB = await accedi(app, B.collaboratore.email);
    const sedutaB = await collabB.post('/api/sedute-pt').send({ data: '2026-10-02', tipo: 'acqua', cliente: 'Cliente B' });
    assert.equal(sedutaB.status, 201);
    for (const agente of [adminA, collabA]) {
      const elimina = await agente.delete(`/api/sedute-pt/${sedutaB.body.id}`);
      assert.equal(elimina.status, 404);
      assert.deepEqual(elimina.body, { errore: 'Non trovato' });
      const ore = await agente.put('/api/giorni/2026-10-02').send({ voci: [{ attivita_id: B.attivitaOre, quantita: 1 }] });
      assert.equal(ore.status, 404);
      const orario = await agente
        .put('/api/orario-tipo')
        .send({ voci: [{ giorno_settimana: 1, attivita_id: B.attivitaOre, quantita: 1 }] });
      assert.equal(orario.status, 404);
      assert.equal((await agente.put('/api/mie-attivita').send({ attivita: [B.attivitaSedute] })).status, 404);
      assert.equal((await agente.delete('/api/sedute-pt/123')).status, 404);
    }
    const meseB = (await collabB.get('/api/mese/2026/10')).body;
    assert.equal(meseB.sedute_pt.length, 1);
    assert.deepEqual((await collabA.get('/api/mese/2026/10')).body.sedute_pt, []);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM time_entries');
    assert.equal(rows[0].n, 0);
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

  it('rotte della Fase 4: gli identificativi di B rispondono 404 e B non cambia', async () => {
    const collabB = await accedi(app, B.collaboratore.email);
    await collabB.put('/api/giorni/2026-10-02').send({ voci: [{ attivita_id: B.attivitaOre, quantita: 3 }] });
    const sedutaB = (await collabB.post('/api/sedute-pt').send({ data: '2026-10-03', tipo: 'acqua', cliente: 'Cliente B' })).body;
    const fotografia = async () =>
      (
        await pool.query(
          `SELECT (SELECT json_agg(u ORDER BY id) FROM users u WHERE organization_id = $1) AS utenti,
                  (SELECT json_agg(a ORDER BY id) FROM activities a WHERE organization_id = $1) AS attivita,
                  (SELECT json_agg(s ORDER BY id) FROM sectors s WHERE organization_id = $1) AS settori,
                  (SELECT json_agg(m ORDER BY user_id) FROM sector_managers m WHERE organization_id = $1) AS responsabili,
                  (SELECT json_agg(p ORDER BY id) FROM pt_sessions p WHERE organization_id = $1) AS sedute,
                  (SELECT json_agg(i ORDER BY id) FROM user_invites i WHERE organization_id = $1) AS inviti,
                  (SELECT row_to_json(o) FROM organizations o WHERE id = $1) AS organizzazione`,
          [B.id],
        )
      ).rows[0];
    const prima = await fotografia();
    const tentativi = [
      ['get', `/api/utenti/${B.collaboratore.id}`],
      ['patch', `/api/utenti/${B.collaboratore.id}`, { attivo: false, ruolo: 'amministratore' }],
      ['patch', `/api/utenti/${B.admin.id}`, { attivo: false }],
      ['post', `/api/utenti/${B.collaboratore.id}/invito`],
      ['patch', `/api/attivita/${B.attivitaOre}`, { nome: 'Presa', attiva: false }],
      ['patch', `/api/settori/${B.settore}`, { nome: 'Preso' }],
      ['delete', `/api/settori/${B.settore}`],
      ['get', `/api/collaboratori/${B.collaboratore.id}/mese/2026/10`],
      ['get', `/api/collaboratori/${B.collaboratore.id}/mese/2026/10/excel`],
      ['put', `/api/sedute-pt/${sedutaB.id}`, { data: '2026-10-04', tipo: 'palestra', cliente: 'Preso' }],
    ];
    for (const [metodo, rotta, corpo] of tentativi) {
      const res = await adminA[metodo](rotta).send(corpo ?? {});
      assert.equal(res.status, 404, `${metodo} ${rotta}`);
      assert.deepEqual(res.body, { errore: 'Non trovato' });
    }
    // Riferimenti a B dentro richieste valide: rifiutati come dati non validi.
    const conRiferimenti = [
      adminA.post('/api/utenti').send({ nome: 'X', cognome: 'Y', email: 'x@a.test', ruolo: 'responsabile', settori: [B.settore] }),
      adminA.post('/api/settori').send({ nome: 'Nuovo', responsabili: [B.admin.id] }),
      adminA.patch(`/api/settori/${A.settore}`).send({ responsabili: [B.admin.id] }),
      adminA.patch(`/api/attivita/${A.attivitaOre}`).send({ settori: [B.settore] }),
      adminA.put('/api/ordine-attivita').send({ attivita: [A.attivitaOre, A.attivitaSedute, B.attivitaOre] }),
    ];
    for (const res of await Promise.all(conRiferimenti)) assert.equal(res.status, 400, `${res.req.method} ${res.req.path}`);

    // Gli elenchi contengono solo A.
    const elenco = (await adminA.get('/api/collaboratori/2026/10')).body.collaboratori;
    assert.ok(elenco.length > 0);
    assert.ok(elenco.every((c) => [A.admin.id, A.collaboratore.id].includes(c.id)));
    await adminA.patch('/api/organizzazione').send({ email_invio: 'segreteria@a.test' });
    assert.equal((await adminA.get('/api/organizzazione')).body.nome, 'Impianto A');
    const traccia = (await adminA.get('/api/registro-modifiche')).body.voci;
    assert.ok(traccia.length > 0);
    const adminB = await accedi(app, B.admin.email);
    assert.deepEqual((await adminB.get('/api/registro-modifiche')).body.voci, []);
    assert.deepEqual((await adminA.get('/api/modello')).body.versioni, []);

    assert.deepEqual(await fotografia(), prima);
  });

  it('un identificativo non valido risponde 404 e non errore 500', async () => {
    assert.equal((await adminA.get("/api/attivita/1' OR '1'='1")).status, 404);
    assert.equal((await adminA.get('/api/settori/123')).status, 404);
    for (const rotta of ['/api/utenti/123', '/api/collaboratori/123/mese/2026/10', '/api/collaboratori/123/mese/2026/10/excel']) {
      assert.equal((await adminA.get(rotta)).status, 404, rotta);
    }
    assert.equal((await adminA.patch('/api/attivita/123').send({ nome: 'X' })).status, 404);
    assert.equal((await adminA.patch('/api/settori/123').send({ nome: 'X' })).status, 404);
    assert.equal((await adminA.put('/api/sedute-pt/123').send({ data: '2026-10-01', tipo: 'acqua', cliente: 'X' })).status, 404);
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
