// Inserimento delle ore, orario tipo, precompilazione, sedute di personal
// training e blocco del mese inviato.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { preparaAmbiente, nuovaApp, accedi } = require('./helpers');

async function ambiente() {
  const { pool, A, B } = await preparaAmbiente();
  // Seconda attività a ore, per superare le 24 ore in un giorno.
  const { rows } = await pool.query(
    `INSERT INTO activities (organization_id, name, unit, template_row, sort_order)
     VALUES ($1, 'Bagnino', 'ore', 5, 3) RETURNING id`,
    [A.id],
  );
  A.attivitaOre2 = rows[0].id;
  const app = nuovaApp(pool);
  return { pool, A, B, app, collab: await accedi(app, A.collaboratore.email), admin: await accedi(app, A.admin.email) };
}

const mese = async (agente, anno, m) => {
  const res = await agente.get(`/api/mese/${anno}/${m}`);
  assert.equal(res.status, 200);
  return res.body;
};
const quantitaDel = (corpoMese, data, attivita) =>
  corpoMese.registrazioni.find((r) => r.data === data && r.attivita_id === attivita)?.quantita;

describe('registrazione delle ore', () => {
  let pool, A, collab;

  before(async () => {
    ({ pool, A, collab } = await ambiente());
  });
  after(() => pool.end());

  const salva = (data, voci) => collab.put(`/api/giorni/${data}`).send({ voci });

  it('inserisce, modifica ed elimina una quantità', async () => {
    let res = await salva('2026-10-05', [{ attivita_id: A.attivitaOre, quantita: 4 }]);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.registrazioni, [{ data: '2026-10-05', attivita_id: A.attivitaOre, quantita: 4 }]);
    assert.equal(quantitaDel(await mese(collab, 2026, 10), '2026-10-05', A.attivitaOre), 4);

    // Reinserire la stessa attività nello stesso giorno aggiorna la quantità.
    res = await salva('2026-10-05', [{ attivita_id: A.attivitaOre, quantita: 6.5 }]);
    assert.equal(res.status, 200);
    const { rows } = await pool.query('SELECT quantity FROM time_entries WHERE user_id = $1 AND entry_date = $2', [
      A.collaboratore.id,
      '2026-10-05',
    ]);
    assert.deepEqual(rows, [{ quantity: 6.5 }]);

    // Portarla a zero elimina la riga.
    res = await salva('2026-10-05', [{ attivita_id: A.attivitaOre, quantita: 0 }]);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.registrazioni, []);
    assert.equal(quantitaDel(await mese(collab, 2026, 10), '2026-10-05', A.attivitaOre), undefined);
  });

  it('le attività non indicate restano invariate', async () => {
    await salva('2026-10-06', [
      { attivita_id: A.attivitaOre, quantita: 3 },
      { attivita_id: A.attivitaSedute, quantita: 2 },
    ]);
    await salva('2026-10-06', [{ attivita_id: A.attivitaOre, quantita: 5 }]);
    const m = await mese(collab, 2026, 10);
    assert.equal(quantitaDel(m, '2026-10-06', A.attivitaOre), 5);
    assert.equal(quantitaDel(m, '2026-10-06', A.attivitaSedute), 2);
  });

  it('le ore vanno a passi di 0,5', async () => {
    for (const q of [0.5, 1.5, 7, 23.5]) {
      assert.equal((await salva('2026-10-07', [{ attivita_id: A.attivitaOre, quantita: q }])).status, 200, String(q));
    }
    for (const q of [1.2, 0.25, -1, '2', null, 24.5]) {
      const res = await salva('2026-10-07', [{ attivita_id: A.attivitaOre, quantita: q }]);
      assert.equal(res.status, 400, String(q));
      assert.ok(res.body.errore);
    }
  });

  it('le sedute vanno a numeri interi', async () => {
    assert.equal((await salva('2026-10-08', [{ attivita_id: A.attivitaSedute, quantita: 3 }])).status, 200);
    const res = await salva('2026-10-08', [{ attivita_id: A.attivitaSedute, quantita: 1.5 }]);
    assert.equal(res.status, 400);
    assert.match(res.body.errore, /intero/);
    assert.equal(quantitaDel(await mese(collab, 2026, 10), '2026-10-08', A.attivitaSedute), 3);
  });

  it('rifiuta un giorno con più di 24 ore in totale', async () => {
    let res = await salva('2026-10-09', [
      { attivita_id: A.attivitaOre, quantita: 20 },
      { attivita_id: A.attivitaOre2, quantita: 4 },
    ]);
    assert.equal(res.status, 200);
    // Le sedute non entrano nel totale delle ore.
    res = await salva('2026-10-09', [{ attivita_id: A.attivitaSedute, quantita: 5 }]);
    assert.equal(res.status, 200);
    // Mezz'ora in più, anche su un'altra richiesta, è troppo.
    res = await salva('2026-10-09', [{ attivita_id: A.attivitaOre2, quantita: 4.5 }]);
    assert.equal(res.status, 400);
    assert.match(res.body.errore, /24 ore/);
    // Niente è stato modificato.
    assert.equal(quantitaDel(await mese(collab, 2026, 10), '2026-10-09', A.attivitaOre2), 4);
  });

  it('rifiuta date e mesi non validi', async () => {
    for (const data of ['2026-02-29', '2026-13-01', '2026-10-1', 'oggi', '1999-12-31']) {
      assert.equal((await salva(data, [{ attivita_id: A.attivitaOre, quantita: 1 }])).status, 400, data);
    }
    assert.equal((await collab.get('/api/mese/2026/13')).status, 400);
    assert.equal((await collab.get('/api/mese/abc/1')).status, 400);
    assert.equal((await salva('2026-10-10', [])).status, 400);
    assert.equal(
      (await salva('2026-10-10', [
        { attivita_id: A.attivitaOre, quantita: 1 },
        { attivita_id: A.attivitaOre, quantita: 2 },
      ])).status,
      400,
    );
  });

  it('le date restano giorni di calendario, senza fuso orario', async () => {
    await salva('2026-10-31', [{ attivita_id: A.attivitaOre, quantita: 2 }]);
    await salva('2026-11-01', [{ attivita_id: A.attivitaOre, quantita: 3 }]);
    const ottobre = await mese(collab, 2026, 10);
    const novembre = await mese(collab, 2026, 11);
    assert.equal(quantitaDel(ottobre, '2026-10-31', A.attivitaOre), 2);
    assert.ok(ottobre.registrazioni.every((r) => r.data.startsWith('2026-10-')));
    assert.deepEqual(novembre.registrazioni.map((r) => r.data), ['2026-11-01']);
  });

  it("un'attività disattivata non accetta nuove righe ma si può togliere", async () => {
    await salva('2026-10-12', [{ attivita_id: A.attivitaOre2, quantita: 2 }]);
    await pool.query('UPDATE activities SET active = false WHERE id = $1', [A.attivitaOre2]);
    try {
      assert.equal((await salva('2026-10-13', [{ attivita_id: A.attivitaOre2, quantita: 2 }])).status, 400);
      assert.equal((await salva('2026-10-12', [{ attivita_id: A.attivitaOre2, quantita: 0 }])).status, 200);
    } finally {
      await pool.query('UPDATE activities SET active = true WHERE id = $1', [A.attivitaOre2]);
    }
  });
});

