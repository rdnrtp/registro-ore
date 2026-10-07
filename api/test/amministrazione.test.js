// Pagine di gestione dell'amministratore: utenti, attività, settori,
// organizzazione, traccia delle modifiche. Deve restare sempre un amministratore.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { preparaAmbiente, nuovaApp, accedi } = require('./helpers');

async function ultimaVoce(agente, azione) {
  const { voci } = (await agente.get('/api/registro-modifiche')).body;
  return voci.find((v) => v.azione === azione);
}

describe('gestione degli utenti', () => {
  let pool, A, B, app, admin;

  before(async () => {
    ({ pool, A, B } = await preparaAmbiente());
    app = nuovaApp(pool);
    admin = await accedi(app, A.admin.email);
  });
  after(() => pool.end());

  const crea = (dati) => admin.post('/api/utenti').send({ nome: 'Nome', cognome: 'Cognome', ruolo: 'collaboratore', ...dati });

  it('controlla i dati del nuovo utente', async () => {
    const casi = [
      [{ email: 'non-una-email' }, 400, /Email non valida/],
      [{ email: 'ok@a.test', nome: '  ' }, 400, /Nome/],
      [{ email: 'ok@a.test', ruolo: 'superuser' }, 400, /Ruolo non valido/],
      [{ email: A.collaboratore.email.toUpperCase() }, 409, /Esiste già/],
      // L'email è unica in tutto il sistema, anche tra impianti.
      [{ email: B.collaboratore.email }, 409, /Esiste già/],
      [{ email: 'ok@a.test', ruolo: 'responsabile', settori: [B.settore] }, 400, /Settore non trovato/],
      [{ email: 'ok@a.test', ruolo: 'responsabile', settori: ['non-un-id'] }, 400, /Settori non validi/],
    ];
    for (const [dati, stato, messaggio] of casi) {
      const res = await crea(dati);
      assert.equal(res.status, stato, JSON.stringify(dati));
      assert.match(res.body.errore, messaggio);
    }
    const { rows } = await pool.query("SELECT 1 FROM users WHERE email = 'ok@a.test'");
    assert.equal(rows.length, 0);
  });

  it('crea un responsabile con i suoi settori', async () => {
    const res = await crea({ email: 'resp@a.test', ruolo: 'responsabile', settori: [A.settore, A.settore] });
    assert.equal(res.status, 201);
    assert.deepEqual(res.body.utente.settori, [A.settore]);
    // Per gli altri ruoli i settori vengono ignorati.
    const altro = await crea({ email: 'coll2@a.test', ruolo: 'collaboratore', settori: [A.settore] });
    assert.deepEqual(altro.body.utente.settori, []);
    const voce = await ultimaVoce(admin, 'utente.creato');
    assert.equal(voce.dettagli.email, 'coll2@a.test');
  });

  it('cambia anagrafica, email e ruolo, con la traccia', async () => {
    const { body } = await crea({ email: 'da.cambiare@a.test' });
    const id = body.utente.id;
    let res = await admin.patch(`/api/utenti/${id}`).send({ nome: 'Lucia', email: 'Lucia@A.test', ruolo: 'responsabile', settori: [A.settore] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.email, 'lucia@a.test');
    assert.equal(res.body.ruolo, 'responsabile');
    assert.deepEqual(res.body.settori, [A.settore]);
    const ruolo = await ultimaVoce(admin, 'utente.ruolo_cambiato');
    assert.deepEqual(ruolo.dettagli.ruolo, { prima: 'collaboratore', dopo: 'responsabile' });
    const modifica = await ultimaVoce(admin, 'utente.modificato');
    assert.deepEqual(modifica.dettagli.nome, { prima: 'Nome', dopo: 'Lucia' });
    assert.deepEqual(modifica.dettagli.settori, { prima: [], dopo: ['Segreteria'] });

    res = await admin.patch(`/api/utenti/${id}`).send({ email: A.admin.email });
    assert.equal(res.status, 409);
    res = await admin.patch(`/api/utenti/${id}`).send({ attivo: 'no' });
    assert.equal(res.status, 400);
  });

  it('disattivare un utente lo respinge subito, anche se ha una sessione aperta', async () => {
    const collab = await accedi(app, A.collaboratore.email);
    assert.equal((await collab.get('/api/mese/2026/10')).status, 200);
    const res = await admin.patch(`/api/utenti/${A.collaboratore.id}`).send({ attivo: false });
    assert.equal(res.status, 200);
    assert.equal(res.body.attivo, false);
    assert.equal((await collab.get('/api/mese/2026/10')).status, 401);
    assert.equal((await ultimaVoce(admin, 'utente.disattivato')).oggetto_id, A.collaboratore.id);
    // Riattivato, deve rifare l'accesso: la vecchia sessione resta chiusa.
    await admin.patch(`/api/utenti/${A.collaboratore.id}`).send({ attivo: true });
    assert.equal((await collab.get('/api/auth/me')).status, 401);
    assert.equal((await (await accedi(app, A.collaboratore.email)).get('/api/auth/me')).status, 200);
  });

  describe('resta sempre un amministratore attivo', () => {
    it("l'unico amministratore non può togliersi il ruolo né disattivarsi", async () => {
      let res = await admin.patch(`/api/utenti/${A.admin.id}`).send({ ruolo: 'collaboratore' });
      assert.equal(res.status, 409);
      assert.match(res.body.errore, /almeno un amministratore attivo/);
      res = await admin.patch(`/api/utenti/${A.admin.id}`).send({ attivo: false });
      assert.equal(res.status, 409);
      assert.equal((await admin.get('/api/auth/me')).body.utente.ruolo, 'amministratore');
    });

    it('con due amministratori uno può lasciare il ruolo, ma non entrambi', async () => {
      const { body } = await crea({ email: 'admin2@a.test', ruolo: 'amministratore' });
      const id2 = body.utente.id;
      // Il secondo amministratore viene disattivato e poi riattivato.
      assert.equal((await admin.patch(`/api/utenti/${id2}`).send({ attivo: false })).status, 200);
      assert.equal((await admin.patch(`/api/utenti/${A.admin.id}`).send({ ruolo: 'collaboratore' })).status, 409);
      assert.equal((await admin.patch(`/api/utenti/${id2}`).send({ attivo: true })).status, 200);
      // Ora il primo può diventare collaboratore…
      assert.equal((await admin.patch(`/api/utenti/${A.admin.id}`).send({ ruolo: 'collaboratore' })).status, 200);
      // …e da quel momento non è più amministratore.
      assert.equal((await admin.get('/api/utenti')).status, 403);
      await pool.query("UPDATE users SET role = 'amministratore' WHERE id = $1", [A.admin.id]);
      await pool.query("UPDATE users SET role = 'collaboratore' WHERE id = $1", [id2]);
    });

    it('due amministratori che si tolgono il ruolo a vicenda nello stesso istante: ne resta uno', async () => {
      const { body } = await crea({ email: 'admin3@a.test', ruolo: 'amministratore' });
      await pool.query("UPDATE users SET password_hash = (SELECT password_hash FROM users WHERE id = $1) WHERE id = $2", [
        A.admin.id,
        body.utente.id,
      ]);
      const admin3 = await accedi(app, 'admin3@a.test');
      const [r1, r2] = await Promise.all([
        admin.patch(`/api/utenti/${body.utente.id}`).send({ ruolo: 'collaboratore' }),
        admin3.patch(`/api/utenti/${A.admin.id}`).send({ ruolo: 'collaboratore' }),
      ]);
      // Una riesce. L'altra è respinta: 409 se il suo autore era ancora
      // amministratore quando è partita, 403 se aveva già perso il ruolo.
      const stati = [r1.status, r2.status].sort();
      assert.equal(stati[0], 200);
      assert.ok([403, 409].includes(stati[1]), String(stati[1]));
      const { rows } = await pool.query(
        "SELECT count(*)::int AS n FROM users WHERE organization_id = $1 AND role = 'amministratore' AND active",
        [A.id],
      );
      assert.equal(rows[0].n, 1);
      await pool.query("UPDATE users SET role = 'amministratore' WHERE id = $1", [A.admin.id]);
    });
  });
});

describe('configurazione: attività, settori, organizzazione', () => {
  let pool, A, B, app, admin, collab;

  before(async () => {
    ({ pool, A, B } = await preparaAmbiente());
    app = nuovaApp(pool);
    admin = await accedi(app, A.admin.email);
    collab = await accedi(app, A.collaboratore.email);
  });
  after(() => pool.end());

  it("rinomina un'attività, che conserva il nome del modello", async () => {
    const res = await admin.patch(`/api/attivita/${A.attivitaOre}`).send({ nome: '  Ufficio   segreteria ' });
    assert.equal(res.status, 200);
    assert.equal(res.body.nome, 'Ufficio segreteria');
    assert.equal(res.body.nome_modello, 'Segreteria');
    const elenco = (await collab.get('/api/attivita')).body;
    assert.equal(elenco.find((a) => a.id === A.attivitaOre).nome, 'Ufficio segreteria');
    const doppio = await admin.patch(`/api/attivita/${A.attivitaOre}`).send({ nome: 'PT singola' });
    assert.equal(doppio.status, 409);
    const voce = await ultimaVoce(admin, 'attivita.modificata');
    assert.deepEqual(voce.dettagli.nome, { prima: 'Segreteria', dopo: 'Ufficio segreteria' });
  });

  it("disattiva un'attività e ne cambia i settori", async () => {
    let res = await admin.patch(`/api/attivita/${A.attivitaSedute}`).send({ attiva: false, settori: [A.settore] });
    assert.equal(res.status, 200);
    assert.equal(res.body.attiva, false);
    assert.deepEqual(res.body.settori, [A.settore]);
    // Un'attività disattivata non accetta nuove righe.
    const ore = await collab.put('/api/giorni/2026-10-01').send({ voci: [{ attivita_id: A.attivitaSedute, quantita: 1 }] });
    assert.equal(ore.status, 400);
    res = await admin.patch(`/api/attivita/${A.attivitaSedute}`).send({ attiva: true, settori: [] });
    assert.deepEqual(res.body.settori, []);
    res = await admin.patch(`/api/attivita/${A.attivitaSedute}`).send({ settori: [B.settore] });
    assert.equal(res.status, 400);
  });

  it("cambia l'unità solo se le quantità registrate restano valide", async () => {
    await collab.put('/api/giorni/2026-10-02').send({ voci: [{ attivita_id: A.attivitaOre, quantita: 1.5 }] });
    let res = await admin.patch(`/api/attivita/${A.attivitaOre}`).send({ unita: 'sedute' });
    assert.equal(res.status, 409);
    assert.match(res.body.errore, /mezze ore/);
    await collab.put('/api/giorni/2026-10-02').send({ voci: [{ attivita_id: A.attivitaOre, quantita: 2 }] });
    res = await admin.patch(`/api/attivita/${A.attivitaOre}`).send({ unita: 'sedute' });
    assert.equal(res.status, 200);
    assert.equal(res.body.unita, 'sedute');
    // Da sedute a ore: il totale del giorno non deve superare 24.
    await collab.put('/api/giorni/2026-10-03').send({
      voci: [
        { attivita_id: A.attivitaOre, quantita: 20 },
        { attivita_id: A.attivitaSedute, quantita: 1 },
      ],
    });
    await admin.patch(`/api/attivita/${A.attivitaSedute}`).send({ unita: 'ore' });
    await collab.put('/api/giorni/2026-10-03').send({ voci: [{ attivita_id: A.attivitaSedute, quantita: 5 }] });
    res = await admin.patch(`/api/attivita/${A.attivitaOre}`).send({ unita: 'ore' });
    assert.equal(res.status, 409);
    assert.match(res.body.errore, /24 ore/);
    assert.equal((await admin.patch(`/api/attivita/${A.attivitaOre}`).send({ unita: 'chili' })).status, 400);
  });

  it("cambia l'ordine delle attività nell'app", async () => {
    let res = await admin.put('/api/ordine-attivita').send({ attivita: [A.attivitaSedute] });
    assert.equal(res.status, 400);
    res = await admin.put('/api/ordine-attivita').send({ attivita: [A.attivitaSedute, B.attivitaOre] });
    assert.equal(res.status, 400);
    res = await admin.put('/api/ordine-attivita').send({ attivita: [A.attivitaSedute, A.attivitaOre] });
    assert.equal(res.status, 200);
    const elenco = (await collab.get('/api/attivita')).body;
    assert.deepEqual(elenco.map((a) => a.id), [A.attivitaSedute, A.attivitaOre]);
  });

  it('crea, modifica ed elimina un settore', async () => {
    const { body: resp } = await admin
      .post('/api/utenti')
      .send({ nome: 'Rino', cognome: 'Resp', email: 'rino@a.test', ruolo: 'responsabile' });
    let res = await admin.post('/api/settori').send({ nome: 'Bagnini', email_responsabili: ['Capo@A.test'], responsabili: [resp.utente.id] });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const id = res.body.id;
    assert.deepEqual(res.body.email_responsabili, ['capo@a.test']);
    assert.deepEqual(res.body.responsabili, [resp.utente.id]);
    assert.equal((await admin.post('/api/settori').send({ nome: 'Bagnini' })).status, 409);
    assert.equal((await admin.post('/api/settori').send({ nome: 'X', email_responsabili: ['no'] })).status, 400);
    assert.equal((await admin.post('/api/settori').send({ nome: 'X', responsabili: [A.collaboratore.id] })).status, 400);
    assert.equal((await admin.post('/api/settori').send({ nome: 'X', responsabili: [B.admin.id] })).status, 400);

    res = await admin.patch(`/api/settori/${id}`).send({ nome: 'Assistenti bagnanti', email_responsabili: [] });
    assert.equal(res.status, 200);
    assert.equal(res.body.nome, 'Assistenti bagnanti');
    // Il responsabile lo vede tra i suoi settori.
    assert.deepEqual((await admin.get(`/api/utenti/${resp.utente.id}`)).body.settori, [id]);
    const voce = await ultimaVoce(admin, 'settore.modificato');
    assert.deepEqual(voce.dettagli.nome, { prima: 'Bagnini', dopo: 'Assistenti bagnanti' });

    assert.equal((await admin.delete(`/api/settori/${id}`)).status, 200);
    assert.equal((await admin.delete(`/api/settori/${id}`)).status, 404);
    assert.deepEqual((await admin.get(`/api/utenti/${resp.utente.id}`)).body.settori, []);
    assert.equal((await ultimaVoce(admin, 'settore.eliminato')).dettagli.settore, 'Assistenti bagnanti');
  });

  it("cambia l'indirizzo a cui si inviano le ore", async () => {
    assert.equal((await admin.patch('/api/organizzazione').send({ email_invio: 'non valida' })).status, 400);
    const res = await admin.patch('/api/organizzazione').send({ email_invio: 'Segreteria@A.test' });
    assert.equal(res.status, 200);
    assert.equal(res.body.email_invio, 'segreteria@a.test');
    assert.equal((await admin.get('/api/organizzazione')).body.email_invio, 'segreteria@a.test');
    const voce = await ultimaVoce(admin, 'organizzazione.modificata');
    assert.deepEqual(voce.dettagli.email_invio, { prima: null, dopo: 'segreteria@a.test' });
    assert.equal(voce.autore, 'Nomeadmin CognomeA');
  });

  it('la traccia è in ordine dal più recente e si legge a pagine', async () => {
    const { voci } = (await admin.get('/api/registro-modifiche')).body;
    assert.ok(voci.length >= 5);
    const date = voci.map((v) => v.quando);
    assert.deepEqual(date, [...date].sort().reverse());
    const seguenti = (await admin.get('/api/registro-modifiche').query({ salta: 2 })).body.voci;
    assert.deepEqual(seguenti.map((v) => v.id), voci.slice(2).map((v) => v.id));
    assert.equal((await admin.get('/api/registro-modifiche').query({ salta: 'ieri' })).status, 400);
  });
});
