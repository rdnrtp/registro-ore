// Cosa può leggere, modificare e scaricare ciascun ruolo nei mesi degli altri.
// Organizzazione A con due settori:
//   Segreteria (attività "Segreteria", ore; "PT singola", sedute) — responsabile R1
//   Bagnini    (attività "Bagnino", ore)                         — responsabile R2
// Registrazioni di ottobre 2026:
//   collaboratore: Segreteria 4 h (1/10), Bagnino 3 h (2/10), PT singola 2 (3/10), una seduta PT con cliente
//   collega:       Bagnino 2 h (3/10)
//   admin:         Segreteria 1 h (5/10)
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { PASSWORD, preparaAmbiente, nuovaApp, accedi } = require('./helpers');
const { hashPassword } = require('../src/password');

async function ambiente() {
  const { pool, A, B } = await preparaAmbiente();
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
  await pool.query('INSERT INTO activity_sectors (organization_id, activity_id, sector_id) VALUES ($1, $2, $3), ($1, $4, $5)', [
    A.id,
    A.attivitaBagnino,
    A.settoreBagnini,
    A.attivitaSedute,
    A.settore,
  ]);
  const utente = (email, ruolo, nome) =>
    q(
      `INSERT INTO users (organization_id, email, first_name, last_name, role, password_hash)
       VALUES ($1, $2, $3, 'Prova', $4, $5) RETURNING id, email`,
      [A.id, email, nome, ruolo, hash],
    );
  A.r1 = await utente('r1@a.test', 'responsabile', 'Rita');
  A.r2 = await utente('r2@a.test', 'responsabile', 'Renzo');
  A.collega = await utente('collega@a.test', 'collaboratore', 'Carla');
  await pool.query(
    'INSERT INTO sector_managers (organization_id, sector_id, user_id) VALUES ($1, $2, $3), ($1, $4, $5)',
    [A.id, A.settore, A.r1.id, A.settoreBagnini, A.r2.id],
  );

  const app = nuovaApp(pool);
  const agenti = {
    collab: await accedi(app, A.collaboratore.email),
    collega: await accedi(app, A.collega.email),
    r1: await accedi(app, A.r1.email),
    r2: await accedi(app, A.r2.email),
    admin: await accedi(app, A.admin.email),
  };
  const salva = async (agente, data, voci) => {
    const res = await agente.put(`/api/giorni/${data}`).send({ voci });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  };
  await salva(agenti.collab, '2026-10-01', [{ attivita_id: A.attivitaOre, quantita: 4 }]);
  await salva(agenti.collab, '2026-10-02', [{ attivita_id: A.attivitaBagnino, quantita: 3 }]);
  await salva(agenti.collab, '2026-10-03', [{ attivita_id: A.attivitaSedute, quantita: 2 }]);
  await agenti.collab.post('/api/sedute-pt').send({ data: '2026-10-03', tipo: 'acqua', cliente: 'Cliente Riservato' });
  await salva(agenti.collega, '2026-10-03', [{ attivita_id: A.attivitaBagnino, quantita: 2 }]);
  await salva(agenti.admin, '2026-10-05', [{ attivita_id: A.attivitaOre, quantita: 1 }]);
  return { pool, A, B, app, ...agenti };
}

