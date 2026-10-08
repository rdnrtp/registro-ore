// Bacheca: avvisi visibili solo ai destinatari, stato di lettura, modifiche
// visibili, ritiro, notifiche per email, permessi.
// Organizzazione A con due settori:
//   Segreteria (attività "Segreteria") — il collaboratore l'ha tra le sue attività
//   Bagnini    (attività "Bagnino")    — la collega l'ha tra le sue attività;
//                                        Rita è responsabile del settore
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { preparaAmbiente, nuovaApp, accedi, PASSWORD, emailInCoda, trasportoFinto, elabora } = require('./helpers');
const { hashPassword } = require('../src/password');

describe('bacheca', () => {
  let pool, A, B, app, admin, collab, collega, rita, adminB, collabB;
  const avvisi = {};

  before(async () => {
    ({ pool, A, B } = await preparaAmbiente());
    const q = async (sql, params) => (await pool.query(sql, params)).rows[0];
    const hash = await hashPassword(PASSWORD);
    A.settoreBagnini = (await q(`INSERT INTO sectors (organization_id, name) VALUES ($1, 'Bagnini') RETURNING id`, [A.id])).id;
    A.attivitaBagnino = (
      await q(
        `INSERT INTO activities (organization_id, name, template_label, unit, template_row, sort_order)
         VALUES ($1, 'Bagnino', 'Bagnino', 'ore', 5, 3) RETURNING id`,
        [A.id],
      )
    ).id;
    await pool.query('INSERT INTO activity_sectors (organization_id, activity_id, sector_id) VALUES ($1, $2, $3)', [
      A.id,
      A.attivitaBagnino,
      A.settoreBagnini,
    ]);
    const utente = (email, ruolo, nome) =>
      q(
        `INSERT INTO users (organization_id, email, first_name, last_name, role, password_hash)
         VALUES ($1, $2, $3, 'Prova', $4, $5) RETURNING id, email`,
        [A.id, email, nome, ruolo, hash],
      );
    A.collega = await utente('collega@a.test', 'collaboratore', 'Carla');
    A.rita = await utente('rita@a.test', 'responsabile', 'Rita');
    await pool.query('INSERT INTO sector_managers (organization_id, sector_id, user_id) VALUES ($1, $2, $3)', [
      A.id,
      A.settoreBagnini,
      A.rita.id,
    ]);
    app = nuovaApp(pool);
    admin = await accedi(app, A.admin.email);
    collab = await accedi(app, A.collaboratore.email);
    collega = await accedi(app, A.collega.email);
    rita = await accedi(app, A.rita.email);
    adminB = await accedi(app, B.admin.email);
    collabB = await accedi(app, B.collaboratore.email);
    // "Le mie attività" determinano il settore.
    assert.equal((await collab.put('/api/mie-attivita').send({ attivita: [A.attivitaOre] })).status, 200);
    assert.equal((await collega.put('/api/mie-attivita').send({ attivita: [A.attivitaBagnino] })).status, 200);
  });
  after(() => pool.end());

  const pubblica = async (corpo) => {
    const res = await admin.post('/api/avvisi').send(corpo);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body;
  };
  const titoli = async (agente) => (await agente.get('/api/avvisi')).body.avvisi.map((a) => a.titolo);
  const nonLetti = async (agente) => (await agente.get('/api/avvisi/non-letti')).body.non_letti;

  it("l'amministratore pubblica avvisi per tutti o per alcuni settori", async () => {
    avvisi.segreteria = await pubblica({ titolo: 'Turni segreteria', testo: 'Riga uno\nRiga due', per_tutti: false, settori: [A.settore] });
    avvisi.bagnini = await pubblica({ titolo: 'Corso BLSD', testo: 'Per i bagnini', per_tutti: false, settori: [A.settoreBagnini] });
    avvisi.tutti = await pubblica({ titolo: 'Chiusura impianto', testo: 'Il 1° novembre si chiude', per_tutti: true, importante: true });
    assert.equal(avvisi.segreteria.testo, 'Riga uno\nRiga due');
    assert.deepEqual(avvisi.bagnini.nomi_settori, ['Bagnini']);
    assert.equal(avvisi.tutti.importante, true);
    const traccia = await pool.query("SELECT details FROM audit_log WHERE action = 'avviso.pubblicato' ORDER BY created_at");
    assert.deepEqual(traccia.rows.map((r) => r.details.destinatari), [['Segreteria'], ['Bagnini'], ['tutti']]);
  });

  it('gli avvisi sono visibili solo ai destinatari', async () => {
    // Prima gli importanti da leggere, poi dal più recente.
    assert.deepEqual(await titoli(collab), ['Chiusura impianto', 'Turni segreteria']);
    assert.deepEqual(await titoli(collega), ['Chiusura impianto', 'Corso BLSD']);
    // Rita: responsabile dei Bagnini, senza attività.
    assert.deepEqual(await titoli(rita), ['Chiusura impianto', 'Corso BLSD']);
    assert.deepEqual(await titoli(collabB), []);
    for (const [agente, avviso] of [
      [collega, avvisi.segreteria],
      [rita, avvisi.segreteria],
      [collab, avvisi.bagnini],
      [collabB, avvisi.tutti],
      [adminB, avvisi.tutti],
    ]) {
      assert.equal((await agente.get(`/api/avvisi/${avviso.id}`)).status, 404);
      assert.equal((await agente.post(`/api/avvisi/${avviso.id}/letto`)).status, 404);
    }
    // Cambiando "Le mie attività" cambia ciò che si vede.
    await collab.put('/api/mie-attivita').send({ attivita: [A.attivitaOre, A.attivitaBagnino] });
    assert.deepEqual((await titoli(collab)).sort(), ['Chiusura impianto', 'Corso BLSD', 'Turni segreteria']);
    await collab.put('/api/mie-attivita').send({ attivita: [A.attivitaOre] });
  });

  it('alla pubblicazione parte una notifica per email ai soli destinatari, senza il testo', async () => {
    const email = await emailInCoda(pool, A.id, 'avviso');
    const a = (titolo) => email.filter((e) => e.subject.endsWith(titolo)).map((e) => e.to_addresses[0]).sort();
    assert.deepEqual(a('Turni segreteria'), [A.collaboratore.email]);
    assert.deepEqual(a('Corso BLSD'), [A.collega.email, A.rita.email].sort());
    // Tutti tranne l'autore e i disattivati.
    assert.deepEqual(a('Chiusura impianto'), [A.collaboratore.email, A.collega.email, A.rita.email].sort());
    const t = trasportoFinto();
    await elabora(pool, t);
    const m = t.inviate.find((x) => x.subject === 'Avviso importante: Chiusura impianto');
    assert.ok(m.text.includes(`http://app.test/#/bacheca/${avvisi.tutti.id}`));
    assert.ok(!m.text.includes('si chiude'), "il testo dell'avviso si legge nell'app");
    assert.equal(m.from.name, 'Nomeadmin CognomeA tramite Registro ore');
    assert.equal(m.replyTo, undefined);
    assert.deepEqual(await emailInCoda(pool, B.id, 'avviso'), []);
  });

  it('contatore dei non letti; aprire un avviso lo segna come letto', async () => {
    assert.equal(await nonLetti(collab), 2);
    assert.deepEqual((await collab.get('/api/avvisi/non-letti')).body, { non_letti: 2, importanti: 1 });
    // L'autore li ha già letti.
    assert.equal(await nonLetti(admin), 0);
    const dettaglio = await collab.get(`/api/avvisi/${avvisi.tutti.id}`);
    assert.equal(dettaglio.status, 200);
    assert.equal(dettaglio.body.da_leggere, true);
    assert.equal((await collab.post(`/api/avvisi/${avvisi.tutti.id}/letto`)).status, 200);
    assert.equal(await nonLetti(collab), 1);
    const elenco = (await collab.get('/api/avvisi')).body.avvisi;
    assert.equal(elenco.find((x) => x.id === avvisi.tutti.id).da_leggere, false);
    assert.ok(elenco.find((x) => x.id === avvisi.tutti.id).letto_il);
    // Leggere due volte non cambia nulla.
    assert.equal((await collab.post(`/api/avvisi/${avvisi.tutti.id}/letto`)).status, 200);
    assert.equal(await nonLetti(collab), 1);
  });

  it("l'amministratore vede chi l'ha letto e chi no", async () => {
    const res = await admin.get(`/api/avvisi/${avvisi.tutti.id}/letture`);
    assert.equal(res.status, 200);
    const nomi = (l) => l.map((u) => u.nome).sort();
    assert.deepEqual(nomi(res.body.letto), ['Nomeadmin', 'Nomecollab']);
    assert.deepEqual(nomi(res.body.non_letto), ['Carla', 'Rita']);
    const gestione = (await admin.get('/api/avvisi/gestione')).body.avvisi;
    const tutti = gestione.find((x) => x.id === avvisi.tutti.id);
    assert.deepEqual([tutti.destinatari, tutti.letti], [4, 2]);
    assert.equal(gestione.find((x) => x.id === avvisi.bagnini.id).destinatari, 2);
    // L'amministratore apre anche gli avvisi di cui non è destinatario, senza segnarli letti.
    assert.equal((await admin.get(`/api/avvisi/${avvisi.bagnini.id}`)).status, 200);
    assert.equal((await admin.post(`/api/avvisi/${avvisi.bagnini.id}/letto`)).status, 404);
  });

  it('una modifica resta visibile come tale e torna da leggere per chi lo aveva letto', async () => {
    const res = await admin.patch(`/api/avvisi/${avvisi.tutti.id}`).send({ testo: 'Il 2 novembre si chiude' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.modificato_il);
    const dettaglio = (await collab.get(`/api/avvisi/${avvisi.tutti.id}`)).body;
    assert.equal(dettaglio.testo, 'Il 2 novembre si chiude');
    assert.equal(dettaglio.da_leggere, true);
    assert.deepEqual(
      dettaglio.versioni_precedenti.map((v) => [v.titolo, v.testo, v.destinatari]),
      [['Chiusura impianto', 'Il 1° novembre si chiude', ['tutti']]],
    );
    assert.equal(await nonLetti(collab), 2);
    const letture = (await admin.get(`/api/avvisi/${avvisi.tutti.id}/letture`)).body;
    const collabRiga = letture.non_letto.find((u) => u.nome === 'Nomecollab');
    assert.ok(collabRiga.letto_il, 'aveva letto la versione precedente');
    // Una modifica identica non crea versioni; nessuna nuova email.
    const emailPrima = (await emailInCoda(pool, A.id, 'avviso')).length;
    await admin.patch(`/api/avvisi/${avvisi.tutti.id}`).send({ testo: 'Il 2 novembre si chiude' });
    assert.equal((await collab.get(`/api/avvisi/${avvisi.tutti.id}`)).body.versioni_precedenti.length, 1);
    assert.equal((await emailInCoda(pool, A.id, 'avviso')).length, emailPrima);
    // Cambiare i destinatari: da Segreteria a Bagnini.
    await admin.patch(`/api/avvisi/${avvisi.segreteria.id}`).send({ per_tutti: false, settori: [A.settoreBagnini], importante: true });
    assert.ok(!(await titoli(collab)).includes('Turni segreteria'));
    assert.ok((await titoli(collega)).includes('Turni segreteria'));
    const traccia = await pool.query("SELECT details FROM audit_log WHERE action = 'avviso.modificato' ORDER BY created_at");
    assert.equal(traccia.rows.length, 2);
    assert.deepEqual(traccia.rows[1].details.destinatari, { prima: ['Segreteria'], dopo: ['Bagnini'] });
  });

  it('un avviso ritirato sparisce per i destinatari e non si modifica più', async () => {
    const res = await admin.post(`/api/avvisi/${avvisi.bagnini.id}/ritiro`);
    assert.equal(res.status, 200);
    assert.ok(res.body.ritirato_il);
    assert.ok(!(await titoli(collega)).includes('Corso BLSD'));
    assert.equal((await collega.get(`/api/avvisi/${avvisi.bagnini.id}`)).status, 404);
    assert.equal((await collega.post(`/api/avvisi/${avvisi.bagnini.id}/letto`)).status, 404);
    assert.equal((await admin.patch(`/api/avvisi/${avvisi.bagnini.id}`).send({ titolo: 'X' })).status, 409);
    assert.equal((await admin.post(`/api/avvisi/${avvisi.bagnini.id}/ritiro`)).status, 409);
    const gestione = (await admin.get('/api/avvisi/gestione')).body.avvisi;
    assert.ok(gestione.at(-1).ritirato_il, "i ritirati in fondo all'elenco dell'amministratore");
  });

  it('solo l\'amministratore pubblica, modifica, ritira e vede le letture; nessuna risposta', async () => {
    for (const agente of [collab, rita]) {
      assert.equal((await agente.post('/api/avvisi').send({ titolo: 'X', testo: 'Y', per_tutti: true })).status, 403);
      assert.equal((await agente.patch(`/api/avvisi/${avvisi.tutti.id}`).send({ titolo: 'X' })).status, 403);
      assert.equal((await agente.post(`/api/avvisi/${avvisi.tutti.id}/ritiro`)).status, 403);
      assert.equal((await agente.get(`/api/avvisi/${avvisi.tutti.id}/letture`)).status, 403);
      assert.equal((await agente.get('/api/avvisi/gestione')).status, 403);
      assert.equal((await agente.post(`/api/avvisi/${avvisi.tutti.id}/risposte`).send({ testo: 'Ciao' })).status, 404);
    }
    assert.equal((await titoli(collab)).includes('X'), false);
  });

  it('dati non validi', async () => {
    for (const corpo of [
      { titolo: '', testo: 'Y', per_tutti: true },
      { titolo: 'X', testo: '   ', per_tutti: true },
      { titolo: 'X', testo: 'Y' },
      { titolo: 'X', testo: 'Y', per_tutti: false, settori: [] },
      { titolo: 'X', testo: 'Y', per_tutti: false, settori: [B.settore] },
      { titolo: 'X', testo: 'Y', per_tutti: true, importante: 'sì' },
      { titolo: 'X', testo: 'Y'.repeat(5001), per_tutti: true },
    ]) {
      assert.equal((await admin.post('/api/avvisi').send(corpo)).status, 400, JSON.stringify(corpo).slice(0, 80));
    }
    assert.equal((await admin.get('/api/avvisi/123')).status, 404);
    assert.equal((await admin.patch('/api/avvisi/123').send({ titolo: 'X' })).status, 404);
  });

  it("gli avvisi di un'altra organizzazione non si vedono né si toccano", async () => {
    const res = await adminB.post('/api/avvisi').send({ titolo: 'Avviso di B', testo: 'Solo per B', per_tutti: true });
    assert.equal(res.status, 201);
    const idB = res.body.id;
    for (const [metodo, url] of [
      ['get', `/api/avvisi/${idB}`],
      ['post', `/api/avvisi/${idB}/letto`],
      ['get', `/api/avvisi/${idB}/letture`],
      ['patch', `/api/avvisi/${idB}`],
      ['post', `/api/avvisi/${idB}/ritiro`],
    ]) {
      const r = await admin[metodo](url).send({ titolo: 'Preso' });
      assert.equal(r.status, 404, `${metodo} ${url}`);
      assert.deepEqual(r.body, { errore: 'Non trovato' });
    }
    assert.ok(!(await admin.get('/api/avvisi/gestione')).body.avvisi.some((a) => a.id === idB));
    assert.deepEqual(await titoli(collabB), ['Avviso di B']);
    const { rows } = await pool.query('SELECT title, withdrawn_at FROM announcements WHERE id = $1', [idB]);
    assert.deepEqual(rows[0], { title: 'Avviso di B', withdrawn_at: null });
  });
});
