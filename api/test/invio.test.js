// Invio del mese alla segreteria, sul modello reale di BV: destinatari e
// copie, blocco del mese, file salvato, nessun doppio invio, ritentativi,
// riapertura e reinvio come sostituzione.
// Servono il modello (MODELLO_BV) e la configurazione di BV (SEED_DIR).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { preparaAmbiente, nuovaApp, accedi, PASSWORD, trasportoFinto, erroreConnessione, elabora, emailInCoda } = require('./helpers');
const { hashPassword } = require('../src/password');
const { caricaOrganizzazione, leggiJson } = require('../src/cli/carica-organizzazione');
const { messageId } = require('../src/posta/coda');

const MODELLO_BV = process.env.MODELLO_BV;
const SEED_BV = path.join(process.env.SEED_DIR ?? path.join(__dirname, '..', '..', 'seed'), 'bv');
if (!MODELLO_BV || !fs.existsSync(MODELLO_BV)) {
  throw new Error(`Modello Excel di BV non trovato (MODELLO_BV=${MODELLO_BV}): i test dell'invio lo richiedono`);
}

const caricaBv = (pool, slug) =>
  caricaOrganizzazione(pool, {
    conf: { ...leggiJson(path.join(SEED_BV, 'organizzazione.json')), slug, nome: slug.toUpperCase() },
    contatti: { emailInvio: `segreteria@${slug}.test`, responsabili: {} },
    abbinamenti: leggiJson(path.join(SEED_BV, 'abbinamenti.json')),
    modello: { buffer: fs.readFileSync(MODELLO_BV), nomeFile: 'modello_bv.xlsx' },
  });

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

// Scarica un file; il corpo è sempre un Buffer.
const scarica = (agente, url) =>
  agente
    .get(url)
    .buffer(true)
    .parse((res, fine) => {
      const parti = [];
      res.on('data', (d) => parti.push(d));
      res.on('end', () => fine(null, Buffer.concat(parti)));
    });