describe('permessi per ruolo', () => {
  let pool, A, B, app, collab, collega, r1, r2, admin;

  before(async () => {
    ({ pool, A, B, app, collab, collega, r1, r2, admin } = await ambiente());
  });
  after(() => pool.end());

  const meseDi = (agente, utente, mese = 10) => agente.get(`/api/collaboratori/${utente.id}/mese/2026/${mese}`);
  const excelDi = (agente, utente) => agente.get(`/api/collaboratori/${utente.id}/mese/2026/10/excel`);
  const rotteAdmin = () => [
    ['get', '/api/utenti'],
    ['get', `/api/utenti/${A.collaboratore.id}`],
    ['post', '/api/utenti'],
    ['patch', `/api/utenti/${A.collaboratore.id}`],
    ['post', `/api/utenti/${A.collaboratore.id}/invito`],
    ['patch', `/api/attivita/${A.attivitaOre}`],
    ['put', '/api/ordine-attivita'],
    ['post', '/api/settori'],
    ['patch', `/api/settori/${A.settore}`],
    ['delete', `/api/settori/${A.settore}`],
    ['get', '/api/organizzazione'],
    ['patch', '/api/organizzazione'],
    ['get', '/api/registro-modifiche'],
    ['get', '/api/modello'],
    ['get', '/api/modello/file'],
    ['post', '/api/modello'],
  ];

  describe('collaboratore', () => {
    it('non vede i mesi degli altri né il proprio elenco di collaboratori', async () => {
      assert.equal((await collab.get('/api/collaboratori/2026/10')).status, 403);
      assert.equal((await meseDi(collab, A.collega)).status, 403);
      assert.equal((await meseDi(collab, A.collaboratore)).status, 403);
      assert.equal((await excelDi(collab, A.collega)).status, 403);
    });

    it('non accede a nessuna pagina di gestione', async () => {
      for (const [metodo, rotta] of rotteAdmin()) {
        const res = await collab[metodo](rotta).send({});
        assert.equal(res.status, 403, `${metodo} ${rotta}`);
      }
      // Nessuna modifica è avvenuta.
      const { rows } = await pool.query('SELECT count(*)::int AS n FROM sectors WHERE organization_id = $1', [A.id]);
      assert.equal(rows[0].n, 2);
    });
  });

  describe('responsabile', () => {
    it("vede solo chi ha registrazioni nei suoi settori, con i totali di quei settori", async () => {
      const res = await r1.get('/api/collaboratori/2026/10');
      assert.equal(res.status, 200);
      // Segreteria: collaboratore (4 h + 2 sedute) e admin (1 h). Non la collega (solo Bagnino).
      const perNome = Object.fromEntries(res.body.collaboratori.map((c) => [c.nome, c]));
      assert.deepEqual(Object.keys(perNome).sort(), ['Nomeadmin', 'Nomecollab']);
      assert.equal(perNome.Nomecollab.ore, 4);
      assert.equal(perNome.Nomecollab.sedute, 2);
      assert.equal(perNome.Nomecollab.stato, 'aperto');
      assert.equal(perNome.Nomeadmin.ore, 1);

      const bagnini = await r2.get('/api/collaboratori/2026/10');
      const perNome2 = Object.fromEntries(bagnini.body.collaboratori.map((c) => [c.nome, c]));
      assert.deepEqual(Object.keys(perNome2).sort(), ['Carla', 'Nomecollab']);
      assert.equal(perNome2.Nomecollab.ore, 3);
      assert.equal(perNome2.Nomecollab.sedute, 0);
    });

    it('di un collaboratore vede solo le righe delle attività dei suoi settori', async () => {
      const res = await meseDi(r1, A.collaboratore);
      assert.equal(res.status, 200);
      assert.deepEqual(
        res.body.registrazioni.map((r) => [r.data, r.attivita_id, r.quantita]),
        [
          ['2026-10-01', A.attivitaOre, 4],
          ['2026-10-03', A.attivitaSedute, 2],
        ],
      );
      // Le sedute PT con il nome del cliente non sono visibili al responsabile.
      assert.equal(res.body.sedute_pt, null);
      assert.doesNotMatch(JSON.stringify(res.body), /Cliente Riservato/);
      assert.equal(res.body.solo_settori_propri, true);
      assert.equal(res.body.utente.nome, 'Nomecollab');

      const r2Vede = await meseDi(r2, A.collaboratore);
      assert.deepEqual(r2Vede.body.registrazioni.map((r) => r.attivita_id), [A.attivitaBagnino]);
    });

    it('non vede i collaboratori che non lo riguardano, né i mesi senza registrazioni nei suoi settori', async () => {
      for (const [agente, utente, mese] of [
        [r1, A.collega, 10], // solo Bagnino
        [r2, A.admin, 10], // solo Segreteria
        [r1, A.collaboratore, 11], // nessuna registrazione a novembre
        [r1, A.disattivato, 10],
        [r1, B.collaboratore, 10], // altra organizzazione
      ]) {
        const res = await meseDi(agente, utente, mese);
        assert.equal(res.status, 404, `${utente.email} ${mese}`);
        assert.deepEqual(res.body, { errore: 'Non trovato' });
      }
    });

    it('non scarica il file Excel degli altri e non accede alla gestione', async () => {
      assert.equal((await excelDi(r1, A.collaboratore)).status, 403);
      for (const [metodo, rotta] of rotteAdmin()) {
        assert.equal((await r1[metodo](rotta).send({})).status, 403, `${metodo} ${rotta}`);
      }
    });

    it('un responsabile senza settori non vede nessuno', async () => {
      await pool.query('DELETE FROM sector_managers WHERE user_id = $1', [A.r2.id]);
      try {
        assert.deepEqual((await r2.get('/api/collaboratori/2026/10')).body.collaboratori, []);
        assert.equal((await meseDi(r2, A.collega)).status, 404);
      } finally {
        await pool.query('INSERT INTO sector_managers (organization_id, sector_id, user_id) VALUES ($1, $2, $3)', [
          A.id,
          A.settoreBagnini,
          A.r2.id,
        ]);
      }
    });
  });

  describe('amministratore', () => {
    it('vede tutti gli utenti attivi, anche senza registrazioni, con i totali completi', async () => {
      const res = await admin.get('/api/collaboratori/2026/10');
      assert.equal(res.status, 200);
      const perNome = Object.fromEntries(res.body.collaboratori.map((c) => [c.nome, c]));
      // Il disattivato senza registrazioni non compare; gli altri sì.
      assert.deepEqual(Object.keys(perNome).sort(), ['Carla', 'Nomeadmin', 'Nomecollab', 'Renzo', 'Rita']);
      assert.deepEqual([perNome.Nomecollab.ore, perNome.Nomecollab.sedute], [7, 2]);
      assert.deepEqual([perNome.Rita.ore, perNome.Rita.sedute], [0, 0]);
    });

    it('vede tutte le righe e le sedute PT di chiunque', async () => {
      const res = await meseDi(admin, A.collaboratore);
      assert.equal(res.status, 200);
      assert.equal(res.body.registrazioni.length, 3);
      assert.deepEqual(res.body.sedute_pt.map((s) => s.cliente), ['Cliente Riservato']);
      assert.equal(res.body.solo_settori_propri, false);
      // Anche un mese vuoto e un utente disattivato.
      assert.deepEqual((await meseDi(admin, A.disattivato)).body.registrazioni, []);
    });

    it('scarica il file Excel di un altro utente (senza modello: 503, ma non 403)', async () => {
      const res = await excelDi(admin, A.collaboratore);
      assert.equal(res.status, 503);
      assert.match(res.body.errore, /modello Excel/);
      assert.equal((await excelDi(admin, B.collaboratore)).status, 404);
    });
  });

  describe('nessuno modifica le ore altrui', () => {
    it('le viste sugli altri non accettano modifiche', async () => {
      for (const agente of [r1, admin]) {
        for (const metodo of ['put', 'patch', 'post', 'delete']) {
          const res = await agente[metodo](`/api/collaboratori/${A.collaboratore.id}/mese/2026/10`).send({
            registrazioni: [{ data: '2026-10-01', attivita_id: A.attivitaOre, quantita: 9 }],
          });
          assert.equal(res.status, 404, metodo);
        }
      }
    });

    it("le rotte di modifica agiscono solo sull'autore della richiesta", async () => {
      const id = A.collaboratore.id;
      for (const agente of [r1, admin]) {
        await agente
          .put(`/api/giorni/2026-10-01?utente=${id}`)
          .send({ utente_id: id, user_id: id, voci: [{ attivita_id: A.attivitaOre, quantita: 0, user_id: id }] });
        await agente.post('/api/mese/2026/10/precompilazione').send({ user_id: id });
      }
      const res = await meseDi(admin, A.collaboratore);
      assert.equal(res.body.registrazioni.find((r) => r.data === '2026-10-01').quantita, 4);
      const { rows } = await pool.query('SELECT count(*)::int AS n FROM time_entries WHERE user_id = $1', [id]);
      assert.equal(rows[0].n, 3);
    });

    it('le sedute PT di un altro non si modificano né si eliminano', async () => {
      const seduta = (await meseDi(admin, A.collaboratore)).body.sedute_pt[0];
      for (const agente of [r1, admin, collega]) {
        const modifica = await agente.put(`/api/sedute-pt/${seduta.id}`).send({ data: '2026-10-04', tipo: 'palestra', cliente: 'X' });
        assert.equal(modifica.status, 404);
        assert.equal((await agente.delete(`/api/sedute-pt/${seduta.id}`)).status, 404);
      }
      assert.deepEqual((await meseDi(admin, A.collaboratore)).body.sedute_pt, [seduta]);
    });
  });

  describe('cambi di ruolo', () => {
    it("valgono dalla richiesta successiva, senza un nuovo accesso", async () => {
      assert.equal((await r1.get('/api/collaboratori/2026/10')).status, 200);
      const res = await admin.patch(`/api/utenti/${A.r1.id}`).send({ ruolo: 'collaboratore' });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.settori, []);
      assert.equal((await r1.get('/api/collaboratori/2026/10')).status, 403);
      assert.equal((await r1.get('/api/auth/me')).body.utente.ruolo, 'collaboratore');

      // Promosso ad amministratore: vede subito la gestione.
      await admin.patch(`/api/utenti/${A.r1.id}`).send({ ruolo: 'amministratore' });
      assert.equal((await r1.get('/api/utenti')).status, 200);
      await admin.patch(`/api/utenti/${A.r1.id}`).send({ ruolo: 'responsabile', settori: [A.settore] });
      assert.equal((await r1.get('/api/utenti')).status, 403);
      assert.deepEqual((await r1.get('/api/auth/me')).body.utente.settori.map((s) => s.nome), ['Segreteria']);
    });

    it('i settori di un responsabile si cambiano dalla pagina del settore', async () => {
      const res = await admin.patch(`/api/settori/${A.settoreBagnini}`).send({ responsabili: [A.r1.id, A.r2.id] });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const vede = await r1.get('/api/collaboratori/2026/10');
      assert.deepEqual(vede.body.collaboratori.map((c) => c.nome).sort(), ['Carla', 'Nomeadmin', 'Nomecollab']);
      // Un collaboratore non può diventare responsabile di un settore.
      const no = await admin.patch(`/api/settori/${A.settoreBagnini}`).send({ responsabili: [A.collega.id] });
      assert.equal(no.status, 400);
    });
  });

  it('senza accesso le viste rispondono 401', async () => {
    assert.equal((await request(app).get('/api/collaboratori/2026/10')).status, 401);
  });
});
