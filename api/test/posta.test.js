// Posta in uscita: coda, ritentativi, nessun doppio invio, link di invito per email.
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  preparaAmbiente,
  nuovaApp,
  accedi,
  trasportoFinto,
  erroreConnessione,
  erroreRifiuto,
  elabora,
  emailInCoda,
  configTest,
} = require('./helpers');
const { accodaEmail, elaboraCoda, messageId, TESTO_RISERVATO } = require('../src/posta/coda');

describe('posta in uscita', () => {
  let pool, A, B, app, admin, collab, adminB;

  before(async () => {
    ({ pool, A, B } = await preparaAmbiente());
    app = nuovaApp(pool);
    admin = await accedi(app, A.admin.email);
    collab = await accedi(app, A.collaboratore.email);
    adminB = await accedi(app, B.admin.email);
  });
  after(() => pool.end());
  beforeEach(() => pool.query('DELETE FROM email_outbox'));

  const accoda = (oggetto, altro = {}) =>
    accodaEmail(pool, {
      organizzazioneId: A.id,
      tipo: 'prova',
      nomeMittente: 'Prova tramite Registro ore',
      a: ['destinatario@a.test'],
      oggetto,
      testo: 'Testo di prova',
      ...altro,
    });
  const riga = async (id) => (await pool.query('SELECT * FROM email_outbox WHERE id = $1', [id])).rows[0];

  it("l'email parte con mittente, risposta, copia e Message-ID fisso", async () => {
    const id = await accoda('Prova', { cc: ['copia@a.test'], rispondiA: 'collab@a.test' });
    assert.equal((await riga(id)).status, 'in_attesa');
    const t = trasportoFinto();
    assert.deepEqual(await elabora(pool, t), { inviate: 1, rinviate: 0, errori: 0 });
    assert.equal(t.inviate.length, 1);
    const m = t.inviate[0];
    assert.deepEqual(m.from, { name: 'Prova tramite Registro ore', address: 'registro@app.test' });
    assert.deepEqual(m.to, ['destinatario@a.test']);
    assert.deepEqual(m.cc, ['copia@a.test']);
    assert.equal(m.replyTo, 'collab@a.test');
    assert.equal(m.messageId, `<${id}@app.test>`);
    const r = await riga(id);
    assert.equal(r.status, 'inviata');
    assert.ok(r.sent_at);
    // Una volta inviata non riparte più.
    assert.deepEqual(await elabora(pool, t), { inviate: 0, rinviate: 0, errori: 0 });
    assert.equal(t.inviate.length, 1);
  });

  it('dopo un errore temporaneo del server di posta ritenta, con un ritardo', async () => {
    const id = await accoda('Ritenta');
    const t = trasportoFinto();
    t.guasta(erroreConnessione);
    assert.deepEqual(await elabora(pool, t), { inviate: 0, rinviate: 1, errori: 0 });
    let r = await riga(id);
    assert.equal(r.status, 'in_attesa');
    assert.equal(r.attempts, 1);
    assert.match(r.last_error, /ECONNREFUSED/);
    assert.ok(r.next_attempt_at > new Date(), 'il nuovo tentativo è nel futuro');
    // Prima del ritardo non riprova.
    t.guasta(null);
    assert.deepEqual(await elabora(pool, t), { inviate: 0, rinviate: 0, errori: 0 });
    // Passato il ritardo parte, una volta sola.
    await pool.query('UPDATE email_outbox SET next_attempt_at = now() WHERE id = $1', [id]);
    assert.deepEqual(await elabora(pool, t), { inviate: 1, rinviate: 0, errori: 0 });
    r = await riga(id);
    assert.equal(r.status, 'inviata');
    assert.equal(r.attempts, 2);
    assert.equal(r.last_error, null);
    assert.equal(t.inviate.length, 1);
  });

  it('dopo troppi tentativi, o un rifiuto definitivo, va in errore', async () => {
    const t = trasportoFinto();
    t.guasta(erroreConnessione);
    const id = await accoda('Server spento');
    for (let i = 1; i <= configTest.posta.maxTentativi; i++) {
      await pool.query('UPDATE email_outbox SET next_attempt_at = now() WHERE id = $1', [id]);
      await elabora(pool, t);
      assert.equal((await riga(id)).status, i < configTest.posta.maxTentativi ? 'in_attesa' : 'errore');
    }
    const rifiutata = await accoda('Indirizzo inesistente');
    t.guasta(erroreRifiuto);
    assert.deepEqual(await elabora(pool, t), { inviate: 0, rinviate: 0, errori: 1 });
    const r = await riga(rifiutata);
    assert.equal(r.status, 'errore');
    assert.equal(r.attempts, 1);
    assert.match(r.last_error, /550/);
  });

  it('due elaboratori contemporanei non inviano mai la stessa email due volte', async () => {
    const ids = [];
    for (let i = 0; i < 12; i++) ids.push(await accoda(`Email ${i}`));
    const t = trasportoFinto();
    t.ritardoMs = 15;
    const esiti = await Promise.all([elabora(pool, t), elabora(pool, t), elabora(pool, t)]);
    assert.equal(esiti.reduce((n, e) => n + e.inviate, 0), 12);
    const mandati = t.inviate.map((m) => m.messageId).sort();
    assert.deepEqual(mandati, ids.map((id) => messageId(id, 'registro@app.test')).sort());
    assert.equal(new Set(mandati).size, 12);
  });

  it("un invio interrotto (API fermata) non viene ritentato da solo, ma si può riprovare a mano", async () => {
    const id = await accoda('Interrotta');
    await pool.query(
      "UPDATE email_outbox SET status = 'in_invio', attempts = 1, locked_until = now() - interval '1 minute' WHERE id = $1",
      [id],
    );
    const t = trasportoFinto();
    await elabora(pool, t);
    assert.equal(t.inviate.length, 0);
    const r = await riga(id);
    assert.equal(r.status, 'errore');
    assert.match(r.last_error, /interrotto/);

    // L'elenco per l'amministratore mostra lo stato; solo lui può riprovare.
    const elenco = (await admin.get('/api/email')).body.email;
    assert.deepEqual(elenco.map((e) => [e.oggetto, e.stato, e.si_puo_riprovare]), [['Interrotta', 'errore', true]]);
    assert.equal((await admin.get('/api/email?stato=errore')).body.email.length, 1);
    assert.equal((await admin.get('/api/email?stato=inviata')).body.email.length, 0);
    assert.equal((await collab.get('/api/email')).status, 403);
    assert.equal((await collab.post(`/api/email/${id}/riprova`)).status, 403);
    assert.equal((await adminB.post(`/api/email/${id}/riprova`)).status, 404);
    assert.deepEqual((await adminB.get('/api/email')).body.email, []);
    const riprova = await admin.post(`/api/email/${id}/riprova`);
    assert.equal(riprova.status, 200);
    assert.equal((await admin.post(`/api/email/${id}/riprova`)).status, 409);
    await elabora(pool, t);
    assert.equal(t.inviate.length, 1);
    assert.equal((await riga(id)).status, 'inviata');
    const traccia = await pool.query("SELECT details FROM audit_log WHERE action = 'email.riprovata' AND target_id = $1", [id]);
    assert.equal(traccia.rows[0].details.oggetto, 'Interrotta');
  });

  it("senza server di posta configurato le email restano in coda", async () => {
    // creaTrasporto(null) = nessun invio: la coda non viene toccata.
    const { creaTrasporto } = require('../src/posta/trasporto');
    assert.equal(creaTrasporto({ host: null }), null);
    const id = await accoda('In attesa');
    assert.equal((await riga(id)).status, 'in_attesa');
  });

  describe('link di invito per email', () => {
    it("creando un utente il link arriva anche per email, e resta visibile all'amministratore", async () => {
      const res = await admin
        .post('/api/utenti')
        .send({ nome: 'Nuovo', cognome: 'Arrivato', email: 'nuovo@a.test', ruolo: 'collaboratore' });
      assert.equal(res.status, 201);
      assert.match(res.body.invito.codice, /^[A-Za-z0-9_-]{43}$/);
      assert.equal(res.body.invito.email, 'nuovo@a.test');
      const [email] = await emailInCoda(pool, A.id, 'invito');
      assert.deepEqual(email.to_addresses, ['nuovo@a.test']);
      assert.equal(email.user_id, res.body.utente.id);
      assert.ok(email.sensitive);
      const t = trasportoFinto();
      await elabora(pool, t);
      const m = t.inviate[0];
      assert.equal(m.subject, 'Registro ore – Impianto A: il tuo accesso');
      assert.ok(m.text.includes(`http://app.test/#/invito/${res.body.invito.codice}`));
      assert.ok(m.text.includes('http://app.test/#/privacy'));
      assert.match(m.text, /^Ciao Nuovo,/);
      // Dopo l'invio il link non resta nel database.
      const dopo = (await emailInCoda(pool, A.id, 'invito'))[0];
      assert.equal(dopo.body_text, TESTO_RISERVATO);
      const { rows } = await pool.query('SELECT count(*)::int AS n FROM email_outbox WHERE body_text LIKE $1', [
        `%${res.body.invito.codice}%`,
      ]);
      assert.equal(rows[0].n, 0);
      // Un'email con un link non si ritenta a mano: si crea un nuovo link.
      await pool.query("UPDATE email_outbox SET status = 'errore', sent_at = NULL WHERE id = $1", [dopo.id]);
      assert.equal((await admin.post(`/api/email/${dopo.id}/riprova`)).status, 409);
    });

    it('il nuovo link (anche per reimpostare la password) arriva per email', async () => {
      const res = await admin.post(`/api/utenti/${A.collaboratore.id}/invito`);
      assert.equal(res.status, 201);
      assert.equal(res.body.email, A.collaboratore.email);
      const t = trasportoFinto();
      await elabora(pool, t);
      assert.equal(t.inviate.length, 1);
      assert.deepEqual(t.inviate[0].to, [A.collaboratore.email]);
      assert.match(t.inviate[0].subject, /reimpostare la password/);
      assert.ok(t.inviate[0].text.includes(res.body.codice));
    });

    it("se la creazione fallisce non parte nessuna email", async () => {
      const res = await admin.post('/api/utenti').send({ nome: 'X', cognome: 'Y', email: A.collaboratore.email, ruolo: 'collaboratore' });
      assert.equal(res.status, 409);
      assert.deepEqual(await emailInCoda(pool, A.id), []);
    });
  });

  it('elaboraCoda senza email in coda non fa nulla', async () => {
    const t = trasportoFinto();
    assert.deepEqual(await elaboraCoda(pool, { trasporto: t, config: configTest }), { inviate: 0, rinviate: 0, errori: 0 });
  });
});