describe('orario tipo e precompilazione', () => {
  let pool, A, collab;

  before(async () => {
    ({ pool, A, collab } = await ambiente());
  });
  after(() => pool.end());

  const orario = (voci) => collab.put('/api/orario-tipo').send({ voci });

  it("salva e rilegge l'orario tipo", async () => {
    const voci = [
      { giorno_settimana: 1, attivita_id: A.attivitaOre, quantita: 6 },
      { giorno_settimana: 1, attivita_id: A.attivitaSedute, quantita: 1 },
      { giorno_settimana: 3, attivita_id: A.attivitaOre2, quantita: 4.5 },
    ];
    assert.equal((await orario(voci)).status, 200);
    const res = await collab.get('/api/orario-tipo');
    assert.equal(res.body.voci.length, 3);
    assert.ok(res.body.voci.some((v) => v.giorno_settimana === 3 && v.quantita === 4.5));
  });

  it("rifiuta un orario tipo non valido e lascia quello precedente", async () => {
    const casi = [
      [{ giorno_settimana: 8, attivita_id: A.attivitaOre, quantita: 1 }],
      [{ giorno_settimana: 2, attivita_id: A.attivitaOre, quantita: 1.2 }],
      [
        { giorno_settimana: 2, attivita_id: A.attivitaOre, quantita: 20 },
        { giorno_settimana: 2, attivita_id: A.attivitaOre2, quantita: 5 },
      ],
    ];
    for (const voci of casi) assert.equal((await orario(voci)).status, 400, JSON.stringify(voci));
    assert.equal((await collab.get('/api/orario-tipo')).body.voci.length, 3);
  });

  it('riempie solo i giorni vuoti, non sovrascrive ed è ripetibile', async () => {
    // Novembre 2026: lunedì 2, 9, 16, 23, 30; mercoledì 4, 11, 18, 25.
    // Lunedì 9 è già compilato a mano.
    await collab.put('/api/giorni/2026-11-09').send({ voci: [{ attivita_id: A.attivitaOre2, quantita: 2 }] });

    const anteprima = await collab.get('/api/mese/2026/11/precompilazione');
    assert.equal(anteprima.status, 200);
    const attesi = ['02', '04', '11', '16', '18', '23', '25', '30'].map((g) => `2026-11-${g}`);
    assert.deepEqual(anteprima.body.giorni, attesi);

    const res = await collab.post('/api/mese/2026/11/precompilazione');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.giorni_riempiti, attesi);

    const dopo = await mese(collab, 2026, 11);
    assert.equal(quantitaDel(dopo, '2026-11-02', A.attivitaOre), 6);
    assert.equal(quantitaDel(dopo, '2026-11-02', A.attivitaSedute), 1);
    assert.equal(quantitaDel(dopo, '2026-11-04', A.attivitaOre2), 4.5);
    // Il giorno compilato a mano è intatto.
    assert.deepEqual(
      dopo.registrazioni.filter((r) => r.data === '2026-11-09'),
      [{ data: '2026-11-09', attivita_id: A.attivitaOre2, quantita: 2 }],
    );
    // Nessun altro giorno toccato.
    assert.deepEqual([...new Set(dopo.registrazioni.map((r) => r.data))].sort(), [...attesi, '2026-11-09'].sort());

    // Rieseguirla non cambia nulla.
    assert.deepEqual((await collab.get('/api/mese/2026/11/precompilazione')).body.giorni, []);
    const ancora = await collab.post('/api/mese/2026/11/precompilazione');
    assert.deepEqual(ancora.body.giorni_riempiti, []);
    assert.deepEqual(await mese(collab, 2026, 11), dopo);
  });

  it("non sovrascrive un giorno modificato dopo la precompilazione", async () => {
    await collab.put('/api/giorni/2026-11-16').send({ voci: [{ attivita_id: A.attivitaOre, quantita: 0 }, { attivita_id: A.attivitaSedute, quantita: 0 }] });
    await collab.put('/api/giorni/2026-11-18').send({ voci: [{ attivita_id: A.attivitaOre2, quantita: 1 }] });
    // Il 16 è tornato vuoto: è l'unico che viene riempito di nuovo.
    const res = await collab.post('/api/mese/2026/11/precompilazione');
    assert.deepEqual(res.body.giorni_riempiti, ['2026-11-16']);
    assert.equal(quantitaDel(await mese(collab, 2026, 11), '2026-11-18', A.attivitaOre2), 1);
  });
});

