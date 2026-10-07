// Esportazione del file Excel mensile sul modello reale di BV: il file viene
// generato dall'API, riletto e confrontato con il modello e con i dati
// dell'app. Sono i controlli del prototipo della Fase 0, portati qui.
// Servono il modello (MODELLO_BV) e la configurazione di BV (SEED_DIR), montati
// nel servizio api-test di docker-compose.yml.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { preparaAmbiente, nuovaApp, accedi, PASSWORD } = require('./helpers');
const { hashPassword } = require('../src/password');
const { caricaOrganizzazione, leggiJson, ErroreGiaConfigurata } = require('../src/cli/carica-organizzazione');
const { generaFoglioMensile, ErroreModello } = require('../src/excel/foglio-mensile');
const { validaLayout, letteraColonna } = require('../src/excel/layout');

const MODELLO_BV = process.env.MODELLO_BV;
const SEED_BV = path.join(process.env.SEED_DIR ?? path.join(__dirname, '..', '..', 'seed'), 'bv');
if (!MODELLO_BV || !fs.existsSync(MODELLO_BV)) {
  throw new Error(`Modello Excel di BV non trovato (MODELLO_BV=${MODELLO_BV}): i test dell'esportazione lo richiedono`);
}

// Posizioni del modello di BV, scritte qui a mano e non lette dalla mappa:
// i test devono accorgersi anche di una mappa sbagliata.
const COLONNA_GIORNO = (g) => letteraColonna(4 + g); // 1 = E … 31 = AI
const PT = { palestra: { data: 'AL', cliente: 'AM' }, acqua: { data: 'AN', cliente: 'AO' } };

const confBv = (slug = 'bv') => ({ ...leggiJson(path.join(SEED_BV, 'organizzazione.json')), slug, nome: slug.toUpperCase() });
const modelloBv = () => ({ buffer: fs.readFileSync(MODELLO_BV), nomeFile: path.basename(MODELLO_BV) });
const caricaBv = (pool, slug, sovrascrivi = false) =>
  caricaOrganizzazione(pool, {
    conf: confBv(slug),
    contatti: { emailInvio: `segreteria@${slug}.test`, responsabili: {} },
    abbinamenti: leggiJson(path.join(SEED_BV, 'abbinamenti.json')),
    modello: modelloBv(),
    sovrascrivi,
  });

