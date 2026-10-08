// Correzioni rapide delle ore: annullare l'ultima precompilazione, svuotare
// uno o più giorni. Solo sui propri mesi aperti.
// Novembre 2026: i lunedì sono 2, 9, 16, 23, 30; i martedì 3, 10, 17, 24.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { preparaAmbiente, nuovaApp, accedi } = require('./helpers');

describe('correzioni rapide delle ore', () => {
  let pool, A, collab, admin;

  before(async () => {
    ({ pool, A } = await preparaAmbiente());
    A.attivitaOre2 = (
      await pool.query(
        `INSERT INTO activities (organization_id, name, template_label, unit, template_row, sort_order)
         VALUES ($1, 'Bagnino', 'Bagnino', 'ore', 5, 3) RETURNING id`,
        [A.id],
      )
    ).rows[0].id;
    const app = nuovaApp(pool);
    collab = await accedi(app, A.collaboratore.email);
    admin = await accedi(app, A.admin.email);
    // Orario tipo: lunedì 4 h Segreteria, martedì 3 h Bagnino.
    const orario = await collab.put('/api/orario-tipo').send({
      voci: [
        { giorno_settimana: 1, attivita_id: A.attivitaOre, quantita: 4 },
        { giorno_settimana: 2, attivita_id: A.attivitaOre2, quantita: 3 },
      ],
    });
    assert.equal(orario.status, 200);
  });
  after(() => pool.end());

  const salva = async (agente, data, voci) => {
    const res = await agente.put(`/api/giorni/${data}`).send({ voci });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  };
  const righe = async (agente, anno, mese) =>
    (await agente.get(`/api/mese/${anno}/${mese}`)).body.registrazioni.map((r) => `${r.data} ${r.attivita_id === A.attivitaOre ? 'S' : 'B'} ${r.quantita}`).sort();

  describe('annulla precompilazione', () => {
    it("toglie solo le righe dell'ultima precompilazione non modificate a mano", async () => {
      // Il 2 era già compilato a mano: la precompilazione non lo tocca.
      await salva(collab, '2026-11-02', [{ attivita_id: A.attivitaOre2, quantita: 8 }]);
      const pre = await collab.post('/api/mese/2026/11/precompilazione');
      assert.equal(pre.body.giorni_riempiti.length, 8);
      // Dopo: il 9 corretto a mano, il 16 con un'attività aggiunta a mano,
      // il 23 "salvato" con lo stesso valore (non è una modifica).
      await salva(collab, '2026-11-09', [{ attivita_id: A.attivitaOre, quantita: 5 }]);
      await salva(collab, '2026-11-16', [{ attivita_id: A.attivitaOre2, quantita: 1 }]);
      await salva(collab, '2026-11-23', [{ attivita_id: A.attivitaOre, quantita: 4 }]);

      const anteprima = (await collab.get('/api/mese/2026/11/annulla-precompilazione')).body;
      assert.deepEqual(anteprima.giorni, ['2026-11-03', '2026-11-10', '2026-11-16', '2026-11-17', '2026-11-23', '2026-11-24', '2026-11-30']);
      assert.equal(anteprima.ore, 4 * 3 + 3 * 4);
      assert.equal(anteprima.righe, 7);
      assert.equal((await collab.get('/api/mese/2026/11')).body.precompilazione_annullabile, 7);
      // L'anteprima non cambia nulla.
      assert.equal((await righe(collab, 2026, 11)).length, 10);

      const res = await collab.post('/api/mese/2026/11/annulla-precompilazione');
      assert.equal(res.status, 200);
      assert.equal(res.body.giorni.length, 7);
      assert.deepEqual(await righe(collab, 2026, 11), ['2026-11-02 B 8', '2026-11-09 S 5', '2026-11-16 B 1']);
      // Niente più da annullare.
      assert.equal((await collab.post('/api/mese/2026/11/annulla-precompilazione')).status, 409);
      assert.deepEqual((await collab.get('/api/mese/2026/11/annulla-precompilazione')).body.giorni, []);
      assert.equal((await collab.get('/api/mese/2026/11')).body.precompilazione_annullabile, 0);
    });

    it("annulla l'ultima precompilazione, non le precedenti", async () => {
      await collab.post('/api/mese/2026/11/precompilazione'); // riempie 3, 10, 17, 23, 24, 30
      await collab.post('/api/mese/2026/11/svuota').send({ giorni: ['2026-11-03', '2026-11-10'] });
      const seconda = await collab.post('/api/mese/2026/11/precompilazione');
      assert.deepEqual(seconda.body.giorni_riempiti, ['2026-11-03', '2026-11-10']);
      const res = await collab.post('/api/mese/2026/11/annulla-precompilazione');
      assert.deepEqual(res.body.giorni, ['2026-11-03', '2026-11-10']);
      const rimaste = await righe(collab, 2026, 11);
      assert.ok(rimaste.includes('2026-11-17 B 3') && rimaste.includes('2026-11-30 S 4'));
      assert.ok(!rimaste.some((r) => r.startsWith('2026-11-03') || r.startsWith('2026-11-10')));
      // Una precompilazione che non riempie nulla non diventa "l'ultima".
      assert.equal((await collab.post('/api/mese/2026/11/precompilazione')).body.giorni_riempiti.length, 2);
      assert.equal((await collab.post('/api/mese/2026/11/precompilazione')).body.giorni_riempiti.length, 0);
      assert.deepEqual((await collab.get('/api/mese/2026/11/annulla-precompilazione')).body.giorni, ['2026-11-03', '2026-11-10']);
    });

    it("non tocca le registrazioni degli altri utenti", async () => {
      await salva(admin, '2026-11-03', [{ attivita_id: A.attivitaOre, quantita: 2 }]);
      assert.equal((await admin.post('/api/mese/2026/11/annulla-precompilazione')).status, 409);
      await collab.post('/api/mese/2026/11/annulla-precompilazione');
      assert.deepEqual(await righe(admin, 2026, 11), ['2026-11-03 S 2']);
    });
  });

  describe('svuota giorni', () => {
    it('svuota uno o più giorni e dice quante ore ha tolto', async () => {
      await salva(collab, '2026-12-01', [
        { attivita_id: A.attivitaOre, quantita: 2 },
        { attivita_id: A.attivitaSedute, quantita: 3 },
      ]);
      await salva(collab, '2026-12-02', [{ attivita_id: A.attivitaOre2, quantita: 6.5 }]);
      await salva(collab, '2026-12-03', [{ attivita_id: A.attivitaOre, quantita: 1 }]);
      const seduta = await collab.post('/api/sedute-pt').send({ data: '2026-12-01', tipo: 'acqua', cliente: 'Cliente' });
      assert.equal(seduta.status, 201);
      await salva(admin, '2026-12-01', [{ attivita_id: A.attivitaOre, quantita: 7 }]);

      // Un giorno solo (la "Svuota giorno" della scheda).
      let res = await collab.post('/api/mese/2026/12/svuota').send({ giorni: ['2026-12-03'] });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { giorni: ['2026-12-03'], righe: 1, ore: 1, sedute: 0 });

      // Più giorni, anche vuoti o ripetuti.
      res = await collab.post('/api/mese/2026/12/svuota').send({ giorni: ['2026-12-01', '2026-12-02', '2026-12-31', '2026-12-02'] });
      assert.deepEqual(res.body, { giorni: ['2026-12-01', '2026-12-02'], righe: 3, ore: 8.5, sedute: 3 });
      const dicembre = (await collab.get('/api/mese/2026/12')).body;
      assert.deepEqual(dicembre.registrazioni, []);
      // Le sedute PT con il cliente restano; l'amministratore non perde nulla.
      assert.equal(dicembre.sedute_pt.length, 1);
      assert.deepEqual(await righe(admin, 2026, 12), ['2026-12-01 S 7']);
    });

    it('rifiuta giorni non validi o di un altro mese', async () => {
      for (const giorni of [[], undefined, ['2026-11-30'], ['2026-12-32'], ['ieri'], Array(32).fill('2026-12-01')]) {
        const res = await collab.post('/api/mese/2026/12/svuota').send({ giorni });
        assert.equal(res.status, 400, JSON.stringify(giorni));
      }
    });
  });

  describe('mese inviato', () => {
    it('niente annullamento né svuotamento: 409 e dati invariati', async () => {
      await collab.post('/api/mese/2027/1/precompilazione');
      const prima = await righe(collab, 2027, 1);
      assert.ok(prima.length > 0);
      await pool.query(
        `INSERT INTO month_submissions (organization_id, user_id, year, month, status, submitted_at)
         VALUES ($1, $2, 2027, 1, 'inviato', now())`,
        [A.id, A.collaboratore.id],
      );
      assert.equal((await collab.post('/api/mese/2027/1/annulla-precompilazione')).status, 409);
      assert.equal((await collab.post('/api/mese/2027/1/svuota').send({ giorni: ['2027-01-04', '2027-01-05'] })).status, 409);
      assert.deepEqual(await righe(collab, 2027, 1), prima);
    });
  });
});
