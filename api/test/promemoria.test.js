// Quadro degli invii, esonero, solleciti e promemoria automatici.
// Organizzazione A: admin, collaboratore, disattivato (dai helper) più
//   esonerato (non deve inviare), senza password (invito non usato),
//   inviato (ha già inviato ottobre 2026).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { preparaAmbiente, nuovaApp, accedi, PASSWORD, configTest, emailInCoda } = require('./helpers');
const { hashPassword } = require('../src/password');
const { eseguiPromemoria, giorniPromemoria } = require('../src/promemoria');

// Istanti in UTC; in Italia a fine ottobre 2026 (dopo il 25) è UTC+1.
const alle = (iso) => new Date(iso);

describe('promemoria e quadro degli invii', () => {
  let pool, A, B, app, admin, collab, esonerato, adminB;

  before(async () => {
    ({ pool, A, B } = await preparaAmbiente());
    const hash = await hashPassword(PASSWORD);
    const crea = async (prefisso, { password = true, esonerato: es = false } = {}) =>
      (
        await pool.query(
          `INSERT INTO users (organization_id, email, first_name, last_name, role, password_hash, submission_exempt)
           VALUES ($1, $2, $3, 'Prova', 'collaboratore', $4, $5) RETURNING id, email`,
          [A.id, `${prefisso}@a.test`, prefisso, password ? hash : null, es],
        )
      ).rows[0];
    A.esonerato = await crea('esonerato', { esonerato: true });
    A.senzaPassword = await crea('senzapassword', { password: false });
    A.inviato = await crea('inviato');
    await pool.query(
      `INSERT INTO month_submissions (organization_id, user_id, year, month, status, submitted_at)
       VALUES ($1, $2, 2026, 10, 'inviato', now())`,
      [A.id, A.inviato.id],
    );
    app = nuovaApp(pool);
    admin = await accedi(app, A.admin.email);
    collab = await accedi(app, A.collaboratore.email);
    esonerato = await accedi(app, A.esonerato.email);
    adminB = await accedi(app, B.admin.email);
  });
  after(() => pool.end());

  const esegui = (adesso, opzioni = {}) => eseguiPromemoria(pool, configTest, { adesso: alle(adesso), ...opzioni });
  const diA = (esiti) => esiti.find((e) => e.organizzazione === 'a');
  const promemoriaDi = async (utente, chiave = null) =>
    (
      await pool.query(
        `SELECT dedup_key FROM notifications WHERE user_id = $1 AND kind = 'promemoria' AND ($2::text IS NULL OR dedup_key = $2)`,
        [utente.id, chiave],
      )
    ).rows;

  describe('promemoria automatici', () => {
    it('giorni di promemoria: 25, 28 e ultimo giorno; i giorni oltre la fine di un mese corto valgono come ultimo', () => {
      assert.deepEqual(giorniPromemoria({ giorni: [25, 28], ultimoGiorno: true }, 2026, 10), [25, 28, 31]);
      assert.deepEqual(giorniPromemoria({ giorni: [25, 28], ultimoGiorno: true }, 2027, 2), [25, 28]);
      assert.deepEqual(giorniPromemoria({ giorni: [30], ultimoGiorno: false }, 2027, 2), [28]);
      assert.deepEqual(giorniPromemoria({ giorni: [], ultimoGiorno: false }, 2026, 10), []);
    });

    it('prima delle 9 (ora italiana) non parte nulla', async () => {
      // 25 ottobre 2026, 08:00 in Italia.
      const esito = diA(await esegui('2026-10-25T07:00:00Z'));
      assert.equal(esito.esito, 'prima_dell_ora');
      assert.deepEqual(await promemoriaDi(A.collaboratore), []);
    });

    it('alle 9 parte solo a chi deve ancora inviare: non agli esonerati, ai disattivati, a chi ha già inviato', async () => {
      const esito = diA(await esegui('2026-10-25T08:05:00Z'));
      assert.equal(esito.esito, 'inviati');
      assert.equal(esito.data, '2026-10-25');
      assert.deepEqual(esito.destinatari.sort(), [A.admin.id, A.collaboratore.id].sort());
      const email = await emailInCoda(pool, A.id, 'promemoria');
      assert.deepEqual(email.map((e) => e.to_addresses[0]).sort(), [A.admin.email, A.collaboratore.email].sort());
      assert.equal(email[0].subject, 'Ricordati di inviare le ore di ottobre 2026');
      assert.match(email[0].body_text, /La scadenza è il 31 ottobre/);
      assert.match(email[0].body_text, /http:\/\/app\.test\/#\//);
      // Ogni organizzazione ha il suo giro, con i suoi utenti.
      const b = (await emailInCoda(pool, B.id, 'promemoria')).map((e) => e.to_addresses[0]).sort();
      assert.deepEqual(b, [B.admin.email, B.collaboratore.email].sort());
    });

    it('non parte mai due volte: né più tardi nello stesso giorno, né dopo un riavvio, né in parallelo', async () => {
      assert.equal(diA(await esegui('2026-10-25T08:06:00Z')).esito, 'gia_eseguito');
      assert.equal(diA(await esegui('2026-10-25T20:00:00Z')).esito, 'gia_eseguito');
      assert.equal((await promemoriaDi(A.collaboratore)).length, 1);
      // Due giri contemporanei (per esempio due API avviate insieme) il 28.
      const esiti = await Promise.all([esegui('2026-10-28T09:00:00Z'), esegui('2026-10-28T09:00:00Z')]);
      assert.deepEqual(esiti.map((e) => diA(e).esito).sort(), ['gia_eseguito', 'inviati']);
      assert.equal((await promemoriaDi(A.collaboratore, 'promemoria:2026-10-28')).length, 1);
      const { rows } = await pool.query(
        "SELECT count(*)::int AS n FROM email_outbox WHERE kind = 'promemoria' AND $1 = ANY(to_addresses)",
        [A.collaboratore.email],
      );
      assert.equal(rows[0].n, 2); // 25 e 28
    });

    it('con il server spento alle 9 recupera nello stesso giorno, ma non nei giorni successivi', async () => {
      // 31 ottobre: l'API riparte alle 17.
      assert.equal(diA(await esegui('2026-10-31T16:00:00Z')).esito, 'inviati');
      const ultimo = (await emailInCoda(pool, A.id, 'promemoria')).at(-1);
      assert.match(ultimo.subject, /^Ultimo giorno: invia le ore di ottobre 2026$/);
      // Il 1° novembre non è un giorno di promemoria e i giorni persi non si recuperano.
      await pool.query("DELETE FROM reminder_runs WHERE run_date = '2026-10-31'");
      await pool.query("DELETE FROM notifications WHERE dedup_key = 'promemoria:2026-10-31'");
      const prima = (await emailInCoda(pool, A.id, 'promemoria')).length;
      assert.equal(diA(await esegui('2026-11-01T10:00:00Z')).esito, 'non_previsto');
      assert.equal((await emailInCoda(pool, A.id, 'promemoria')).length, prima);
    });

    it("il mese giusto: il 25 novembre il promemoria riguarda novembre, anche per chi ha inviato ottobre", async () => {
      const esito = diA(await esegui('2026-11-25T09:00:00Z'));
      assert.ok(esito.destinatari.includes(A.inviato.id));
      assert.equal((await emailInCoda(pool, A.id, 'promemoria')).at(-1).subject, 'Ricordati di inviare le ore di novembre 2026');
    });

    it('la simulazione di un giorno non blocca il promemoria vero, e non si ripete', async () => {
      // 28 dicembre a mezzanotte: la simulazione ignora l'ora.
      const sim = diA(await esegui('2026-12-28T00:00:00Z', { simulazione: true, slug: 'a' }));
      assert.equal(sim.esito, 'inviati');
      assert.equal(diA(await esegui('2026-12-28T00:00:00Z', { simulazione: true, slug: 'a' })).esito, 'gia_eseguito');
      // Il giro vero dello stesso giorno parte comunque.
      assert.equal(diA(await esegui('2026-12-28T09:00:00Z')).esito, 'inviati');
      assert.equal((await promemoriaDi(A.collaboratore, 'promemoria:2026-12-28')).length, 1);
      assert.equal((await promemoriaDi(A.collaboratore, 'promemoria:2026-12-28:simulazione')).length, 1);
      // slug: solo quell'organizzazione.
      const soloA = await esegui('2026-12-25T00:00:00Z', { simulazione: true, slug: 'a' });
      assert.deepEqual(soloA.map((e) => e.organizzazione), ['a']);
    });

    it("giorni e ora si configurano dall'amministratore", async () => {
      assert.deepEqual((await admin.get('/api/organizzazione')).body.promemoria, { giorni: [25, 28], ultimo_giorno: true, ora: 9 });
      for (const promemoria of [
        { giorni: [0], ultimo_giorno: true, ora: 9 },
        { giorni: [32], ultimo_giorno: true, ora: 9 },
        { giorni: [10], ultimo_giorno: 'sì', ora: 9 },
        { giorni: [10], ultimo_giorno: true, ora: 24 },
        { giorni: '10', ultimo_giorno: true, ora: 9 },
      ]) {
        assert.equal((await admin.patch('/api/organizzazione').send({ promemoria })).status, 400, JSON.stringify(promemoria));
      }
      const res = await admin.patch('/api/organizzazione').send({ promemoria: { giorni: [12, 10, 10], ultimo_giorno: false, ora: 7 } });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.promemoria, { giorni: [10, 12], ultimo_giorno: false, ora: 7 });
      assert.equal(res.body.email_invio, null);
      assert.equal((await collab.patch('/api/organizzazione').send({ promemoria: { giorni: [1], ultimo_giorno: false, ora: 1 } })).status, 403);
      const traccia = await pool.query("SELECT details FROM audit_log WHERE action = 'organizzazione.modificata' AND organization_id = $1", [A.id]);
      assert.deepEqual(traccia.rows.at(-1).details.promemoria.dopo, { giorni: [10, 12], ultimo_giorno: false, ora: 7 });
      // 10 gennaio 2027 alle 7:30 italiane: parte; il 31 no.
      assert.equal(diA(await esegui('2027-01-10T06:30:00Z')).esito, 'inviati');
      assert.equal(diA(await esegui('2027-01-31T10:00:00Z')).esito, 'non_previsto');
      // B non è cambiata.
      assert.deepEqual((await adminB.get('/api/organizzazione')).body.promemoria, { giorni: [25, 28], ultimo_giorno: true, ora: 9 });
      await admin.patch('/api/organizzazione').send({ promemoria: { giorni: [25, 28], ultimo_giorno: true, ora: 9 } });
    });
  });

  describe("esonero dall'invio", () => {
    it("l'amministratore esonera un utente: esce dal quadro e dai promemoria", async () => {
      assert.equal((await admin.patch(`/api/utenti/${A.collaboratore.id}`).send({ esonerato_invio: 'sì' })).status, 400);
      const res = await admin.patch(`/api/utenti/${A.collaboratore.id}`).send({ esonerato_invio: true });
      assert.equal(res.status, 200);
      assert.equal(res.body.esonerato_invio, true);
      const quadro = (await admin.get('/api/collaboratori/2027/2')).body.collaboratori;
      assert.ok(!quadro.some((c) => c.id === A.collaboratore.id));
      const esito = diA(await esegui('2027-02-25T09:00:00Z'));
      assert.ok(!esito.destinatari.includes(A.collaboratore.id));
      assert.ok(esito.destinatari.includes(A.admin.id));
      const traccia = await pool.query("SELECT details FROM audit_log WHERE action = 'utente.modificato' AND target_id = $1", [
        A.collaboratore.id,
      ]);
      assert.deepEqual(traccia.rows.at(-1).details.esonerato_invio, { prima: false, dopo: true });
      await admin.patch(`/api/utenti/${A.collaboratore.id}`).send({ esonerato_invio: false });
    });

    it("un esonerato che registra ore compare nel quadro, ma non tra chi manca", async () => {
      assert.equal((await esonerato.put('/api/giorni/2026-10-05').send({ voci: [{ attivita_id: A.attivitaOre, quantita: 2 }] })).status, 200);
      const quadro = (await admin.get('/api/collaboratori/2026/10')).body.collaboratori;
      const e = quadro.find((c) => c.id === A.esonerato.id);
      assert.equal(e.esonerato, true);
      assert.equal(e.manca, false);
    });
  });

  describe('quadro per il gestore e solleciti', () => {
    it('chi ha inviato e quando, chi manca', async () => {
      const quadro = (await admin.get('/api/collaboratori/2026/10')).body.collaboratori;
      const per = Object.fromEntries(quadro.map((c) => [c.id, c]));
      assert.equal(per[A.inviato.id].stato, 'inviato');
      assert.ok(per[A.inviato.id].inviato_il);
      assert.equal(per[A.inviato.id].manca, false);
      assert.equal(per[A.collaboratore.id].manca, true);
      assert.equal(per[A.collaboratore.id].inviato_il, null);
      assert.equal(per[A.senzaPassword.id].manca, true);
      assert.equal(per[A.senzaPassword.id].password_impostata, false);
      assert.ok(!(A.disattivato.id in per));
      // Un responsabile non riceve i campi del quadro.
      await pool.query("UPDATE users SET role = 'responsabile' WHERE id = $1", [A.esonerato.id]);
      await pool.query('INSERT INTO sector_managers (organization_id, sector_id, user_id) VALUES ($1, $2, $3)', [A.id, A.settore, A.esonerato.id]);
      try {
        const resp = (await esonerato.get('/api/collaboratori/2026/10')).body.collaboratori;
        assert.ok(resp.length > 0);
        assert.ok(resp.every((c) => c.manca === undefined && c.ultimo_sollecito === undefined));
        assert.equal((await esonerato.post(`/api/collaboratori/${A.collaboratore.id}/mese/2026/10/sollecito`)).status, 403);
      } finally {
        await pool.query('DELETE FROM sector_managers WHERE user_id = $1', [A.esonerato.id]);
        await pool.query("UPDATE users SET role = 'collaboratore' WHERE id = $1", [A.esonerato.id]);
      }
    });

    it("sollecita una persona: email a suo nome dell'amministratore, non ripetibile subito", async () => {
      const url = (u) => `/api/collaboratori/${u.id}/mese/2026/10/sollecito`;
      assert.equal((await collab.post(url(A.collaboratore))).status, 403);
      const res = await admin.post(url(A.collaboratore));
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.ok(res.body.ultimo_sollecito);
      const [email] = (await emailInCoda(pool, A.id, 'sollecito'));
      assert.deepEqual(email.to_addresses, [A.collaboratore.email]);
      assert.equal(email.reply_to, A.admin.email);
      assert.equal(email.from_name, 'Nomeadmin CognomeA tramite Registro ore');
      assert.equal(email.subject, 'Promemoria: invia le ore di ottobre 2026');
      assert.equal((await admin.post(url(A.collaboratore))).status, 409);
      const quadro = (await admin.get('/api/collaboratori/2026/10')).body.collaboratori;
      assert.ok(quadro.find((c) => c.id === A.collaboratore.id).ultimo_sollecito);
      const traccia = await pool.query("SELECT details FROM audit_log WHERE action = 'mese.sollecitato'");
      assert.deepEqual([traccia.rows[0].details.anno, traccia.rows[0].details.mese], [2026, 10]);

      // Chi ha già inviato, l'esonerato, il disattivato, chi non ha la password: no.
      for (const u of [A.inviato, A.esonerato, A.disattivato, A.senzaPassword]) {
        assert.equal((await admin.post(url(u))).status, 409, u.email);
      }
      assert.equal((await admin.post(url(B.collaboratore))).status, 404);
      assert.equal((await admin.post('/api/collaboratori/123/mese/2026/10/sollecito')).status, 404);
      assert.equal((await emailInCoda(pool, A.id, 'sollecito')).length, 1);
    });
  });
});