async function creaUtente(pool, orgId, email, nome, cognome, hash, ruolo = 'collaboratore') {
  const { rows } = await pool.query(
    `INSERT INTO users (organization_id, email, first_name, last_name, role, password_hash)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [orgId, email, nome, cognome, ruolo, hash],
  );
  return rows[0].id;
}

// Copia del modello di BV con alcune celle cambiate: { D30: 'Nuovo nome' }.
async function modelloModificato(celle, nomeFoglio = 'Foglio1') {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(fs.readFileSync(MODELLO_BV));
  const ws = wb.getWorksheet('Foglio1');
  for (const [cella, valore] of Object.entries(celle)) ws.getCell(cella).value = valore;
  ws.name = nomeFoglio;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// Scarica il file del mese; il corpo è sempre un Buffer.
const scarica = (agente, anno, mese, query = '') =>
  agente
    .get(`/api/mese/${anno}/${mese}/excel${query}`)
    .buffer(true)
    .parse((res, fine) => {
      const parti = [];
      res.on('data', (d) => parti.push(d));
      res.on('end', () => fine(null, Buffer.concat(parti)));
    });

async function foglio(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb.getWorksheet('Foglio1');
}

const iso = (d) => d.toISOString().slice(0, 10);
const giorniNelMese = (anno, mese) => new Date(Date.UTC(anno, mese, 0)).getUTCDate();

describe('esportazione Excel', () => {
  let pool, app, bv, attivita, modello;
  let petris, desantis, altroImpianto, collabA;

  before(async () => {
    let A;
    ({ pool, A } = await preparaAmbiente());
    bv = await caricaBv(pool, 'bv');
    const bv2 = await caricaBv(pool, 'bv2');
    const hash = await hashPassword(PASSWORD);
    await creaUtente(pool, bv.orgId, 'petris@bv.test', 'Andrea', 'Petris', hash);
    await creaUtente(pool, bv.orgId, 'desantis@bv.test', 'Giulia', 'De Santis', hash);
    await creaUtente(pool, bv2.orgId, 'rossi@bv2.test', 'Mario', 'Rossi', hash);
    const { rows } = await pool.query('SELECT id, name, template_row, unit FROM activities WHERE organization_id = $1', [
      bv.orgId,
    ]);
    attivita = Object.fromEntries(rows.map((r) => [r.name, r]));
    app = nuovaApp(pool);
    petris = await accedi(app, 'petris@bv.test');
    desantis = await accedi(app, 'desantis@bv.test');
    altroImpianto = await accedi(app, 'rossi@bv2.test');
    collabA = await accedi(app, A.collaboratore.email);
    modello = await foglio(fs.readFileSync(MODELLO_BV));
  });
  after(() => pool.end());

  const salva = async (agente, data, voci) => {
    const res = await agente
      .put(`/api/giorni/${data}`)
      .send({ voci: Object.entries(voci).map(([nome, quantita]) => ({ attivita_id: attivita[nome].id, quantita })) });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  };
  const seduta = async (agente, data, tipo, cliente) => {
    const res = await agente.post('/api/sedute-pt').send({ data, tipo, cliente });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  };

  // Struttura e aspetto identici al modello: celle unite, larghezze, altezze,
  // stampa, stili cella per cella, regolamento. Unica differenza ammessa: il
  // formato data nelle celle delle sedute PT compilate.
  function verificaAspetto(ws) {
    const ordina = (v) =>
      v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, ordina(v[k])])) : v;
    const uguale = (a, b) => JSON.stringify(ordina(a)) === JSON.stringify(ordina(b));
    const problemi = [];
    if (!uguale([...ws.model.merges].sort(), [...modello.model.merges].sort())) problemi.push('celle unite diverse');
    for (let c = 1; c <= 41; c++) if (ws.getColumn(c).width !== modello.getColumn(c).width) problemi.push(`larghezza colonna ${c}`);
    for (let r = 1; r <= 49; r++) if (ws.getRow(r).height !== modello.getRow(r).height) problemi.push(`altezza riga ${r}`);
    const { firstPageNumber: _a, ...stampa } = ws.pageSetup;
    const { firstPageNumber: _b, ...stampaModello } = modello.pageSetup;
    if (!uguale(stampa, stampaModello)) problemi.push('impostazioni di pagina diverse');
    for (let r = 1; r <= 50; r++) {
      for (let c = 1; c <= 42; c++) {
        const a = ws.getCell(r, c);
        const b = modello.getCell(r, c);
        for (const k of ['border', 'fill', 'font', 'alignment', 'protection']) {
          if (!uguale(a[k] ?? null, b[k] ?? null)) problemi.push(`${k} diverso in ${a.address}`);
        }
        const dataPt = (c === 38 || c === 40) && r >= 6 && r <= 32 && a.value instanceof Date;
        if (!dataPt && (a.numFmt ?? null) !== (b.numFmt ?? null)) problemi.push(`formato numero diverso in ${a.address}`);
      }
    }
    if (ws.getCell('B35').value !== modello.getCell('B35').value) problemi.push('regolamento diverso');
    assert.deepEqual(problemi, []);
  }

  // Intestazione, colonne dei giorni inesistenti vuote, formule dei totali
  // conservate e con il risultato corretto. Restituisce i totali per riga.
  function verificaMese(ws, anno, mese, nome, cognome) {
    const nGiorni = giorniNelMese(anno, mese);
    const sigle = ['DO', 'LU', 'MA', 'ME', 'GI', 'VE', 'SA'];
    const nomiMesi = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre',
      'Ottobre', 'Novembre', 'Dicembre'];
    assert.equal(ws.getCell('B2').value, nomiMesi[mese - 1]);
    assert.equal(ws.getCell('B4').value, nome);
    assert.equal(ws.getCell('C4').value, cognome);
    for (let g = 1; g <= 31; g++) {
      const col = COLONNA_GIORNO(g);
      if (g <= nGiorni) {
        assert.equal(ws.getCell(`${col}2`).value, g);
        assert.equal(ws.getCell(`${col}3`).value, sigle[new Date(Date.UTC(anno, mese - 1, g)).getUTCDay()], `sigla ${g}`);
      } else {
        for (let r = 2; r <= 33; r++) assert.equal(ws.getCell(`${col}${r}`).value, null, `${col}${r} dovrebbe essere vuota`);
      }
    }
    const totali = {};
    let generale = 0;
    for (let r = 4; r <= 33; r++) {
      let somma = 0;
      for (let g = 1; g <= 31; g++) {
        const v = ws.getCell(`${COLONNA_GIORNO(g)}${r}`).value;
        if (v != null) {
          assert.equal(typeof v, 'number', `${COLONNA_GIORNO(g)}${r}`);
          somma += v;
        }
      }
      const t = ws.getCell(`AJ${r}`);
      assert.equal(t.formula, `SUM(E${r}:AI${r})`, `formula AJ${r}`);
      assert.equal(t.result, somma, `risultato AJ${r}`);
      totali[r] = somma;
      generale += somma;
    }
    assert.equal(ws.getCell('AJ34').formula, 'SUM(AJ4:AJ33)');
    assert.equal(ws.getCell('AJ34').result, generale);
    return { totali, generale };
  }

  const tabellaPt = (ws, tipo) => {
    const righe = [];
    for (let r = 6; r <= 32; r++) {
      const data = ws.getCell(`${PT[tipo].data}${r}`);
      const cliente = ws.getCell(`${PT[tipo].cliente}${r}`).value;
      if (data.value == null && cliente == null) continue;
      assert.ok(data.value instanceof Date, `${data.address} non è una data`);
      assert.equal(data.numFmt, 'dd/mm/yyyy', data.address);
      righe.push([r, iso(data.value), cliente]);
    }
    return righe;
  };

  it('compila il mese di ottobre 2026 nelle celle giuste', async () => {
    await salva(petris, '2026-10-01', { Segreteria: 4 });
    await salva(petris, '2026-10-02', { Segreteria: 3.5 });
    await salva(petris, '2026-10-31', { Segreteria: 0.5, Bagnino: 2 });
    await salva(petris, '2026-10-05', { Bagnino: 6 });
    await salva(petris, '2026-10-06', { 'NUOTO AGONISTICO': 2 });
    await salva(petris, '2026-10-03', { 'PT H2O singola': 2 });
    await salva(petris, '2026-10-20', { 'PT H2O singola': 1 });
    await salva(petris, '2026-10-07', { 'PT Pal. singola': 1 });
    // Inserite fuori ordine: nel file vanno in ordine di data.
    await seduta(petris, '2026-10-15', 'palestra', 'Cliente Due');
    await seduta(petris, '2026-10-07', 'palestra', 'Cliente Uno');
    await seduta(petris, '2026-10-20', 'acqua', 'Cliente Quattro');
    await seduta(petris, '2026-10-03', 'acqua', 'Cliente Tre');
    await seduta(petris, '2026-10-03', 'acqua', 'Cliente Cinque');

    const res = await scarica(petris, 2026, 10);
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.match(res.headers['content-disposition'], /^attachment; filename="10_Ottobre_2026_Petris\.xlsx"$/);
    assert.equal(res.headers['cache-control'], 'no-store');
    const ws = await foglio(res.body);

    verificaAspetto(ws);
    const { totali, generale } = verificaMese(ws, 2026, 10, 'Andrea', 'Petris');
    // 1/10/2026 è giovedì.
    assert.deepEqual([ws.getCell('E3').value, ws.getCell('F3').value, ws.getCell('I3').value], ['GI', 'VE', 'LU']);

    const riga = (nome) => attivita[nome].template_row;
    const cella = (g, nome) => ws.getCell(`${COLONNA_GIORNO(g)}${riga(nome)}`).value;
    assert.equal(cella(1, 'Segreteria'), 4);
    assert.equal(cella(2, 'Segreteria'), 3.5);
    assert.equal(cella(31, 'Segreteria'), 0.5);
    assert.equal(cella(31, 'Bagnino'), 2);
    assert.equal(cella(5, 'Bagnino'), 6);
    assert.equal(riga('NUOTO AGONISTICO'), 29);
    assert.equal(ws.getCell('J29').value, 2); // 6 ottobre = colonna J
    // Le attività a sedute scrivono il numero di sedute nella loro riga.
    assert.equal(cella(3, 'PT H2O singola'), 2);
    assert.equal(cella(20, 'PT H2O singola'), 1);
    assert.equal(cella(7, 'PT Pal. singola'), 1);
    // Il modello conteneva valori di esempio e trattini nella riga 29: spariti.
    for (let g = 1; g <= 31; g++) if (g !== 6) assert.equal(ws.getCell(`${COLONNA_GIORNO(g)}29`).value, null);

    // Totali per attività uguali a quelli che mostra l'app.
    const mese = (await petris.get('/api/mese/2026/10')).body;
    const perAttivita = {};
    for (const r of mese.registrazioni) perAttivita[r.attivita_id] = (perAttivita[r.attivita_id] ?? 0) + r.quantita;
    for (const a of Object.values(attivita)) {
      assert.equal(totali[a.template_row], perAttivita[a.id] ?? 0, `totale di ${a.name}`);
    }

    // Totale generale del modello = ore + sedute; l'app mostra solo le ore.
    const ore = mese.registrazioni.filter((r) => r.quantita && !isSedute(r.attivita_id)).reduce((s, r) => s + r.quantita, 0);
    const sedute = mese.registrazioni.filter((r) => isSedute(r.attivita_id)).reduce((s, r) => s + r.quantita, 0);
    assert.equal(ore, 18);
    assert.equal(sedute, 4);
    assert.equal(generale, 22);

    assert.deepEqual(tabellaPt(ws, 'palestra'), [
      [6, '2026-10-07', 'Cliente Uno'],
      [7, '2026-10-15', 'Cliente Due'],
    ]);
    assert.deepEqual(tabellaPt(ws, 'acqua'), [
      [6, '2026-10-03', 'Cliente Tre'],
      [7, '2026-10-03', 'Cliente Cinque'],
      [8, '2026-10-20', 'Cliente Quattro'],
    ]);

    // Le formule vengono ricalcolate all'apertura (ExcelJS non rilegge calcPr).
    const zip = await JSZip.loadAsync(res.body);
    const workbookXml = await zip.file('xl/workbook.xml').async('string');
    assert.match(workbookXml, /<calcPr[^>]*fullCalcOnLoad="1"/);
    const fogli = zip.file(/^xl\/worksheets\/sheet\d+\.xml$/);
    assert.equal(fogli.length, 1);
    assert.doesNotMatch(await fogli[0].async('string'), /useFirstPageNumber/);
    const core = await zip.file('docProps/core.xml').async('string');
    assert.match(core, /<cp:lastModifiedBy>Andrea Petris<\/cp:lastModifiedBy>/);
  });

  const isSedute = (id) => Object.values(attivita).find((a) => a.id === id)?.unit === 'sedute';

  it('febbraio di 28 giorni: le colonne 29, 30 e 31 restano vuote', async () => {
    await salva(desantis, '2027-02-01', { Bagnino: 5.5 });
    await salva(desantis, '2027-02-28', { Bagnino: 6, 'Sala pesi domenica': 1.5 });
    const res = await scarica(desantis, 2027, 2);
    assert.equal(res.status, 200);
    assert.match(res.headers['content-disposition'], /filename="02_Febbraio_2027_De_Santis\.xlsx"/);
    const ws = await foglio(res.body);
    verificaAspetto(ws);
    const { generale } = verificaMese(ws, 2027, 2, 'Giulia', 'De Santis');
    assert.equal(generale, 13);
    assert.equal(ws.getCell(`AF${attivita.Bagnino.template_row}`).value, 6); // 28 = AF
    assert.equal(ws.getCell('AF3').value, 'DO');
    for (const col of ['AG', 'AH', 'AI']) assert.equal(ws.getCell(`${col}2`).value, null);
  });

  it('27 sedute PT per tipo riempiono entrambe le tabelle fino alla riga 32', async () => {
    for (let i = 0; i < 27; i++) {
      const data = `2026-11-${String((i % 30) + 1).padStart(2, '0')}`;
      await seduta(desantis, data, 'palestra', `Palestra ${i + 1}`);
      await seduta(desantis, data, 'acqua', `Acqua ${i + 1}`);
    }
    // La ventottesima non entra nel modello: l'API la rifiuta.
    const oltre = await desantis.post('/api/sedute-pt').send({ data: '2026-11-30', tipo: 'acqua', cliente: 'Troppe' });
    assert.equal(oltre.status, 400);

    const res = await scarica(desantis, 2026, 11);
    assert.equal(res.status, 200);
    const ws = await foglio(res.body);
    verificaAspetto(ws);
    verificaMese(ws, 2026, 11, 'Giulia', 'De Santis');
    for (const tipo of ['palestra', 'acqua']) {
      const righe = tabellaPt(ws, tipo);
      assert.equal(righe.length, 27);
      assert.deepEqual(righe.map(([r]) => r), Array.from({ length: 27 }, (_, i) => i + 6));
      const date = righe.map(([, d]) => d);
      assert.deepEqual(date, [...date].sort());
      assert.equal(righe[26][2], tipo === 'palestra' ? 'Palestra 27' : 'Acqua 27');
    }
    // Le intestazioni delle tabelle non sono toccate.
    for (const c of ['AL3', 'AN3', 'AL5', 'AM5', 'AN5', 'AO5']) assert.equal(ws.getCell(c).value, modello.getCell(c).value, c);
  });

  it('ogni utente scarica solo il proprio mese', async () => {
    // De Santis non ha registrato nulla a ottobre: il suo file è vuoto, anche
    // provando a indicare l'utente o l'organizzazione nella richiesta.
    const { rows } = await pool.query("SELECT id FROM users WHERE email = 'petris@bv.test'");
    for (const query of ['', `?utente=${rows[0].id}&user_id=${rows[0].id}&organization_id=${bv.orgId}`]) {
      const res = await scarica(desantis, 2026, 10, query);
      assert.equal(res.status, 200);
      assert.match(res.headers['content-disposition'], /De_Santis/);
      const ws = await foglio(res.body);
      const { generale } = verificaMese(ws, 2026, 10, 'Giulia', 'De Santis');
      assert.equal(generale, 0);
      assert.deepEqual(tabellaPt(ws, 'acqua'), []);
    }
    // Un utente di un altro impianto con lo stesso modello: solo i suoi dati.
    const altro = await scarica(altroImpianto, 2026, 10);
    assert.equal(altro.status, 200);
    const ws = await foglio(altro.body);
    assert.equal(verificaMese(ws, 2026, 10, 'Mario', 'Rossi').generale, 0);
    assert.deepEqual(tabellaPt(ws, 'palestra'), []);
    // Senza accesso non si scarica nulla.
    const anonimo = await scarica(require('supertest')(app), 2026, 10);
    assert.equal(anonimo.status, 401);
  });

  it('il mese inviato si scarica come quello aperto', async () => {
    await pool.query(
      `INSERT INTO month_submissions (organization_id, user_id, year, month, status, submitted_at)
       SELECT organization_id, id, 2026, 10, 'inviato', now() FROM users WHERE email = 'petris@bv.test'`,
    );
    const res = await scarica(petris, 2026, 10);
    assert.equal(res.status, 200);
    assert.equal(verificaMese(await foglio(res.body), 2026, 10, 'Andrea', 'Petris').generale, 22);
  });

  it('mese non valido, impianto senza modello, modello non allineato', async () => {
    assert.equal((await scarica(petris, 2026, 13)).status, 400);
    assert.equal((await scarica(petris, 1999, 1)).status, 400);

    const senzaModello = await scarica(collabA, 2026, 10);
    assert.equal(senzaModello.status, 503);
    assert.match(JSON.parse(senzaModello.body).errore, /modello Excel/);

    // Il nome della riga nel modello non corrisponde più all'attività: niente
    // file sbagliato, ma un errore chiaro.
    await pool.query("UPDATE activities SET template_label = 'Rinominata' WHERE id = $1", [attivita.Danza.id]);
    try {
      const res = await scarica(petris, 2026, 10);
      assert.equal(res.status, 500);
      assert.match(JSON.parse(res.body).errore, /riga \d+ il modello ha "Danza" invece di "Rinominata"/);
    } finally {
      await pool.query("UPDATE activities SET template_label = 'Danza' WHERE id = $1", [attivita.Danza.id]);
    }
  });

  it("un'attività rinominata dall'app si esporta con il nome del modello", async () => {
    await creaUtente(pool, bv.orgId, 'admin@bv.test', 'Ada', 'Admin', await hashPassword(PASSWORD), 'amministratore');
    const admin = await accedi(app, 'admin@bv.test');
    const r = await admin.patch(`/api/attivita/${attivita.Danza.id}`).send({ nome: 'Danza moderna' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.nome, 'Danza moderna');
    assert.equal(r.body.nome_modello, 'Danza');
    try {
      await salva(petris, '2026-12-09', { Danza: 1.5 });
      const res = await scarica(petris, 2026, 12);
      assert.equal(res.status, 200);
      const ws = await foglio(res.body);
      verificaAspetto(ws);
      const riga = attivita.Danza.template_row;
      assert.equal(ws.getCell(`D${riga}`).value, modello.getCell(`D${riga}`).value);
      assert.equal(ws.getCell(`${COLONNA_GIORNO(9)}${riga}`).value, 1.5);
    } finally {
      await salva(petris, '2026-12-09', { Danza: 0 });
      await admin.patch(`/api/attivita/${attivita.Danza.id}`).send({ nome: 'Danza' });
    }
  });

  it('carica-organizzazione si rifiuta su un impianto già configurato', async () => {
    await assert.rejects(caricaBv(pool, 'bv'), (err) => err instanceof ErroreGiaConfigurata && /--sovrascrivi/.test(err.message));
  });

  it('ricaricare la configurazione con --sovrascrivi non crea una nuova versione del modello', async () => {
    const r = await caricaBv(pool, 'bv', true);
    assert.equal(r.modelloNuovo, false);
    assert.equal(r.versioneModello, 1);
    // Una mappa diversa sì.
    const conf = confBv('bv');
    conf.modello.nomeFile = '{AAAA}_{MM}_{COGNOME}_{NOME}.xlsx';
    const r2 = await caricaOrganizzazione(pool, {
      conf,
      contatti: { emailInvio: 'segreteria@bv.test', responsabili: {} },
      abbinamenti: null,
      modello: modelloBv(),
      sovrascrivi: true,
    });
    assert.equal(r2.versioneModello, 2);
    const res = await scarica(petris, 2026, 10);
    assert.match(res.headers['content-disposition'], /filename="2026_10_Petris_Andrea\.xlsx"/);
  });
});

describe("caricamento del modello dall'app", () => {
  let pool, app, bv, admin, collab, attivita;

  before(async () => {
    ({ pool } = await preparaAmbiente());
    bv = await caricaBv(pool, 'bv');
    const hash = await hashPassword(PASSWORD);
    await creaUtente(pool, bv.orgId, 'admin@bv.test', 'Ada', 'Admin', hash, 'amministratore');
    await creaUtente(pool, bv.orgId, 'petris@bv.test', 'Andrea', 'Petris', hash);
    app = nuovaApp(pool);
    admin = await accedi(app, 'admin@bv.test');
    collab = await accedi(app, 'petris@bv.test');
    const { rows } = await pool.query('SELECT id, name, template_row FROM activities WHERE organization_id = $1', [bv.orgId]);
    attivita = Object.fromEntries(rows.map((r) => [r.name, r]));
  });
  after(() => pool.end());

  const carica = (agente, buffer, { anteprima = false, nome = 'modello nuovo.xlsx' } = {}) =>
    agente
      .post(`/api/modello${anteprima ? '?anteprima=1' : ''}`)
      .set('Content-Type', 'application/octet-stream')
      .set('X-Nome-File', encodeURIComponent(nome))
      .send(buffer);
  const versioni = async () => (await pool.query('SELECT count(*)::int AS n FROM excel_templates WHERE organization_id = $1', [bv.orgId])).rows[0].n;

  it('solo l\'amministratore carica un modello', async () => {
    const res = await carica(collab, fs.readFileSync(MODELLO_BV));
    assert.equal(res.status, 403);
    assert.equal((await collab.get('/api/modello')).status, 403);
    assert.equal((await collab.get('/api/modello/file')).status, 403);
  });

  it('rifiuta un file identico, un file non Excel e un foglio diverso, senza cambiare nulla', async () => {
    const identico = await carica(admin, fs.readFileSync(MODELLO_BV));
    assert.equal(identico.status, 409);
    assert.match(identico.body.errore, /identico/);
    const testo = await carica(admin, Buffer.from('non sono un excel'));
    assert.equal(testo.status, 400);
    assert.match(testo.body.errore, /non è un Excel valido/);
    const altroFoglio = await carica(admin, await modelloModificato({}, 'Foglio2'));
    assert.equal(altroFoglio.status, 400);
    assert.match(altroFoglio.body.errore, /manca il foglio "Foglio1"/);
    const estensione = await carica(admin, fs.readFileSync(MODELLO_BV), { nome: 'modello.pdf' });
    assert.equal(estensione.status, 400);
    assert.equal(await versioni(), 1);
  });

  it('rifiuta un modello in cui manca una riga usata da un\'attività', async () => {
    const riga = attivita.Danza.template_row;
    const res = await carica(admin, await modelloModificato({ [`D${riga}`]: null }));
    assert.equal(res.status, 400);
    assert.match(res.body.errore, new RegExp(`mancano attività che esistono nell'app: "Danza" \\(era alla riga ${riga}\\)`));
    assert.equal(await versioni(), 1);
  });

  it('un nome cambiato nel modello: anteprima, poi nuova versione con la stessa attività', async () => {
    const riga = attivita.Danza.template_row;
    const file = await modelloModificato({ [`D${riga}`]: 'Danza classica' });
    const prova = await carica(admin, file, { anteprima: true });
    assert.equal(prova.status, 200, JSON.stringify(prova.body));
    assert.deepEqual(prova.body.cambiamenti.rinominate, [{ riga, prima: 'Danza', dopo: 'Danza classica', nome_app: 'Danza' }]);
    assert.deepEqual(prova.body.cambiamenti.nuove, []);
    assert.equal(await versioni(), 1, "l'anteprima non salva");

    await collab.put('/api/giorni/2026-10-09').send({ voci: [{ attivita_id: attivita.Danza.id, quantita: 2 }] });
    const res = await carica(admin, file);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.versione, 2);
    assert.equal(res.body.nome_file, 'modello nuovo.xlsx');
    const { rows } = await pool.query('SELECT name, template_label FROM activities WHERE id = $1', [attivita.Danza.id]);
    // Il nome nell'app non era stato cambiato: segue il modello.
    assert.deepEqual(rows[0], { name: 'Danza classica', template_label: 'Danza classica' });

    // L'esportazione usa il nuovo modello e le ore restano sulla riga.
    const scaricato = await scarica(collab, 2026, 10);
    assert.equal(scaricato.status, 200);
    const ws = await foglio(scaricato.body);
    assert.equal(ws.getCell(`D${riga}`).value, 'Danza classica');
    assert.equal(ws.getCell(`${COLONNA_GIORNO(9)}${riga}`).value, 2);

    const traccia = await admin.get('/api/registro-modifiche');
    const voce = traccia.body.voci.find((v) => v.azione === 'modello.caricato');
    assert.equal(voce.autore, 'Ada Admin');
    assert.equal(voce.dettagli.versione, 2);
    assert.equal(voce.dettagli.rinominate[0].dopo, 'Danza classica');

    const elenco = await admin.get('/api/modello');
    assert.deepEqual(elenco.body.versioni.map((v) => v.versione), [2, 1]);
    const scaricaModello = await admin.get('/api/modello/file').buffer(true).parse((r, fine) => {
      const parti = [];
      r.on('data', (d) => parti.push(d));
      r.on('end', () => fine(null, Buffer.concat(parti)));
    });
    assert.equal(scaricaModello.status, 200);
    assert.ok(scaricaModello.body.equals(file));
  });

  it("un nome personalizzato nell'app resta quando il modello cambia", async () => {
    const riga = attivita.Bagnino.template_row;
    await admin.patch(`/api/attivita/${attivita.Bagnino.id}`).send({ nome: 'Assistente bagnanti' });
    const res = await carica(admin, await modelloModificato({ [`D${attivita.Danza.template_row}`]: 'Danza classica', [`D${riga}`]: 'Bagnini' }));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const { rows } = await pool.query('SELECT name, template_label FROM activities WHERE id = $1', [attivita.Bagnino.id]);
    assert.deepEqual(rows[0], { name: 'Assistente bagnanti', template_label: 'Bagnini' });
  });
});