describe('invio del mese', () => {
  let pool, app, bv, bv2, attivita, utenti, agenti;

  before(async () => {
    ({ pool } = await preparaAmbiente());
    bv = await caricaBv(pool, 'bv');
    bv2 = await caricaBv(pool, 'bv2');
    const hash = await hashPassword(PASSWORD);
    const crea = async (orgId, email, nome, cognome, ruolo = 'collaboratore') =>
      (
        await pool.query(
          `INSERT INTO users (organization_id, email, first_name, last_name, role, password_hash)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [orgId, email, nome, cognome, ruolo, hash],
        )
      ).rows[0].id;
    utenti = {
      petris: await crea(bv.orgId, 'petris@bv.test', 'Andrea', 'Petris'),
      desantis: await crea(bv.orgId, 'desantis@bv.test', 'Giulia', 'De Santis'),
      admin: await crea(bv.orgId, 'admin@bv.test', 'Anna', 'Amministra', 'amministratore'),
      capo: await crea(bv.orgId, 'capo@bv.test', 'Carlo', 'Capo', 'responsabile'),
      rossi: await crea(bv2.orgId, 'rossi@bv2.test', 'Mario', 'Rossi'),
      admin2: await crea(bv2.orgId, 'admin@bv2.test', 'Bruno', 'Altro', 'amministratore'),
    };
    // "Email del settore" (quelle che vanno in copia). Le maiuscole non contano.
    const settori = Object.fromEntries(
      (await pool.query('SELECT id, name FROM sectors WHERE organization_id = $1', [bv.orgId])).rows.map((r) => [r.name, r.id]),
    );
    const email = {
      Segreteria: ['resp.segreteria@bv.test'],
      Bagnini: ['resp.bagnini@bv.test', 'vice.bagnini@bv.test'],
      'Corsi acqua e palestra': ['RESP.Corsi@bv.test', 'resp.segreteria@bv.test'],
      'Sala pesi': ['resp.salapesi@bv.test'],
    };
    for (const [nome, indirizzi] of Object.entries(email)) {
      await pool.query('UPDATE sectors SET manager_emails = $2 WHERE id = $1', [settori[nome], indirizzi]);
    }
    // Un responsabile "nell'app" non determina la copia.
    await pool.query('INSERT INTO sector_managers (organization_id, sector_id, user_id) VALUES ($1, $2, $3), ($1, $4, $3)', [
      bv.orgId,
      settori.Segreteria,
      utenti.capo,
      settori['Sala pesi'],
    ]);
    attivita = Object.fromEntries(
      (await pool.query('SELECT id, name FROM activities WHERE organization_id = $1', [bv.orgId])).rows.map((r) => [r.name, r.id]),
    );
    app = nuovaApp(pool);
    agenti = {
      petris: await accedi(app, 'petris@bv.test'),
      desantis: await accedi(app, 'desantis@bv.test'),
      admin: await accedi(app, 'admin@bv.test'),
      capo: await accedi(app, 'capo@bv.test'),
      rossi: await accedi(app, 'rossi@bv2.test'),
      admin2: await accedi(app, 'admin@bv2.test'),
    };
    const salva = async (agente, data, voci) => {
      const res = await agente
        .put(`/api/giorni/${data}`)
        .send({ voci: Object.entries(voci).map(([nome, quantita]) => ({ attivita_id: attivita[nome], quantita })) });
      assert.equal(res.status, 200, JSON.stringify(res.body));
    };
    // Settembre 2026: Segreteria, Bagnino, una seduta di PT in acqua. Ottobre:
    // Sala pesi (non deve finire nella copia di settembre).
    await salva(agenti.petris, '2026-09-01', { Segreteria: 4 });
    await salva(agenti.petris, '2026-09-02', { Bagnino: 3.5 });
    await salva(agenti.petris, '2026-09-03', { 'PT H2O singola': 1 });
    await salva(agenti.petris, '2026-10-01', { 'Sala pesi': 2 });
    await agenti.petris.post('/api/sedute-pt').send({ data: '2026-09-03', tipo: 'acqua', cliente: 'Cliente Riservato' });
    // Un mese di bv2, inviato, per le prove di isolamento.
    await pool.query("UPDATE organizations SET submission_email = 'segreteria@bv2.test' WHERE id = $1", [bv2.orgId]);
    assert.equal((await agenti.rossi.post('/api/mese/2026/9/invio')).status, 201);
  });
  after(() => pool.end());

  const copiaAttesa = ['petris@bv.test', 'resp.bagnini@bv.test', 'resp.corsi@bv.test', 'resp.segreteria@bv.test', 'vice.bagnini@bv.test'];

  it('il riepilogo prima dell\'invio: totali, nome del file, destinatario e copie dalle attività del mese', async () => {
    const res = await agenti.petris.get('/api/mese/2026/9/invio');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const r = res.body;
    assert.equal(r.stato, 'aperto');
    assert.equal(r.destinatario, 'segreteria@bv.test');
    // Settori di Segreteria, Bagnino e PT H2O singola; non Sala pesi (solo a
    // ottobre), non il responsabile "nell'app"; senza doppioni, in minuscolo.
    assert.deepEqual(r.copia, copiaAttesa);
    assert.deepEqual(r.totali, { ore: 7.5, sedute: 1, sedute_pt: 1 });
    assert.match(r.nome_file, /^09_.+_2026_Petris\.xlsx$/);
    assert.deepEqual(r.sostituisce, null);
    assert.equal(r.avvisi.vuoto, false);

    // Mese vuoto: solo l'utente in copia, avviso "vuoto".
    const vuoto = (await agenti.desantis.get('/api/mese/2026/9/invio')).body;
    assert.deepEqual(vuoto.copia, ['desantis@bv.test']);
    assert.equal(vuoto.avvisi.vuoto, true);
    // Mese non ancora finito.
    const futuro = (await agenti.petris.get('/api/mese/2099/12/invio')).body;
    assert.equal(futuro.avvisi.mese_non_finito, true);
    assert.equal(futuro.avvisi.mese_futuro, true);
    assert.equal((await agenti.petris.get('/api/mese/1999/1/invio')).status, 400);
  });

  it("invia: salva il file con destinatari e ora, blocca il mese e mette in coda un'email", async () => {
    const res = await agenti.petris.post('/api/mese/2026/9/invio');
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.stato, 'inviato');
    assert.equal(res.body.invii.length, 1);
    const v = res.body.invii[0];
    assert.equal(v.versione, 1);
    assert.equal(v.destinatario, 'segreteria@bv.test');
    assert.deepEqual(v.copia, copiaAttesa);
    assert.equal(v.email.stato, 'in_attesa');
    assert.ok(v.inviato_il);

    // Il collaboratore vede stato e data nel proprio mese.
    const mese = (await agenti.petris.get('/api/mese/2026/9')).body;
    assert.equal(mese.stato, 'inviato');
    assert.equal(mese.invii[0].inviato_il, v.inviato_il);

    const [email] = await emailInCoda(pool, bv.orgId, 'invio_mese');
    assert.deepEqual(email.to_addresses, ['segreteria@bv.test']);
    assert.deepEqual(email.cc_addresses, copiaAttesa);
    assert.equal(email.reply_to, 'petris@bv.test');
    assert.equal(email.from_name, 'Andrea Petris tramite Registro ore');
    assert.equal(email.subject, 'Ore di settembre 2026 – Andrea Petris');
    // Minimo di dati personali: niente ore giorno per giorno, niente clienti.
    assert.doesNotMatch(email.body_text, /Cliente Riservato|7,5|3,5/);

    // Sola lettura.
    const voce = [{ attivita_id: attivita.Segreteria, quantita: 1 }];
    assert.equal((await agenti.petris.put('/api/giorni/2026-09-10').send({ voci: voce })).status, 409);
    assert.equal((await agenti.petris.post('/api/sedute-pt').send({ data: '2026-09-10', tipo: 'acqua', cliente: 'X' })).status, 409);
    assert.equal((await agenti.petris.post('/api/mese/2026/9/precompilazione')).status, 409);
    // Ottobre resta modificabile.
    assert.equal((await agenti.petris.put('/api/giorni/2026-10-10').send({ voci: voce })).status, 200);
  });

  it('nessun doppio invio, nemmeno con due richieste contemporanee', async () => {
    assert.equal((await agenti.petris.post('/api/mese/2026/9/invio')).status, 409);
    const [a, b] = await Promise.all([agenti.desantis.post('/api/mese/2026/9/invio'), agenti.desantis.post('/api/mese/2026/9/invio')]);
    assert.deepEqual([a.status, b.status].sort(), [201, 409]);
    const { rows } = await pool.query(
      `SELECT (SELECT count(*)::int FROM month_submission_versions WHERE user_id = $1) AS versioni,
              (SELECT count(*)::int FROM email_outbox WHERE user_id = $1 AND kind = 'invio_mese') AS email`,
      [utenti.desantis],
    );
    assert.deepEqual(rows[0], { versioni: 1, email: 1 });
    assert.equal((await emailInCoda(pool, bv.orgId, 'invio_mese')).length, 2);
  });

  it("dopo un errore del server di posta l'email del mese viene ritentata e parte una volta sola", async () => {
    const t = trasportoFinto();
    t.guasta(erroreConnessione);
    await elabora(pool, t);
    let mese = (await agenti.petris.get('/api/mese/2026/9')).body;
    assert.equal(mese.invii[0].email.stato, 'in_attesa');
    assert.match(mese.invii[0].email.errore, /ECONNREFUSED/);

    t.guasta(null);
    await pool.query("UPDATE email_outbox SET next_attempt_at = now() WHERE status = 'in_attesa'");
    await elabora(pool, t);
    await elabora(pool, t);
    const delMese = t.inviate.filter((m) => m.subject.startsWith('Ore di settembre 2026') && m.replyTo.endsWith('@bv.test'));
    assert.equal(delMese.length, 2); // Petris e De Santis, una volta ciascuno
    const m = delMese.find((x) => x.replyTo === 'petris@bv.test');
    assert.deepEqual(m.to, ['segreteria@bv.test']);
    assert.deepEqual(m.cc, copiaAttesa);
    const versione = (await pool.query('SELECT file, file_name FROM month_submission_versions WHERE user_id = $1', [utenti.petris])).rows[0];
    assert.equal(m.attachments[0].filename, versione.file_name);
    assert.ok(Buffer.compare(m.attachments[0].content, versione.file) === 0, "l'allegato è il file salvato");
    mese = (await agenti.petris.get('/api/mese/2026/9')).body;
    assert.equal(mese.invii[0].email.stato, 'inviata');
  });

  it('lo scaricamento di un mese inviato restituisce il file salvato, identico', async () => {
    const { rows } = await pool.query('SELECT file, file_name, file_sha256 FROM month_submission_versions WHERE user_id = $1', [
      utenti.petris,
    ]);
    assert.equal(sha(rows[0].file), rows[0].file_sha256);
    // Cambiamenti che modificherebbero un file rigenerato: il cognome.
    assert.equal((await agenti.admin.patch(`/api/utenti/${utenti.petris}`).send({ cognome: 'Petris Nuovo' })).status, 200);
    for (const [agente, url] of [
      [agenti.petris, '/api/mese/2026/9/excel'],
      [agenti.petris, '/api/mese/2026/9/invii/1/file'],
      [agenti.admin, `/api/collaboratori/${utenti.petris}/mese/2026/9/excel`],
      [agenti.admin, `/api/collaboratori/${utenti.petris}/mese/2026/9/invii/1/file`],
    ]) {
      const res = await scarica(agente, url);
      assert.equal(res.status, 200, url);
      assert.equal(sha(res.body), rows[0].file_sha256, url);
      assert.ok(res.headers['content-disposition'].includes(rows[0].file_name), url);
    }
    // Il database non permette di cambiare un file inviato.
    await assert.rejects(pool.query("UPDATE month_submission_versions SET file = '\\x00' WHERE user_id = $1", [utenti.petris]), {
      code: '23514',
    });
    // Un mese aperto invece si rigenera ogni volta (con il nuovo cognome).
    const ottobre = await scarica(agenti.petris, '/api/mese/2026/10/excel');
    assert.match(ottobre.headers['content-disposition'], /Petris_Nuovo/);
    await agenti.admin.patch(`/api/utenti/${utenti.petris}`).send({ cognome: 'Petris' });
  });

  it("solo l'amministratore riapre un mese, con una motivazione che finisce nel registro", async () => {
    const url = `/api/collaboratori/${utenti.petris}/mese/2026/9/riapertura`;
    const motivazione = 'Mancano le ore del 15 settembre';
    assert.equal((await agenti.petris.post(url).send({ motivazione })).status, 403);
    assert.equal((await agenti.capo.post(url).send({ motivazione })).status, 403);
    assert.equal((await agenti.admin2.post(url).send({ motivazione })).status, 404);
    assert.equal((await agenti.admin.post(url).send({})).status, 400);
    assert.equal((await agenti.admin.post(url).send({ motivazione: '   ' })).status, 400);
    assert.equal((await agenti.petris.get('/api/mese/2026/9')).body.stato, 'inviato');

    const res = await agenti.admin.post(url).send({ motivazione });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.stato, 'aperto');
    assert.equal(res.body.invii[0].motivazione, motivazione);
    assert.equal(res.body.invii[0].riaperto_da, 'Anna Amministra');
    assert.equal((await agenti.admin.post(url).send({ motivazione })).status, 409);

    const traccia = await pool.query("SELECT actor_id, details FROM audit_log WHERE action = 'mese.riaperto'");
    assert.equal(traccia.rows.length, 1);
    assert.equal(traccia.rows[0].actor_id, utenti.admin);
    assert.equal(traccia.rows[0].details.motivazione, motivazione);
    assert.equal(traccia.rows[0].details.versione, 1);
    // Il collaboratore riceve una notifica con la motivazione.
    const [notifica] = await emailInCoda(pool, bv.orgId, 'riapertura');
    assert.deepEqual(notifica.to_addresses, ['petris@bv.test']);
    assert.ok(notifica.body_text.includes(motivazione));

    // Ora può correggere.
    const correzione = await agenti.petris.put('/api/giorni/2026-09-15').send({ voci: [{ attivita_id: attivita.Segreteria, quantita: 2 }] });
    assert.equal(correzione.status, 200);
    // Il file scaricato ora è quello rigenerato, non più quello inviato.
    const { rows } = await pool.query('SELECT file_sha256 FROM month_submission_versions WHERE user_id = $1', [utenti.petris]);
    assert.notEqual(sha((await scarica(agenti.petris, '/api/mese/2026/9/excel')).body), rows[0].file_sha256);
  });

  it("il reinvio sostituisce il precedente, lo dice nell'email e conserva tutte le versioni", async () => {
    const riepilogo = (await agenti.petris.get('/api/mese/2026/9/invio')).body;
    assert.equal(riepilogo.sostituisce.versione, 1);
    assert.deepEqual(riepilogo.totali, { ore: 9.5, sedute: 1, sedute_pt: 1 });

    const res = await agenti.petris.post('/api/mese/2026/9/invio');
    assert.equal(res.status, 201);
    assert.deepEqual(res.body.invii.map((v) => v.versione), [2, 1]);
    assert.equal(res.body.invii[0].riaperto_il, null);
    assert.ok(res.body.invii[1].riaperto_il);
    assert.equal(res.body.invii[0].ore, 9.5);
    assert.equal(res.body.invii[1].ore, 7.5);

    const email = (await emailInCoda(pool, bv.orgId, 'invio_mese')).filter((e) => e.user_id === utenti.petris);
    assert.equal(email.length, 2);
    assert.match(email[1].subject, /^SOSTITUISCE IL PRECEDENTE – Ore di settembre 2026 – Andrea Petris$/);
    assert.match(email[1].body_text, /\(versione 2\) SOSTITUISCE quello del \d{1,2} \S+ \d{4} alle ore \d{2}:\d{2}\./);
    assert.match(email[1].body_text, /non è più valido/);
    assert.equal(email[1].references_id, email[0].id);

    const t = trasportoFinto();
    await elabora(pool, t);
    const m = t.inviate.find((x) => x.subject.startsWith('SOSTITUISCE'));
    assert.equal(m.inReplyTo, messageId(email[0].id, 'registro@app.test'));

    // Entrambe le versioni restano, con il loro file.
    const v1 = await scarica(agenti.petris, '/api/mese/2026/9/invii/1/file');
    const v2 = await scarica(agenti.petris, '/api/mese/2026/9/invii/2/file');
    assert.notEqual(sha(v1.body), sha(v2.body));
    assert.equal(sha((await scarica(agenti.petris, '/api/mese/2026/9/excel')).body), sha(v2.body));
    assert.equal((await agenti.petris.get('/api/mese/2026/9/invii/3/file')).status, 404);
    assert.equal((await agenti.petris.get('/api/mese/2026/9/invii/abc/file')).status, 404);
  });

  it('versioni e destinatari li vede solo l\'amministratore; nessuno vede quelli di un altro impianto', async () => {
    const admin = (await agenti.admin.get(`/api/collaboratori/${utenti.petris}/mese/2026/9`)).body;
    assert.deepEqual(admin.invii.map((v) => v.versione), [2, 1]);
    assert.equal(admin.stato, 'inviato');
    assert.ok(admin.inviato_il);
    const capo = (await agenti.capo.get(`/api/collaboratori/${utenti.petris}/mese/2026/9`)).body;
    assert.equal(capo.invii, null);
    assert.equal(capo.stato, 'inviato');
    assert.equal((await agenti.capo.get(`/api/collaboratori/${utenti.petris}/mese/2026/9/invii/1/file`)).status, 403);
    // Il collaboratore non scarica le versioni di un altro: la rotta usa sempre il suo mese.
    assert.equal((await agenti.desantis.get('/api/mese/2026/9/invii/2/file')).status, 404);
    // Altro impianto: 404 come se non esistesse.
    for (const url of [
      `/api/collaboratori/${utenti.rossi}/mese/2026/9`,
      `/api/collaboratori/${utenti.rossi}/mese/2026/9/excel`,
      `/api/collaboratori/${utenti.rossi}/mese/2026/9/invii/1/file`,
    ]) {
      assert.equal((await agenti.admin.get(url)).status, 404, url);
    }
    for (const azione of ['riapertura', 'sollecito']) {
      const res = await agenti.admin.post(`/api/collaboratori/${utenti.rossi}/mese/2026/9/${azione}`).send({ motivazione: 'x' });
      assert.equal(res.status, 404, azione);
    }
    assert.equal((await agenti.rossi.get('/api/mese/2026/9')).body.stato, 'inviato');
    // Nelle copie dell'invio di bv2 non c'è nessuno di bv.
    const [e2] = await emailInCoda(pool, bv2.orgId, 'invio_mese');
    assert.deepEqual(e2.cc_addresses, ['rossi@bv2.test']);
  });

  it("senza indirizzo della segreteria l'invio è rifiutato e il mese resta aperto", async () => {
    await pool.query('UPDATE organizations SET submission_email = NULL WHERE id = $1', [bv.orgId]);
    try {
      const res = await agenti.petris.post('/api/mese/2026/8/invio');
      assert.equal(res.status, 409);
      assert.match(res.body.errore, /indirizzo della segreteria/);
      assert.equal((await agenti.petris.get('/api/mese/2026/8')).body.stato, 'aperto');
    } finally {
      await pool.query("UPDATE organizations SET submission_email = 'segreteria@bv.test' WHERE id = $1", [bv.orgId]);
    }
  });
});