describe('sedute di personal training', () => {
  let pool, A, collab;

  before(async () => {
    ({ pool, A, collab } = await ambiente());
  });
  after(() => pool.end());

  const aggiungi = (data, tipo, cliente = 'Mario Rossi') => collab.post('/api/sedute-pt').send({ data, tipo, cliente });

  it('registra ed elimina una seduta', async () => {
    const res = await aggiungi('2026-10-03', 'acqua', '  Anna   Bianchi ');
    assert.equal(res.status, 201);
    assert.equal(res.body.cliente, 'Anna Bianchi');
    const m = await mese(collab, 2026, 10);
    assert.deepEqual(m.sedute_pt, [{ id: res.body.id, data: '2026-10-03', tipo: 'acqua', cliente: 'Anna Bianchi' }]);
    assert.equal(m.max_sedute_pt_per_tipo, 27);
    assert.equal((await collab.delete(`/api/sedute-pt/${res.body.id}`)).status, 200);
    assert.deepEqual((await mese(collab, 2026, 10)).sedute_pt, []);
    assert.equal((await collab.delete(`/api/sedute-pt/${res.body.id}`)).status, 404);
  });

  it('rifiuta dati non validi', async () => {
    assert.equal((await aggiungi('2026-10-03', 'sala')).status, 400);
    assert.equal((await aggiungi('2026-10-03', 'acqua', '   ')).status, 400);
    assert.equal((await aggiungi('2026-10-32', 'acqua')).status, 400);
    assert.equal((await aggiungi('2026-10-03', 'acqua', 'x'.repeat(101))).status, 400);
  });

  it('al massimo 27 sedute per tipo in un mese', async () => {
    for (let i = 1; i <= 27; i++) {
      const giorno = String(((i - 1) % 28) + 1).padStart(2, '0');
      assert.equal((await aggiungi(`2026-12-${giorno}`, 'acqua', `Cliente ${i}`)).status, 201, String(i));
    }
    const res = await aggiungi('2026-12-31', 'acqua');
    assert.equal(res.status, 400);
    assert.match(res.body.errore, /27 sedute/);
    assert.match(res.body.errore, /modello Excel/);
    // L'altro tipo e gli altri mesi non sono toccati dal limite.
    assert.equal((await aggiungi('2026-12-31', 'palestra')).status, 201);
    assert.equal((await aggiungi('2027-01-01', 'acqua')).status, 201);
    // Eliminandone una se ne può aggiungere un'altra.
    const { sedute_pt } = await mese(collab, 2026, 12);
    await collab.delete(`/api/sedute-pt/${sedute_pt.find((s) => s.tipo === 'acqua').id}`);
    assert.equal((await aggiungi('2026-12-31', 'acqua')).status, 201);
  });

  it("il limite viene dalla configurazione dell'organizzazione", async () => {
    await pool.query('UPDATE organizations SET pt_sessions_per_kind = 2 WHERE id = $1', [A.id]);
    try {
      assert.equal((await aggiungi('2027-02-01', 'palestra')).status, 201);
      assert.equal((await aggiungi('2027-02-02', 'palestra')).status, 201);
      assert.equal((await aggiungi('2027-02-03', 'palestra')).status, 400);
    } finally {
      await pool.query('UPDATE organizations SET pt_sessions_per_kind = 27 WHERE id = $1', [A.id]);
    }
  });
});