describe('generatore del foglio mensile', () => {
  const layout = () => {
    // eslint-disable-next-line no-unused-vars
    const { file, ...mappa } = leggiJson(path.join(SEED_BV, 'organizzazione.json')).modello;
    return validaLayout(mappa);
  };

  it('rifiuta più sedute PT di quante ne contenga il modello', async () => {
    const sedutePt = Array.from({ length: 28 }, (_, i) => ({ giorno: (i % 28) + 1, tipo: 'acqua', cliente: `C${i}` }));
    await assert.rejects(
      generaFoglioMensile(fs.readFileSync(MODELLO_BV), layout(), {
        anno: 2026, mese: 10, nome: 'A', cognome: 'B', attivita: [], registrazioni: [], sedutePt,
      }),
      (err) => err instanceof ErroreModello && /troppe sedute PT in acqua/.test(err.message),
    );
  });

  it('la mappa non valida viene rifiutata con l\'elenco dei problemi', () => {
    const l = layout();
    l.celle.mese = 'B0';
    l.sigleGiorni = ['LU'];
    delete l.sedutePt.acqua;
    assert.throws(() => validaLayout(l), (err) => /celle\.mese/.test(err.message) && /sigleGiorni/.test(err.message) && /sedutePt\.acqua/.test(err.message));
  });
});
