// Notifiche push: attivazione e disattivazione per dispositivo, scelta tra
// push ed email, fascia di silenzio (22–7), dispositivi non più validi,
// nessuna notifica all'autore, permessi e isolamento tra organizzazioni.
// Il servizio push è finto (servizioPushFinto): nessuna push esce davvero.
const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const {
  preparaAmbiente,
  nuovaApp,
  accedi,
  configTest,
  PASSWORD,
  emailInCoda,
  servizioPushFinto,
  elaboraPush,
  iscriviDispositivo,
} = require('./helpers');
const { hashPassword } = require('../src/password');
const { eseguiPromemoria } = require('../src/promemoria');
const { fuoriDalSilenzio, inSilenzio } = require('../src/tempo');

// Istante sicuramente dopo ogni push in coda (anche se rinviata alle 7 per
// la fascia di silenzio) e fuori dalla fascia, a qualunque ora girino i
// test: fra uno e due giorni, alle 10 UTC (11 o 12 italiane).
const GIORNO = 24 * 3600 * 1000;
const domaniAMezzogiorno = () => new Date(Math.floor((Date.now() + 1.5 * GIORNO) / GIORNO) * GIORNO + 10 * 3600 * 1000);

describe('notifiche push', () => {
  let pool, A, B, app, admin, collab, collega, adminB, collabB, servizio;

  before(async () => {
    ({ pool, A, B } = await preparaAmbiente());
    const hash = await hashPassword(PASSWORD);
    A.collega = (
      await pool.query(
        `INSERT INTO users (organization_id, email, first_name, last_name, role, password_hash)
         VALUES ($1, 'collega@a.test', 'Carla', 'Prova', 'collaboratore', $2) RETURNING id, email`,
        [A.id, hash],
      )
    ).rows[0];
    app = nuovaApp(pool);
    admin = await accedi(app, A.admin.email);
    collab = await accedi(app, A.collaboratore.email);
    collega = await accedi(app, A.collega.email);
    adminB = await accedi(app, B.admin.email);
    collabB = await accedi(app, B.collaboratore.email);
  });
  after(() => pool.end());

  beforeEach(async () => {
    servizio = servizioPushFinto();
    await pool.query('DELETE FROM push_outbox');
    await pool.query('DELETE FROM email_outbox');
  });

  const dispositivi = async (agente) => (await agente.get('/api/push')).body.dispositivi;
  const pushInCoda = async (utenteId) =>
    (
      await pool.query(
        `SELECT o.*, n.kind, n.user_id FROM push_outbox o JOIN notifications n ON n.id = o.notification_id
          WHERE n.user_id = $1 ORDER BY o.created_at`,
        [utenteId],
      )
    ).rows;
  const notificheDi = async (utenteId, tipo) =>
    (await pool.query('SELECT * FROM notifications WHERE user_id = $1 AND kind = $2', [utenteId, tipo])).rows;
  const emailA = async (indirizzo, tipo) => (await emailInCoda(pool, A.id, tipo)).filter((e) => e.to_addresses.includes(indirizzo));
  const pubblica = async (titolo) => {
    const res = await admin.post('/api/avvisi').send({ titolo, testo: 'Testo', per_tutti: true });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body.id;
  };
  const togliDispositivi = () => pool.query('DELETE FROM push_subscriptions');

  describe('attivazione sul dispositivo', () => {
    it('chiave pubblica, attivazione, nessun doppione, disattivazione', async () => {
      const stato = (await collab.get('/api/push')).body;
      assert.deepEqual(stato, { chiave_pubblica: configTest.push.chiavePubblica, dispositivi: 0 });
      const iscrizione = await iscriviDispositivo(collab);
      assert.equal(await dispositivi(collab), 1);
      // Lo stesso browser che rinnova l'iscrizione resta un dispositivo solo.
      assert.equal((await collab.post('/api/push/iscrizioni').send(iscrizione)).body.dispositivi, 1);
      const altro = await iscriviDispositivo(collab);
      assert.equal(await dispositivi(collab), 2);
      assert.equal((await collab.delete('/api/push/iscrizioni').send({ endpoint: altro.endpoint })).body.dispositivi, 1);
      await togliDispositivi();
    });

    it('rifiuta iscrizioni non valide e servizi push sconosciuti', async () => {
      const buona = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: Buffer.alloc(65, 4).toString('base64url'), auth: Buffer.alloc(16, 1).toString('base64url') } };
      const casi = [
        { ...buona, endpoint: 'http://fcm.googleapis.com/fcm/send/abc' },
        { ...buona, endpoint: 'https://api:3000/api/utenti' },
        { ...buona, endpoint: 'https://169.254.169.254/latest' },
        { ...buona, endpoint: 'https://fcm.googleapis.com.sito-estraneo.test/x' },
        { ...buona, endpoint: 'https://fcm.googleapis.com:8443/x' },
        { ...buona, endpoint: 42 },
        { ...buona, keys: { ...buona.keys, p256dh: 'corta' } },
        { ...buona, keys: { ...buona.keys, auth: undefined } },
        {},
      ];
      for (const corpo of casi) {
        const res = await collab.post('/api/push/iscrizioni').send(corpo);
        assert.equal(res.status, 400, JSON.stringify(corpo));
      }
      assert.equal(await dispositivi(collab), 0);
      // Servizi dei browser riconosciuti.
      for (const endpoint of [
        'https://updates.push.services.mozilla.com/wpush/v2/x',
        'https://web.push.apple.com/QF4x',
        'https://wns2-db5p.notify.windows.com/w/?token=x',
      ]) {
        assert.equal((await collab.post('/api/push/iscrizioni').send({ ...buona, endpoint })).status, 200, endpoint);
      }
      await togliDispositivi();
    });

    it('senza accesso le rotte rispondono 401', async () => {
      for (const [metodo, rotta] of [
        ['get', '/api/push'],
        ['post', '/api/push/iscrizioni'],
        ['delete', '/api/push/iscrizioni'],
        ['post', '/api/push/prova'],
      ]) {
        assert.equal((await request(app)[metodo](rotta).send({})).status, 401, rotta);
      }
    });

    it("nessuno tocca i dispositivi degli altri, nemmeno da un'altra organizzazione", async () => {
      const mia = await iscriviDispositivo(collab);
      for (const agente of [collega, admin, adminB, collabB]) {
        await agente.delete('/api/push/iscrizioni').send({ endpoint: mia.endpoint });
        assert.equal(await dispositivi(agente), 0);
      }
      assert.equal(await dispositivi(collab), 1);
      // L'amministratore vede chi ha le push attive, solo nella sua organizzazione.
      const utentiA = (await admin.get('/api/utenti')).body;
      assert.equal(utentiA.find((u) => u.id === A.collaboratore.id).dispositivi_push, 1);
      assert.equal(utentiA.find((u) => u.id === A.collega.id).dispositivi_push, 0);
      const utentiB = (await adminB.get('/api/utenti')).body;
      assert.ok(utentiB.every((u) => u.dispositivi_push === 0 && !u.email.endsWith('@a.test')));
      // Il collaboratore non vede l'elenco degli utenti.
      assert.equal((await collab.get('/api/utenti')).status, 403);
      // Lo stesso browser usato poi da un utente di B passa a lui: A lo perde.
      assert.equal((await collabB.post('/api/push/iscrizioni').send(mia)).status, 200);
      assert.equal(await dispositivi(collabB), 1);
      assert.equal(await dispositivi(collab), 0);
      const riga = (await pool.query('SELECT organization_id, user_id FROM push_subscriptions WHERE endpoint = $1', [mia.endpoint])).rows[0];
      assert.deepEqual(riga, { organization_id: B.id, user_id: B.collaboratore.id });
      await togliDispositivi();
    });

    it('"Esci" chiude le push di quel dispositivo; le push in coda ripiegano sull\'email', async () => {
      const secondo = await accedi(app, A.collega.email);
      await iscriviDispositivo(secondo);
      await iscriviDispositivo(collega);
      assert.equal(await dispositivi(collega), 2);
      assert.equal((await secondo.post('/api/auth/logout')).status, 200);
      assert.equal(await dispositivi(collega), 1);
      // Avviso in coda per l'ultimo dispositivo, poi anche quello esce.
      await pubblica('Uscita');
      assert.equal((await pushInCoda(A.collega.id)).length, 1);
      assert.equal((await emailA(A.collega.email, 'avviso')).length, 0);
      assert.equal((await collega.post('/api/auth/esci-ovunque')).status, 200);
      const esito = await elaboraPush(pool, servizio, domaniAMezzogiorno());
      assert.equal(esito.inviate, 0);
      assert.equal(servizio.inviate.length, 0);
      assert.equal((await pushInCoda(A.collega.id))[0].status, 'errore');
      assert.equal((await emailA(A.collega.email, 'avviso')).length, 1);
      collega = await accedi(app, A.collega.email);
    });
  });

  describe('scelta tra push ed email', () => {
    it("avviso: push a chi ha un dispositivo, email agli altri, niente all'autore", async () => {
      await iscriviDispositivo(admin);
      await iscriviDispositivo(collab);
      const id = await pubblica('Chiusura impianto');
      // L'autore (con le push attive) non riceve nulla.
      assert.equal((await notificheDi(A.admin.id, 'avviso')).filter((n) => n.link === `#/bacheca/${id}`).length, 0);
      assert.equal((await pushInCoda(A.admin.id)).length, 0);
      // Con un dispositivo: solo push.
      assert.equal((await pushInCoda(A.collaboratore.id)).length, 1);
      assert.equal((await emailA(A.collaboratore.email, 'avviso')).length, 0);
      // Senza: email, come prima.
      assert.equal((await pushInCoda(A.collega.id)).length, 0);
      assert.equal((await emailA(A.collega.email, 'avviso')).length, 1);
      // Nessuna notifica nell'altra organizzazione.
      assert.equal((await emailInCoda(pool, B.id)).length, 0);

      const esito = await elaboraPush(pool, servizio, domaniAMezzogiorno());
      assert.deepEqual(esito, { inviate: 1, rinviate: 0, errori: 0, dispositivi_tolti: 0 });
      const n = (await notificheDi(A.collaboratore.id, 'avviso')).find((x) => x.link === `#/bacheca/${id}`);
      assert.deepEqual(servizio.inviate[0].contenuto, {
        titolo: 'Nuovo avviso: Chiusura impianto',
        testo: 'Tocca per leggerlo in bacheca.',
        link: `#/bacheca/${id}`,
        tag: n.id,
      });
      assert.equal((await pushInCoda(A.collaboratore.id))[0].status, 'inviata');
    });

    it('promemoria: push a chi ha un dispositivo, email agli altri, con il link al mese', async () => {
      // 25 ottobre 2026 alle 10 italiane, giorno di promemoria.
      const [esito] = await eseguiPromemoria(pool, configTest, { adesso: new Date('2026-10-25T09:00:00Z'), simulazione: true, slug: 'a' });
      assert.equal(esito.esito, 'inviati');
      assert.deepEqual(
        [...esito.destinatari].sort(),
        [A.admin.id, A.collaboratore.id, A.collega.id].sort(),
      );
      for (const u of [A.admin, A.collaboratore]) {
        assert.equal((await pushInCoda(u.id)).length, 1, u.email);
        assert.equal((await emailA(u.email, 'promemoria')).length, 0, u.email);
      }
      assert.equal((await emailA(A.collega.email, 'promemoria')).length, 1);
      assert.match((await emailA(A.collega.email, 'promemoria'))[0].body_text, /#\/mese\/2026\/10/);
      await elaboraPush(pool, servizio, new Date('2026-10-25T09:00:30Z'));
      assert.equal(servizio.inviate.length, 2);
      assert.deepEqual(
        servizio.inviate.map((p) => [p.contenuto.titolo, p.contenuto.testo, p.contenuto.link]),
        Array(2).fill(['Ricordati di inviare le ore di ottobre 2026', 'La scadenza è il 31 ottobre.', '#/mese/2026/10']),
      );
    });

    it("riapertura: push ed email insieme, mai all'autore", async () => {
      const inviato = (utente) =>
        pool.query(
          `INSERT INTO month_submissions (organization_id, user_id, year, month, status, submitted_at)
           VALUES ($1, $2, 2026, 9, 'inviato', now())`,
          [A.id, utente],
        );
      await inviato(A.collaboratore.id);
      const res = await admin.post(`/api/collaboratori/${A.collaboratore.id}/mese/2026/9/riapertura`).send({ motivazione: 'Manca il 3 settembre' });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal((await pushInCoda(A.collaboratore.id)).length, 1);
      const email = await emailA(A.collaboratore.email, 'riapertura');
      assert.equal(email.length, 1);
      assert.match(email[0].body_text, /Motivazione: Manca il 3 settembre/);
      await elaboraPush(pool, servizio, domaniAMezzogiorno());
      assert.equal(servizio.inviate[0].contenuto.testo, 'Motivazione: Manca il 3 settembre');
      assert.equal(servizio.inviate[0].contenuto.link, '#/mese/2026/9');

      // L'amministratore che riapre il proprio mese non si notifica da solo.
      await inviato(A.admin.id);
      assert.equal((await admin.post(`/api/collaboratori/${A.admin.id}/mese/2026/9/riapertura`).send({ motivazione: 'Correzione' })).status, 200);
      assert.equal((await notificheDi(A.admin.id, 'riapertura')).length, 0);
      assert.equal((await emailA(A.admin.email, 'riapertura')).length, 0);
    });

    it('il sollecito resta solo per email', async () => {
      const res = await admin.post(`/api/collaboratori/${A.collaboratore.id}/mese/2026/10/sollecito`);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal((await pushInCoda(A.collaboratore.id)).length, 0);
      assert.equal((await emailA(A.collaboratore.email, 'sollecito')).length, 1);
    });

    it('senza chiavi VAPID nessuna push: tutto per email', async () => {
      const senzaPush = nuovaApp(pool, { ...configTest, push: null });
      const adminSenza = await accedi(senzaPush, A.admin.email);
      assert.equal((await adminSenza.get('/api/push')).body.chiave_pubblica, null);
      const res = await adminSenza.post('/api/avvisi').send({ titolo: 'Senza push', testo: 'x', per_tutti: true });
      assert.equal(res.status, 201);
      assert.equal((await pushInCoda(A.collaboratore.id)).length, 0);
      assert.equal((await emailA(A.collaboratore.email, 'avviso')).length, 1);
    });
  });

  describe('fascia di silenzio (22–7, ora italiana)', () => {
    it('calcola le 7 del mattino, anche nei cambi di ora', () => {
      const casi = [
        // [istante, primo invio]
        ['2026-10-14T19:59:00Z', '2026-10-14T19:59:00Z'], // 21:59 CEST
        ['2026-10-14T20:00:00Z', '2026-10-15T05:00:00Z'], // 22:00 CEST → 7:00 CEST
        ['2026-10-14T23:30:00Z', '2026-10-15T05:00:00Z'], // 1:30 CEST
        ['2026-10-15T04:59:00Z', '2026-10-15T05:00:00Z'], // 6:59 CEST
        ['2026-10-15T05:00:00Z', '2026-10-15T05:00:00Z'], // 7:00 CEST
        ['2026-10-24T21:00:00Z', '2026-10-25T06:00:00Z'], // 23:00 CEST, la notte del cambio → 7:00 CET
        ['2026-03-28T22:00:00Z', '2026-03-29T05:00:00Z'], // 23:00 CET → 7:00 CEST
        ['2026-12-31T21:30:00Z', '2027-01-01T06:00:00Z'], // 22:30 CET, fine anno
      ];
      for (const [istante, atteso] of casi) {
        assert.equal(fuoriDalSilenzio(new Date(istante)).toISOString(), new Date(atteso).toISOString(), istante);
      }
      assert.equal(inSilenzio(new Date('2026-10-14T20:00:00Z')), true);
      assert.equal(inSilenzio(new Date('2026-10-15T05:00:00Z')), false);
    });

    it('una notifica delle 23:30 parte alle 7:00; nel frattempo niente', async () => {
      await togliDispositivi();
      await iscriviDispositivo(collega);
      // 28 ottobre 2026 alle 23:30 italiane (ora solare): promemoria simulato.
      await eseguiPromemoria(pool, configTest, { adesso: new Date('2026-10-28T22:30:00Z'), simulazione: true, slug: 'a' });
      const [riga] = await pushInCoda(A.collega.id);
      assert.equal(riga.next_attempt_at.toISOString(), '2026-10-29T06:00:00.000Z');
      // Con le push attive, niente email nemmeno di notte.
      assert.equal((await emailA(A.collega.email, 'promemoria')).length, 0);
      for (const istante of ['2026-10-28T22:31:00Z', '2026-10-29T03:00:00Z', '2026-10-29T05:59:59Z']) {
        await elaboraPush(pool, servizio, new Date(istante));
        assert.equal(servizio.inviate.length, 0, istante);
      }
      await elaboraPush(pool, servizio, new Date('2026-10-29T06:00:00Z'));
      assert.equal(servizio.inviate.length, 1);
    });

    it('un nuovo tentativo che cade nella fascia slitta alle 7:00', async () => {
      await togliDispositivi();
      await iscriviDispositivo(collega);
      // 21:55 italiane: il primo tentativo fallisce, il secondo sarebbe alle 21:56…
      await eseguiPromemoria(pool, configTest, { adesso: new Date('2026-10-31T20:55:00Z'), simulazione: true, slug: 'a' });
      servizio.guasta(() => 503);
      await elaboraPush(pool, servizio, new Date('2026-10-31T20:55:00Z'));
      servizio.guasta(null);
      // … ma alle 22:05 si è nella fascia: rinvio alle 7:00 del 1° novembre.
      await elaboraPush(pool, servizio, new Date('2026-10-31T21:05:00Z'));
      assert.equal(servizio.inviate.length, 0);
      const [riga] = await pushInCoda(A.collega.id);
      assert.equal(riga.status, 'in_attesa');
      assert.equal(riga.next_attempt_at.toISOString(), '2026-11-01T06:00:00.000Z');
      await elaboraPush(pool, servizio, new Date('2026-11-01T06:00:00Z'));
      assert.equal(servizio.inviate.length, 1);
    });

    it('la notifica di prova parte subito, anche di notte', async () => {
      await togliDispositivi();
      assert.equal((await collega.post('/api/push/prova')).status, 409);
      await iscriviDispositivo(collega);
      const res = await collega.post('/api/push/prova');
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { dispositivi: 1 });
      // 23:30 italiane di domani: in piena fascia di silenzio.
      const notte = new Date(domaniAMezzogiorno().getTime() + 11.5 * 3600 * 1000);
      assert.ok(inSilenzio(notte));
      await elaboraPush(pool, servizio, notte);
      assert.equal(servizio.inviate.length, 1);
      assert.equal(servizio.inviate[0].contenuto.titolo, 'Notifica di prova');
      // Mai per email, e non più di tre al minuto.
      assert.equal((await emailA(A.collega.email, 'prova')).length, 0);
      assert.equal((await collega.post('/api/push/prova')).status, 200);
      assert.equal((await collega.post('/api/push/prova')).status, 200);
      assert.equal((await collega.post('/api/push/prova')).status, 429);
    });
  });

  describe('dispositivi non più validi', () => {
    it("410/404: l'iscrizione viene cancellata; email solo se la notifica non è arrivata altrove", async () => {
      await togliDispositivi();
      const primo = await iscriviDispositivo(collab);
      await iscriviDispositivo(collab);
      await pubblica('Due dispositivi');
      assert.equal((await pushInCoda(A.collaboratore.id)).length, 2);
      // Il primo non è più valido, il secondo riceve: nessuna email.
      servizio.guasta((endpoint) => (endpoint === primo.endpoint ? 410 : null));
      const esito = await elaboraPush(pool, servizio, domaniAMezzogiorno());
      assert.equal(esito.inviate, 1);
      assert.equal(esito.dispositivi_tolti, 1);
      assert.equal(await dispositivi(collab), 1);
      assert.equal((await emailA(A.collaboratore.email, 'avviso')).length, 0);

      // Anche l'ultimo non è più valido: la notifica ripiega sull'email…
      servizio.guasta(() => 404);
      await pubblica('Ultimo dispositivo');
      await elaboraPush(pool, servizio, domaniAMezzogiorno());
      assert.equal(await dispositivi(collab), 0);
      const email = await emailA(A.collaboratore.email, 'avviso');
      assert.equal(email.length, 1);
      assert.equal(email[0].subject, 'Nuovo avviso: Ultimo dispositivo');
      // … con lo stesso mittente dell'email normale.
      assert.equal(email[0].from_name, 'Nomeadmin CognomeA tramite Registro ore');

      // Senza più dispositivi, il prossimo avviso va subito per email.
      await pubblica('Senza dispositivi');
      assert.equal((await pushInCoda(A.collaboratore.id)).filter((r) => r.status === 'in_attesa').length, 0);
      assert.equal((await emailA(A.collaboratore.email, 'avviso')).length, 2);
    });

    it('errori temporanei: nuovi tentativi, poi errore e ripiego sull\'email', async () => {
      await togliDispositivi();
      await iscriviDispositivo(collab);
      await pubblica('Servizio guasto');
      servizio.guasta(() => 500);
      const t0 = domaniAMezzogiorno().getTime();
      assert.equal((await elaboraPush(pool, servizio, new Date(t0))).rinviate, 1);
      // Prima del ritardo non si riprova.
      assert.equal((await elaboraPush(pool, servizio, new Date(t0 + 30 * 1000))).rinviate, 0);
      assert.equal((await elaboraPush(pool, servizio, new Date(t0 + 61 * 1000))).rinviate, 1);
      assert.equal((await emailA(A.collaboratore.email, 'avviso')).length, 0);
      // Terzo tentativo (massimo nei test): errore, il dispositivo resta.
      assert.equal((await elaboraPush(pool, servizio, new Date(t0 + 200 * 1000))).errori, 1);
      assert.equal(await dispositivi(collab), 1);
      assert.equal((await emailA(A.collaboratore.email, 'avviso')).length, 1);
    });

    it('riapertura: con il dispositivo non valido nessuna seconda email', async () => {
      await togliDispositivi();
      await iscriviDispositivo(collab);
      await pool.query(
        `UPDATE month_submissions SET status = 'inviato', submitted_at = now()
          WHERE user_id = $1 AND year = 2026 AND month = 9`,
        [A.collaboratore.id],
      );
      assert.equal((await admin.post(`/api/collaboratori/${A.collaboratore.id}/mese/2026/9/riapertura`).send({ motivazione: 'Di nuovo' })).status, 200);
      servizio.guasta(() => 410);
      await elaboraPush(pool, servizio, domaniAMezzogiorno());
      assert.equal(await dispositivi(collab), 0);
      assert.equal((await emailA(A.collaboratore.email, 'riapertura')).length, 1);
    });
  });
});