describe('mese inviato', () => {
  let pool, A, collab, admin, seduta;

  before(async () => {
    ({ pool, A, collab, admin } = await ambiente());
    await collab.put('/api/giorni/2026-09-10').send({ voci: [{ attivita_id: A.attivitaOre, quantita: 4 }] });
    seduta = (await collab.post('/api/sedute-pt').send({ data: '2026-09-10', tipo: 'acqua', cliente: 'C' })).body;
    await collab.put('/api/orario-tipo').send({ voci: [{ giorno_settimana: 1, attivita_id: A.attivitaOre, quantita: 2 }] });
    for (const utente of [A.collaboratore, A.admin]) {
      await pool.query(
        `INSERT INTO month_submissions (organization_id, user_id, year, month, status, submitted_at)
         VALUES ($1, $2, 2026, 9, 'inviato', now())`,
        [A.id, utente.id],
      );
    }
  });
  after(() => pool.end());

  it('si legge e risulta inviato', async () => {
    const m = await mese(collab, 2026, 9);
    assert.equal(m.stato, 'inviato');
    assert.equal(quantitaDel(m, '2026-09-10', A.attivitaOre), 4);
    assert.equal((await mese(collab, 2026, 10)).stato, 'aperto');
  });

  it('registrazioni e sedute sono in sola lettura', async () => {
    const tentativi = [
      collab.put('/api/giorni/2026-09-10').send({ voci: [{ attivita_id: A.attivitaOre, quantita: 5 }] }),
      collab.put('/api/giorni/2026-09-10').send({ voci: [{ attivita_id: A.attivitaOre, quantita: 0 }] }),
      collab.put('/api/giorni/2026-09-11').send({ voci: [{ attivita_id: A.attivitaOre, quantita: 1 }] }),
      collab.post('/api/mese/2026/9/precompilazione'),
      collab.post('/api/sedute-pt').send({ data: '2026-09-12', tipo: 'palestra', cliente: 'C' }),
      collab.delete(`/api/sedute-pt/${seduta.id}`),
      // Vale anche per l'amministratore.
      admin.put('/api/giorni/2026-09-11').send({ voci: [{ attivita_id: A.attivitaOre, quantita: 1 }] }),
    ];
    for (const res of await Promise.all(tentativi)) {
      assert.equal(res.status, 409, `${res.req.method} ${res.req.path}`);
      assert.match(res.body.errore, /settembre 2026 è già stato inviato/);
    }
    const m = await mese(collab, 2026, 9);
    assert.deepEqual(m.registrazioni, [{ data: '2026-09-10', attivita_id: A.attivitaOre, quantita: 4 }]);
    assert.equal(m.sedute_pt.length, 1);
  });

  it('gli altri mesi restano modificabili', async () => {
    assert.equal(
      (await collab.put('/api/giorni/2026-10-01').send({ voci: [{ attivita_id: A.attivitaOre, quantita: 1 }] })).status,
      200,
    );
  });
});

describe("dati personali: un utente non vede né modifica quelli di un altro", () => {
  let pool, A, collab, admin, seduta;

  before(async () => {
    ({ pool, A, collab, admin } = await ambiente());
    await collab.put('/api/giorni/2026-10-05').send({ voci: [{ attivita_id: A.attivitaOre, quantita: 4 }] });
    await collab.put('/api/orario-tipo').send({ voci: [{ giorno_settimana: 1, attivita_id: A.attivitaOre, quantita: 4 }] });
    await collab.put('/api/mie-attivita').send({ attivita: [A.attivitaOre] });
    seduta = (await collab.post('/api/sedute-pt').send({ data: '2026-10-05', tipo: 'acqua', cliente: 'Cliente' })).body;
  });
  after(() => pool.end());

  it("l'amministratore della stessa organizzazione non legge i dati del collaboratore", async () => {
    const m = await mese(admin, 2026, 10);
    assert.deepEqual(m.registrazioni, []);
    assert.deepEqual(m.sedute_pt, []);
    assert.deepEqual((await admin.get('/api/orario-tipo')).body.voci, []);
    assert.deepEqual((await admin.get('/api/mie-attivita')).body.attivita, []);
    assert.deepEqual((await admin.get('/api/mese/2026/11/precompilazione')).body.giorni, []);
  });

  it("l'utente indicato nella richiesta viene ignorato", async () => {
    const id = A.collaboratore.id;
    const m = (await admin.get(`/api/mese/2026/10?utente=${id}&user_id=${id}`)).body;
    assert.deepEqual(m.registrazioni, []);
    // Le quantità scritte con user_id nel corpo finiscono all'autore della richiesta.
    const res = await admin
      .put(`/api/giorni/2026-10-05?user_id=${id}`)
      .send({ user_id: id, utente: id, voci: [{ attivita_id: A.attivitaOre, quantita: 1, user_id: id }] });
    assert.equal(res.status, 200);
    assert.equal(quantitaDel(await mese(collab, 2026, 10), '2026-10-05', A.attivitaOre), 4);
    assert.equal(quantitaDel(await mese(admin, 2026, 10), '2026-10-05', A.attivitaOre), 1);
    await admin.post('/api/sedute-pt').send({ user_id: id, data: '2026-10-06', tipo: 'acqua', cliente: 'X' });
    assert.equal((await mese(collab, 2026, 10)).sedute_pt.length, 1);
  });

  it("non può eliminare le sedute del collaboratore", async () => {
    const res = await admin.delete(`/api/sedute-pt/${seduta.id}`);
    assert.equal(res.status, 404);
    assert.equal((await mese(collab, 2026, 10)).sedute_pt.length, 1);
  });

  it("modificare il proprio orario o le proprie attività non tocca quelli degli altri", async () => {
    await admin.put('/api/orario-tipo').send({ voci: [] });
    await admin.put('/api/mie-attivita').send({ attivita: [] });
    await admin.post('/api/mese/2026/12/precompilazione');
    assert.equal((await collab.get('/api/orario-tipo')).body.voci.length, 1);
    assert.deepEqual((await collab.get('/api/mie-attivita')).body.attivita, [A.attivitaOre]);
    assert.deepEqual((await mese(collab, 2026, 12)).registrazioni, []);
  });
});

describe('le mie attività', () => {
  let pool, A, B, collab;

  before(async () => {
    ({ pool, A, B, collab } = await ambiente());
  });
  after(() => pool.end());

  it("salva e sostituisce l'elenco", async () => {
    let res = await collab.put('/api/mie-attivita').send({ attivita: [A.attivitaOre, A.attivitaSedute, A.attivitaOre] });
    assert.equal(res.status, 200);
    assert.deepEqual((await collab.get('/api/mie-attivita')).body.attivita, [A.attivitaOre, A.attivitaSedute]);
    res = await collab.put('/api/mie-attivita').send({ attivita: [A.attivitaOre2] });
    assert.deepEqual((await collab.get('/api/mie-attivita')).body.attivita, [A.attivitaOre2]);
  });

  it("un'attività inesistente o di un'altra organizzazione risponde 404 e non cambia nulla", async () => {
    for (const id of [B.attivitaOre, 'non-un-id', '00000000-0000-0000-0000-000000000000']) {
      const res = await collab.put('/api/mie-attivita').send({ attivita: [A.attivitaOre, id] });
      assert.equal(res.status, 404, id);
    }
    assert.deepEqual((await collab.get('/api/mie-attivita')).body.attivita, [A.attivitaOre2]);
  });
});
