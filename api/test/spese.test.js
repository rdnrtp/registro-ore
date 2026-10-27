// Rimborsi spese: ricevute (tipi accettati e rifiutati, HEIC, metadati GPS,
// limiti), spese, PDF, le due email dell'invio del mese, riapertura e
// reinvio, modalità "subito", permessi, backup delle ricevute.
// Servono il modello (MODELLO_BV) e la configurazione di BV (SEED_DIR), come
// per l'invio del mese, e pg_dump/pg_restore (immagine api-test).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');
const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');
const { preparaAmbiente, nuovaApp, accedi, PASSWORD, configTest, trasportoFinto, elabora, emailInCoda } = require('./helpers');
const { hashPassword } = require('../src/password');
const { caricaOrganizzazione, leggiJson } = require('../src/cli/carica-organizzazione');
const { messageId } = require('../src/posta/coda');

const MODELLO_BV = process.env.MODELLO_BV;
const SEED_BV = path.join(process.env.SEED_DIR ?? path.join(__dirname, '..', '..', 'seed'), 'bv');
if (!MODELLO_BV || !fs.existsSync(MODELLO_BV)) {
  throw new Error(`Modello Excel di BV non trovato (MODELLO_BV=${MODELLO_BV}): i test delle spese lo richiedono`);
}

const caricaBv = (pool, slug) =>
  caricaOrganizzazione(pool, {
    conf: { ...leggiJson(path.join(SEED_BV, 'organizzazione.json')), slug, nome: slug.toUpperCase() },
    contatti: { emailInvio: `segreteria@${slug}.test`, responsabili: {} },
    abbinamenti: leggiJson(path.join(SEED_BV, 'abbinamenti.json')),
    modello: { buffer: fs.readFileSync(MODELLO_BV), nomeFile: 'modello_bv.xlsx' },
  });

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

const scarica = (agente, url) =>
  agente
    .get(url)
    .buffer(true)
    .parse((res, fine) => {
      const parti = [];
      res.on('data', (d) => parti.push(d));
      res.on('end', () => fine(null, Buffer.concat(parti)));
    });

const carica = (agente, buffer, nome = 'ricevuta') =>
  agente
    .post('/api/spese/allegati')
    .set('Content-Type', 'application/octet-stream')
    .set('X-Nome-File', encodeURIComponent(nome))
    .send(buffer);

// Foto come quelle di un telefono: grande, con marca, modello e posizione GPS.
async function fotoConGps({ larghezza = 3000, altezza = 2000, orientamento } = {}) {
  let img = sharp({ create: { width: larghezza, height: altezza, channels: 3, background: '#d0e0f0' } }).jpeg({ quality: 90 });
  img = img.withExif({
    IFD0: { Make: 'ProvaTelefono', Model: 'Modello segreto' },
    IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '45/1 30/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '9/1 11/1 0/1' },
  });
  if (orientamento) img = img.withMetadata({ orientation: orientamento });
  return img.toBuffer();
}

// Rumore: non si comprime, per riempire i limiti di dimensione.
const rumore = (lato) =>
  sharp(crypto.randomBytes(lato * lato * 3), { raw: { width: lato, height: lato, channels: 3 } });

async function pdfDi(pagine, { immagine = null } = {}) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pagine; i++) {
    const p = doc.addPage([300, 400]);
    p.drawText(`Fattura pagina ${i + 1}`, { x: 20, y: 350, size: 14 });
  }
  if (immagine) {
    const img = await doc.embedPng(immagine);
    doc.getPage(0).drawImage(img, { x: 0, y: 0, width: 300, height: 300 });
  }
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

async function pagineDi(buffer) {
  return (await PDFDocument.load(buffer)).getPageCount();
}

describe('rimborsi spese', () => {
  let pool, app, bv, bv2, utenti, agenti, tipi;

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
      verdi: await crea(bv.orgId, 'verdi@bv.test', 'Luca', 'Verdi'),
      admin: await crea(bv.orgId, 'admin@bv.test', 'Anna', 'Amministra', 'amministratore'),
      capo: await crea(bv.orgId, 'capo@bv.test', 'Carlo', 'Capo', 'responsabile'),
      rossi: await crea(bv2.orgId, 'rossi@bv2.test', 'Mario', 'Rossi'),
    };
    // Email del settore Segreteria: vanno in copia alle ore, mai alle spese.
    const segreteria = (await pool.query("SELECT id FROM sectors WHERE organization_id = $1 AND name = 'Segreteria'", [bv.orgId]))
      .rows[0].id;
    await pool.query("UPDATE sectors SET manager_emails = '{resp.segreteria@bv.test}' WHERE id = $1", [segreteria]);
    await pool.query('INSERT INTO sector_managers (organization_id, sector_id, user_id) VALUES ($1, $2, $3)', [
      bv.orgId,
      segreteria,
      utenti.capo,
    ]);
    app = nuovaApp(pool);
    agenti = {};
    for (const [k, email] of Object.entries({
      petris: 'petris@bv.test',
      desantis: 'desantis@bv.test',
      verdi: 'verdi@bv.test',
      admin: 'admin@bv.test',
      capo: 'capo@bv.test',
      rossi: 'rossi@bv2.test',
    })) {
      agenti[k] = await accedi(app, email);
    }
    const attivita = (await pool.query("SELECT id FROM activities WHERE organization_id = $1 AND name = 'Segreteria'", [bv.orgId]))
      .rows[0].id;
    const voci = [{ attivita_id: attivita, quantita: 4 }];
    for (const a of ['petris', 'desantis', 'verdi']) {
      assert.equal((await agenti[a].put('/api/giorni/2026-09-01').send({ voci })).status, 200);
    }
    tipi =Object.fromEntries((await agenti.petris.get('/api/tipi-spesa')).body.map((t) => [t.nome, t.id]));
  });
  after(() => pool.end());

  // Carica le ricevute e salva una spesa; restituisce la risposta.
  async function nuovaSpesa(agente, { data = '2026-09-10', tipo = 'Pedaggio', importo = 1250, motivo = 'Trasferta a Milano', file }) {
    const allegati = [];
    for (const f of file) {
      const r = await carica(agente, f.buffer, f.nome);
      assert.equal(r.status, 201, JSON.stringify(r.body));
      allegati.push(r.body.id);
    }
    return agente.post('/api/spese').send({ data, tipo_id: tipi[tipo], importo_centesimi: importo, motivo, allegati });
  }

  it('tipi di spesa: valori iniziali, poi li gestisce solo l\'amministratore', async () => {
    const elenco = (await agenti.petris.get('/api/tipi-spesa')).body;
    assert.deepEqual(
      elenco.map((t) => t.nome),
      ['Pedaggio', 'Carburante', 'Parcheggio', 'Pasto', 'Altro'],
    );
    assert.equal((await agenti.petris.post('/api/tipi-spesa').send({ nome: 'Treno' })).status, 403);
    assert.equal((await agenti.capo.post('/api/tipi-spesa').send({ nome: 'Treno' })).status, 403);
    const treno = await agenti.admin.post('/api/tipi-spesa').send({ nome: 'Treno' });
    assert.equal(treno.status, 201);
    assert.equal((await agenti.admin.post('/api/tipi-spesa').send({ nome: 'treno' })).status, 409);
    const spento = await agenti.admin.patch(`/api/tipi-spesa/${treno.body.id}`).send({ nome: 'Treno e autobus', attivo: false });
    assert.deepEqual(spento.body, { id: treno.body.id, nome: 'Treno e autobus', attivo: false });
    assert.equal((await agenti.petris.patch(`/api/tipi-spesa/${treno.body.id}`).send({ attivo: true })).status, 403);
    tipi['Treno e autobus'] = treno.body.id;
    const traccia = await pool.query("SELECT action FROM audit_log WHERE action LIKE 'tipo_spesa.%' ORDER BY created_at");
    assert.deepEqual(traccia.rows.map((r) => r.action), ['tipo_spesa.creato', 'tipo_spesa.modificato']);
    // Un tipo non attivo non si usa per una spesa nuova.
    const pdf = await pdfDi(1);
    const r = await nuovaSpesa(agenti.petris, { tipo: 'Treno e autobus', file: [{ buffer: pdf }] });
    assert.equal(r.status, 400);
    assert.match(r.body.errore, /non è più in uso/);
  });

  it('ricevute accettate: il tipo si riconosce dal contenuto, non dal nome', async () => {
    const png = await sharp({ create: { width: 800, height: 600, channels: 4, background: '#ffffff80' } }).png().toBuffer();
    const casi = [
      { buffer: await fotoConGps(), nome: 'scontrino.pdf', tipo: 'image/jpeg', atteso: 'scontrino.jpg' },
      { buffer: png, nome: 'schermata.png', tipo: 'image/jpeg', atteso: 'schermata.jpg' },
      { buffer: fs.readFileSync(path.join(__dirname, 'file', 'ricevuta.heic')), nome: 'IMG_0001.HEIC', tipo: 'image/jpeg', atteso: 'IMG_0001.jpg' },
      { buffer: await pdfDi(2), nome: 'fattura', tipo: 'application/pdf', atteso: 'fattura.pdf', pagine: 2 },
    ];
    for (const c of casi) {
      const r = await carica(agenti.petris, c.buffer, c.nome);
      assert.equal(r.status, 201, `${c.nome}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.tipo, c.tipo, c.nome);
      assert.equal(r.body.nome, c.atteso);
      assert.equal(r.body.pagine, c.pagine ?? 1);
      const file = await scarica(agenti.petris, `/api/spese/allegati/${r.body.id}`);
      assert.equal(file.status, 200);
      assert.equal(file.headers['content-type'].split(';')[0], c.tipo);
      assert.equal(file.headers['cache-control'], 'private, no-store');
      if (c.tipo === 'application/pdf') assert.equal(sha(file.body), sha(c.buffer), 'il PDF resta com\'è');
    }
  });

  it('HEIC degli iPhone: convertito in JPEG e ridotto a 1600 px sul lato lungo', async () => {
    const heic = fs.readFileSync(path.join(__dirname, 'file', 'ricevuta.heic'));
    const r = await carica(agenti.petris, heic, 'foto.heic');
    assert.equal(r.status, 201);
    const file = await scarica(agenti.petris, `/api/spese/allegati/${r.body.id}`);
    const m = await sharp(file.body).metadata();
    assert.equal(m.format, 'jpeg');
    assert.deepEqual([m.width, m.height], [1600, 1200]);
    assert.equal(m.exif, undefined, "nessun EXIF (l'HEIC ne aveva, con il GPS)");
    assert.ok(!file.body.includes('ProvaTelefono'));
  });

  it('le foto perdono tutti i metadati, compresa la posizione GPS, e vengono raddrizzate', async () => {
    const originale = await fotoConGps();
    assert.ok((await sharp(originale).metadata()).exif, "la foto di prova ha l'EXIF");
    assert.ok(originale.includes('ProvaTelefono'));
    const r = await carica(agenti.petris, originale, 'gps.jpg');
    const file = await scarica(agenti.petris, `/api/spese/allegati/${r.body.id}`);
    const m = await sharp(file.body).metadata();
    assert.equal(m.exif, undefined);
    assert.equal(m.xmp, undefined);
    assert.equal(m.icc, undefined);
    assert.ok(!file.body.includes('ProvaTelefono') && !file.body.includes('Modello segreto'));
    assert.deepEqual([m.width, m.height], [1600, 1067]);
    // Orientamento EXIF 6 (telefono in verticale): la foto esce già ruotata.
    const ruotata = await carica(agenti.petris, await fotoConGps({ larghezza: 300, altezza: 200, orientamento: 6 }), 'v.jpg');
    const mr = await sharp((await scarica(agenti.petris, `/api/spese/allegati/${ruotata.body.id}`)).body).metadata();
    assert.deepEqual([mr.width, mr.height, mr.orientation], [200, 300, undefined]);
  });

  it('ricevute rifiutate, con un messaggio chiaro', async () => {
    const pdf = (await pdfDi(1)).toString('latin1');
    const casi = [
      [await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } }).gif().toBuffer(), /Formato non accettato \(GIF\)/],
      [await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } }).webp().toBuffer(), /Formato non accettato \(WebP\)/],
      [Buffer.from('questo è un testo, non una foto anche se si chiama .jpg'), /non è una foto né un PDF/],
      [Buffer.from(pdf.replace('trailer\n<<', 'trailer\n<<\n/Encrypt 1 0 R'), 'latin1'), /protetto da password/],
      [Buffer.from('%PDF-1.7\nnon è davvero un PDF'), /PDF non si riesce a leggere/],
      [(await fotoConGps()).subarray(0, 2000), /foto non si riesce a leggere/],
      [await pdfDi(21), /21 pagine: al massimo 20/],
    ];
    for (const [buffer, messaggio] of casi) {
      const r = await carica(agenti.petris, buffer, 'scontrino.jpg');
      assert.equal(r.status, 400, String(messaggio));
      assert.match(r.body.errore, messaggio);
    }
    assert.equal((await carica(agenti.petris, Buffer.alloc(0))).status, 400);
  });

  it('limiti di dimensione: foto oltre 20 MB, PDF oltre il limite dell\'email, troppe ricevute nel mese', async () => {
    assert.equal((await carica(agenti.petris, Buffer.alloc(21 * 1024 * 1024, 1), 'enorme.jpg')).status, 413);
    // Con un limite dell'email di 1 MB: un PDF da 1,2 MB è rifiutato subito.
    const piccola = nuovaApp(pool, { ...configTest, spese: { maxPdfMb: 1 } });
    const agente = await accedi(piccola, 'desantis@bv.test');
    const grande = await pdfDi(1, { immagine: await rumore(700).png().toBuffer() });
    assert.ok(grande.length > 1.1 * 1024 * 1024);
    const r = await carica(agente, grande, 'grande.pdf');
    assert.equal(r.status, 400);
    assert.match(r.body.errore, /Il PDF è di 1,\d MB: al massimo 0,9 MB/);
    // Foto che da sole stanno nel limite, insieme no.
    const foto = [];
    for (let i = 0; i < 3; i++) foto.push({ buffer: await rumore(1600).jpeg({ quality: 95 }).toBuffer() });
    const s = await nuovaSpesa(agente, { file: foto });
    assert.equal(s.status, 400);
    assert.match(s.body.errore, /le spese di settembre 2026 arriverebbero a \d+,\d MB: l'email alla segreteria ne porta al massimo 0,9 MB/);
  });

  it('spese: dati obbligatori, da 1 a 5 ricevute proprie, niente date future', async () => {
    const pdf = await pdfDi(1);
    const ids = [];
    for (let i = 0; i < 6; i++) ids.push((await carica(agenti.petris, pdf, `r${i}.pdf`)).body.id);
    const base = { data: '2026-09-10', tipo_id: tipi.Pedaggio, importo_centesimi: 1250, motivo: 'Trasferta' };
    const prove = [
      [{ ...base, allegati: [] }, /almeno una ricevuta/],
      [{ ...base, allegati: ids }, /Al massimo 5 ricevute/],
      [{ ...base, data: '2099-01-01', allegati: [ids[0]] }, /futuro/],
      [{ ...base, importo_centesimi: 0, allegati: [ids[0]] }, /Importo non valido/],
      [{ ...base, importo_centesimi: 12.5, allegati: [ids[0]] }, /Importo non valido/],
      [{ ...base, motivo: '  ', allegati: [ids[0]] }, /Motivo della trasferta/],
      [{ ...base, tipo_id: crypto.randomUUID(), allegati: [ids[0]] }, /Tipo di spesa non trovato/],
      [{ ...base, allegati: [ids[0], ids[0]] }, /Ricevute non valide/],
    ];
    for (const [corpo, messaggio] of prove) {
      const r = await agenti.petris.post('/api/spese').send(corpo);
      assert.equal(r.status, 400, String(messaggio));
      assert.match(r.body.errore, messaggio);
    }
    // Ricevuta caricata da un altro utente.
    const altrui = (await carica(agenti.desantis, pdf)).body.id;
    const r = await agenti.petris.post('/api/spese').send({ ...base, allegati: [altrui] });
    assert.equal(r.status, 400);
    assert.match(r.body.errore, /Ricevuta non trovata/);
  });

  let spesaPetris;
  it('crea, modifica ed elimina una spesa finché il mese è aperto', async () => {
    const foto = await fotoConGps();
    const pdf = await pdfDi(2);
    const r = await nuovaSpesa(agenti.petris, {
      data: '2026-09-12',
      tipo: 'Carburante',
      importo: 4590,
      motivo: 'Gara regionale a Verona',
      file: [{ buffer: foto, nome: 'pompa.jpg' }, { buffer: pdf, nome: 'fattura.pdf' }],
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.tipo, 'Carburante');
    assert.equal(r.body.importo_centesimi, 4590);
    assert.deepEqual(r.body.allegati.map((a) => a.nome), ['pompa.jpg', 'fattura.pdf']);
    assert.equal(r.body.inviata, null);
    spesaPetris = r.body;

    // Modifica: nuovo motivo, la foto tolta (cancellata), l'ordine cambia.
    const altra = (await carica(agenti.petris, await pdfDi(1), 'parcheggio.pdf')).body.id;
    const pdfId = r.body.allegati[1].id;
    const m = await agenti.petris
      .put(`/api/spese/${r.body.id}`)
      .send({ data: '2026-09-13', tipo_id: tipi.Carburante, importo_centesimi: 4600, motivo: 'Gara regionale a Verona e ritorno', allegati: [pdfId, altra] });
    assert.equal(m.status, 200, JSON.stringify(m.body));
    assert.deepEqual(m.body.allegati.map((a) => a.id), [pdfId, altra]);
    assert.equal(m.body.data, '2026-09-13');
    const tolta = await pool.query('SELECT 1 FROM expense_attachments WHERE id = $1', [r.body.allegati[0].id]);
    assert.equal(tolta.rows.length, 0, 'la ricevuta tolta non resta nel database');
    spesaPetris = m.body;

    // Una seconda spesa, poi eliminata con le sue ricevute.
    const seconda = await nuovaSpesa(agenti.petris, { file: [{ buffer: pdf }] });
    assert.equal(seconda.status, 201);
    assert.equal((await agenti.petris.delete(`/api/spese/${seconda.body.id}`)).status, 200);
    assert.equal((await pool.query('SELECT 1 FROM expense_attachments WHERE expense_id = $1', [seconda.body.id])).rows.length, 0);
    assert.equal((await agenti.petris.delete(`/api/spese/${seconda.body.id}`)).status, 404);

    // Una terza, con una foto.
    assert.equal((await nuovaSpesa(agenti.petris, { data: '2026-09-20', tipo: 'Pasto', importo: 1800, file: [{ buffer: foto }] })).status, 201);
    const mese = (await agenti.petris.get('/api/mese/2026/9/spese')).body;
    assert.equal(mese.modalita, 'mese');
    assert.deepEqual(mese.spese.map((s) => s.data), ['2026-09-13', '2026-09-20']);
    assert.equal(mese.totale_centesimi, 6400);
  });

  it("il riepilogo prima dell'invio mostra numero, totale e dimensione del PDF delle spese", async () => {
    const r = (await agenti.petris.get('/api/mese/2026/9/invio')).body;
    assert.equal(r.spese.numero, 2);
    assert.equal(r.spese.totale_centesimi, 6400);
    assert.equal(r.spese.nome_file, 'Spese_Settembre_2026_Petris.pdf');
    assert.ok(r.spese.dimensione > 1000 && r.spese.dimensione < r.spese.limite);
    assert.equal(r.spese.limite, 4 * 1024 * 1024);
    assert.equal(r.spese.troppo_grande, false);
    assert.equal(r.spese.destinatario, 'segreteria@bv.test');
    assert.deepEqual(r.spese.copia, ['petris@bv.test']);
    assert.equal(r.spese.sostituisce, null);
    // L'anteprima del PDF: riepilogo + 1 pagina della foto + 2 + 1 dei PDF.
    const anteprima = await scarica(agenti.petris, '/api/mese/2026/9/spese/pdf');
    assert.equal(anteprima.status, 200);
    assert.equal(await pagineDi(anteprima.body), 1 + 2 + 1 + 1);
    // Chi non ha spese: nessuna email delle spese.
    assert.equal((await agenti.desantis.get('/api/mese/2026/9/invio')).body.spese, null);
  });

  it("invio del mese: due email, quella delle spese solo alla segreteria e all'utente", async () => {
    const res = await agenti.petris.post('/api/mese/2026/9/invio');
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.invii[0].spese.numero, 2);
    assert.equal(res.body.invii[0].spese.totale_centesimi, 6400);
    const [ore] = (await emailInCoda(pool, bv.orgId, 'invio_mese')).filter((e) => e.user_id === utenti.petris);
    const [spese] = (await emailInCoda(pool, bv.orgId, 'invio_spese')).filter((e) => e.user_id === utenti.petris);
    assert.deepEqual(ore.cc_addresses, ['petris@bv.test', 'resp.segreteria@bv.test']);
    assert.deepEqual(spese.to_addresses, ['segreteria@bv.test']);
    assert.deepEqual(spese.cc_addresses, ['petris@bv.test'], 'niente responsabili di settore');
    assert.equal(spese.reply_to, 'petris@bv.test');
    assert.equal(spese.subject, 'Spese di settembre 2026 – Andrea Petris');
    assert.match(spese.body_text, /2 spese, totale 64,00 €/);
    assert.doesNotMatch(spese.body_text, /Verona/, 'i motivi stanno solo nel PDF');

    const t = trasportoFinto();
    await elabora(pool, t);
    const m = t.inviate.find((x) => x.subject === 'Spese di settembre 2026 – Andrea Petris');
    assert.deepEqual(m.to, ['segreteria@bv.test']);
    assert.deepEqual(m.cc, ['petris@bv.test']);
    assert.equal(m.attachments.length, 1);
    assert.equal(m.attachments[0].filename, 'Spese_Settembre_2026_Petris.pdf');
    assert.equal(m.attachments[0].contentType, 'application/pdf');
    const salvato = (await pool.query("SELECT file, file_sha256 FROM expense_submissions WHERE user_id = $1 AND mode = 'mese'", [utenti.petris]))
      .rows[0];
    assert.equal(sha(m.attachments[0].content), salvato.file_sha256, "l'allegato è il PDF salvato");
    assert.equal(sha(salvato.file), salvato.file_sha256);
    assert.equal(await pagineDi(salvato.file), 5);
    // Lo scaricano identico il collaboratore e l'amministratore.
    for (const [agente, url] of [
      [agenti.petris, '/api/mese/2026/9/spese/pdf'],
      [agenti.petris, '/api/mese/2026/9/invii/1/spese'],
      [agenti.admin, `/api/collaboratori/${utenti.petris}/mese/2026/9/spese/pdf`],
      [agenti.admin, `/api/collaboratori/${utenti.petris}/mese/2026/9/invii/1/spese`],
    ]) {
      const f = await scarica(agente, url);
      assert.equal(f.status, 200, url);
      assert.equal(sha(f.body), salvato.file_sha256, url);
    }
    const mese = (await agenti.petris.get('/api/mese/2026/9')).body;
    assert.equal(mese.invii[0].spese.email.stato, 'inviata');
    assert.equal(mese.invii[0].spese.nome_file, 'Spese_Settembre_2026_Petris.pdf');
  });

  it("dopo l'invio le spese del mese sono in sola lettura", async () => {
    const corpo = { ...spesaPetris, tipo_id: spesaPetris.tipo_id, importo_centesimi: 1, allegati: spesaPetris.allegati.map((a) => a.id) };
    assert.equal((await agenti.petris.put(`/api/spese/${spesaPetris.id}`).send(corpo)).status, 409);
    assert.equal((await agenti.petris.delete(`/api/spese/${spesaPetris.id}`)).status, 409);
    const nuova = await nuovaSpesa(agenti.petris, { data: '2026-09-25', file: [{ buffer: await pdfDi(1) }] });
    assert.equal(nuova.status, 409);
    assert.match(nuova.body.errore, /già stato inviato/);
    // Il database non permette di cambiare un PDF inviato.
    await assert.rejects(pool.query("UPDATE expense_submissions SET file = '\\x00' WHERE user_id = $1", [utenti.petris]), {
      code: '23514',
    });
  });

  it('riapertura e reinvio: le spese sostituiscono le precedenti; senza più spese le annullano', async () => {
    const riapri = () =>
      agenti.admin.post(`/api/collaboratori/${utenti.petris}/mese/2026/9/riapertura`).send({ motivazione: 'Correggere le spese' });
    assert.equal((await riapri()).status, 200);
    const corpo = {
      data: spesaPetris.data,
      tipo_id: spesaPetris.tipo_id,
      importo_centesimi: 4800,
      motivo: spesaPetris.motivo,
      allegati: spesaPetris.allegati.map((a) => a.id),
    };
    assert.equal((await agenti.petris.put(`/api/spese/${spesaPetris.id}`).send(corpo)).status, 200);
    const riepilogo = (await agenti.petris.get('/api/mese/2026/9/invio')).body;
    assert.ok(riepilogo.spese.sostituisce);
    assert.equal((await agenti.petris.post('/api/mese/2026/9/invio')).status, 201);

    let email = (await emailInCoda(pool, bv.orgId, 'invio_spese')).filter((e) => e.user_id === utenti.petris);
    assert.equal(email.length, 2);
    assert.equal(email[1].subject, 'SOSTITUISCE IL PRECEDENTE – Spese di settembre 2026 – Andrea Petris');
    assert.match(email[1].body_text, /SOSTITUISCE le spese inviate il/);
    assert.match(email[1].body_text, /totale 66,00 €/);
    assert.equal(email[1].references_id, email[0].id);
    const t = trasportoFinto();
    await elabora(pool, t);
    assert.equal(t.inviate.find((x) => x.subject.startsWith('SOSTITUISCE IL PRECEDENTE – Spese')).inReplyTo, messageId(email[0].id, 'registro@app.test'));
    const v1 = await scarica(agenti.petris, '/api/mese/2026/9/invii/1/spese');
    const v2 = await scarica(agenti.petris, '/api/mese/2026/9/invii/2/spese');
    assert.notEqual(sha(v1.body), sha(v2.body));

    // Di nuovo riaperto: tolte tutte le spese, il reinvio le annulla.
    assert.equal((await riapri()).status, 200);
    for (const s of (await agenti.petris.get('/api/mese/2026/9/spese')).body.spese) {
      assert.equal((await agenti.petris.delete(`/api/spese/${s.id}`)).status, 200);
    }
    assert.equal((await agenti.petris.get('/api/mese/2026/9/invio')).body.spese.annulla, true);
    const res = await agenti.petris.post('/api/mese/2026/9/invio');
    assert.equal(res.status, 201);
    assert.equal(res.body.invii[0].spese.annullate, true);
    email = (await emailInCoda(pool, bv.orgId, 'invio_spese')).filter((e) => e.user_id === utenti.petris);
    assert.equal(email[2].subject, 'ANNULLA IL PRECEDENTE – Spese di settembre 2026 – Andrea Petris');
    assert.match(email[2].body_text, /NON sono più valide/);
    await elabora(pool, t);
    assert.equal(t.inviate.find((x) => x.subject.startsWith('ANNULLA')).attachments, undefined);
    assert.equal((await agenti.petris.get('/api/mese/2026/9/invii/3/spese')).status, 404);
    assert.equal((await agenti.petris.get('/api/mese/2026/9/spese/pdf')).status, 404);
  });

  it("PDF delle spese oltre il limite: l'invio del mese è rifiutato con un messaggio e il mese resta aperto", async () => {
    // Tre foto da circa 0,5 MB l'una (dopo la riduzione): stanno nel limite
    // di 4 MB con cui sono state salvate, non in quello di 1 MB.
    const foto = [];
    for (let i = 0; i < 3; i++) foto.push({ buffer: await rumore(1000).jpeg({ quality: 95 }).toBuffer() });
    assert.equal((await nuovaSpesa(agenti.desantis, { file: foto })).status, 201);
    const piccola = nuovaApp(pool, { ...configTest, spese: { maxPdfMb: 1 } });
    const agente = await accedi(piccola, 'desantis@bv.test');
    const r = (await agente.get('/api/mese/2026/9/invio')).body;
    assert.equal(r.spese.troppo_grande, true);
    const prima = (await emailInCoda(pool, bv.orgId)).length;
    const invio = await agente.post('/api/mese/2026/9/invio');
    assert.equal(invio.status, 409);
    assert.match(invio.body.errore, /Il PDF delle spese sarebbe di \d+,\d MB: l'email alla segreteria può portare al massimo 1 MB/);
    assert.equal((await agenti.desantis.get('/api/mese/2026/9')).body.stato, 'aperto');
    assert.equal((await emailInCoda(pool, bv.orgId)).length, prima, 'nessuna email in coda');
  });

  it('modalità "subito": ogni spesa parte appena confermata e diventa di sola lettura', async () => {
    assert.equal((await agenti.petris.patch('/api/organizzazione').send({ invio_spese: 'subito' })).status, 403);
    assert.equal((await agenti.admin.patch('/api/organizzazione').send({ invio_spese: 'altro' })).status, 400);
    const org = await agenti.admin.patch('/api/organizzazione').send({ invio_spese: 'subito' });
    assert.equal(org.body.invio_spese, 'subito');
    try {
      const r = await nuovaSpesa(agenti.verdi, { data: '2026-09-05', tipo: 'Parcheggio', importo: 350, file: [{ buffer: await fotoConGps() }] });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      assert.ok(r.body.inviata?.il);
      assert.equal(r.body.inviata.email.stato, 'in_attesa');
      const [e] = (await emailInCoda(pool, bv.orgId, 'invio_spese')).filter((x) => x.user_id === utenti.verdi);
      assert.equal(e.subject, 'Spesa del 05/09/2026 – Luca Verdi');
      assert.deepEqual(e.to_addresses, ['segreteria@bv.test']);
      assert.deepEqual(e.cc_addresses, ['verdi@bv.test']);
      assert.match(e.body_text, /1 spesa, totale 3,50 €/);
      const t = trasportoFinto();
      await elabora(pool, t);
      const m = t.inviate.find((x) => x.subject === 'Spesa del 05/09/2026 – Luca Verdi');
      assert.equal(m.attachments[0].filename, 'Spesa_2026-09-05_Verdi.pdf');
      assert.equal(await pagineDi(m.attachments[0].content), 2);
      const pdf = await scarica(agenti.verdi, `/api/spese/${r.body.id}/pdf`);
      assert.equal(sha(pdf.body), sha(m.attachments[0].content));
      assert.equal(sha((await scarica(agenti.admin, `/api/collaboratori/${utenti.verdi}/spese/${r.body.id}/pdf`)).body), sha(pdf.body));

      // Già partita: non si modifica né si elimina, anche con il mese aperto.
      const corpo = { data: '2026-09-05', tipo_id: tipi.Parcheggio, importo_centesimi: 400, motivo: 'x', allegati: r.body.allegati.map((a) => a.id) };
      assert.equal((await agenti.verdi.put(`/api/spese/${r.body.id}`).send(corpo)).status, 409);
      assert.equal((await agenti.verdi.delete(`/api/spese/${r.body.id}`)).status, 409);

      // All'invio del mese le spese già partite non ripartono.
      assert.equal((await agenti.verdi.get('/api/mese/2026/9/invio')).body.spese, null);
      const invio = await agenti.verdi.post('/api/mese/2026/9/invio');
      assert.equal(invio.status, 201);
      assert.equal(invio.body.invii[0].spese, null);
      assert.equal((await emailInCoda(pool, bv.orgId, 'invio_spese')).filter((x) => x.user_id === utenti.verdi).length, 1);
    } finally {
      await agenti.admin.patch('/api/organizzazione').send({ invio_spese: 'mese' });
    }
    const traccia = await pool.query("SELECT details FROM audit_log WHERE action = 'organizzazione.modificata' AND details ? 'invio_spese' ORDER BY created_at");
    assert.deepEqual(traccia.rows.map((r) => r.details.invio_spese), [
      { prima: 'mese', dopo: 'subito' },
      { prima: 'subito', dopo: 'mese' },
    ]);
  });

  it("spese e ricevute le vedono solo il titolare e l'amministratore, mai il responsabile", async () => {
    const [spesa] = (await agenti.desantis.get('/api/mese/2026/9/spese')).body.spese;
    const ricevuta = spesa.allegati[0].id;
    const id = utenti.desantis;
    // Amministratore: le spese nel mese del collega, le ricevute, il PDF.
    const admin = (await agenti.admin.get(`/api/collaboratori/${id}/mese/2026/9`)).body;
    assert.equal(admin.spese.length, 1);
    assert.equal((await scarica(agenti.admin, `/api/collaboratori/${id}/spese/allegati/${ricevuta}`)).status, 200);
    assert.equal((await scarica(agenti.admin, `/api/collaboratori/${id}/mese/2026/9/spese/pdf`)).status, 200);
    // Le bozze (ricevute non ancora salvate) no.
    const bozza = (await carica(agenti.desantis, await pdfDi(1))).body.id;
    assert.equal((await agenti.admin.get(`/api/collaboratori/${id}/spese/allegati/${bozza}`)).status, 404);
    // Responsabile (desantis ha ore nel suo settore): niente spese, niente file.
    const capo = await agenti.capo.get(`/api/collaboratori/${id}/mese/2026/9`);
    assert.equal(capo.status, 200);
    assert.equal(capo.body.spese, null);
    for (const url of [
      `/api/collaboratori/${id}/spese/allegati/${ricevuta}`,
      `/api/collaboratori/${id}/mese/2026/9/spese/pdf`,
      `/api/collaboratori/${id}/mese/2026/9/invii/1/spese`,
      `/api/collaboratori/${id}/spese/${spesa.id}/pdf`,
    ]) {
      assert.equal((await agenti.capo.get(url)).status, 403, url);
      assert.equal((await agenti.petris.get(url)).status, 403, url);
    }
    // Le rotte personali usano sempre l'utente del cookie: la ricevuta di
    // un altro non esiste, nemmeno per l'amministratore.
    for (const agente of [agenti.petris, agenti.capo, agenti.admin]) {
      assert.equal((await agente.get(`/api/spese/allegati/${ricevuta}`)).status, 404);
      assert.equal((await agente.delete(`/api/spese/${spesa.id}`)).status, 404);
    }
    // Senza accesso: nessun indirizzo pubblico.
    const anonimo = require('supertest')(app);
    assert.equal((await anonimo.get(`/api/spese/allegati/${ricevuta}`)).status, 401);
    assert.equal((await anonimo.get(`/api/collaboratori/${id}/spese/allegati/${ricevuta}`)).status, 401);
  });

  it('isolamento: le spese di un altro impianto rispondono 404', async () => {
    const tipiB = Object.fromEntries((await agenti.rossi.get('/api/tipi-spesa')).body.map((t) => [t.nome, t.id]));
    assert.notEqual(tipiB.Pedaggio, tipi.Pedaggio);
    const ricevuta = (await carica(agenti.rossi, await pdfDi(1))).body.id;
    const s = await agenti.rossi
      .post('/api/spese')
      .send({ data: '2026-09-03', tipo_id: tipiB.Pedaggio, importo_centesimi: 100, motivo: 'B', allegati: [ricevuta] });
    assert.equal(s.status, 201);
    for (const url of [
      `/api/collaboratori/${utenti.rossi}/mese/2026/9`,
      `/api/collaboratori/${utenti.rossi}/spese/allegati/${ricevuta}`,
      `/api/collaboratori/${utenti.rossi}/mese/2026/9/spese/pdf`,
      `/api/collaboratori/${utenti.rossi}/spese/${s.body.id}/pdf`,
      `/api/spese/allegati/${ricevuta}`,
    ]) {
      assert.equal((await agenti.admin.get(url)).status, 404, url);
    }
    assert.equal((await agenti.admin.patch(`/api/tipi-spesa/${tipiB.Pedaggio}`).send({ attivo: false })).status, 404);
    const pdf = await carica(agenti.petris, await pdfDi(1));
    const r = await agenti.petris
      .post('/api/spese')
      .send({ data: '2026-10-03', tipo_id: tipiB.Pedaggio, importo_centesimi: 100, motivo: 'x', allegati: [pdf.body.id] });
    assert.equal(r.status, 400);
    assert.match(r.body.errore, /Tipo di spesa non trovato/);
  });

  it('le ricevute sono nel backup (pg_dump) e tornano identiche dal ripristino', async () => {
    const cartella = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-'));
    const file = path.join(cartella, 'copia.dump');
    const prova = `${process.env.PGDATABASE}_ripristino`;
    // Stesse opzioni di deploy/backup.sh e deploy/ripristina.sh.
    execFileSync('pg_dump', ['--format=custom', '--compress=6', '-f', file]);
    const elenco = execFileSync('pg_restore', ['--list', file]).toString();
    for (const t of ['expenses', 'expense_attachments', 'expense_submissions']) {
      assert.match(elenco, new RegExp(` TABLE DATA public ${t} `), t);
    }
    const admin = new Client({ database: 'postgres' });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${prova}" WITH (FORCE)`);
      await admin.query(`CREATE DATABASE "${prova}"`);
      execFileSync('pg_restore', ['--no-owner', '--exit-on-error', '-d', prova, file]);
      const ripristinato = new Client({ database: prova });
      await ripristinato.connect();
      try {
        const query = `SELECT id, sha256, encode(sha256(file), 'hex') AS calcolato FROM expense_attachments ORDER BY id`;
        const prima = (await pool.query(query)).rows;
        const dopo = (await ripristinato.query(query)).rows;
        assert.ok(prima.length >= 5);
        assert.deepEqual(dopo, prima);
        assert.ok(dopo.every((r) => r.sha256 === r.calcolato), 'ogni ricevuta corrisponde alla sua impronta');
        const pdf = `SELECT id, file_sha256, encode(sha256(file), 'hex') AS calcolato FROM expense_submissions WHERE file IS NOT NULL ORDER BY id`;
        assert.deepEqual((await ripristinato.query(pdf)).rows, (await pool.query(pdf)).rows);
      } finally {
        await ripristinato.end();
      }
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS "${prova}" WITH (FORCE)`);
      await admin.end();
      fs.rmSync(cartella, { recursive: true, force: true });
    }
  });

  it('le ricevute caricate e mai salvate si cancellano dopo un giorno', async () => {
    const { pulisciBozzeSpese } = require('../src/routes/spese');
    const r = await carica(agenti.petris, await pdfDi(1));
    await pool.query("UPDATE expense_attachments SET created_at = now() - interval '25 hours' WHERE id = $1", [r.body.id]);
    assert.ok((await pulisciBozzeSpese(pool)) >= 1);
    assert.equal((await agenti.petris.get(`/api/spese/allegati/${r.body.id}`)).status, 404);
    // Quelle delle spese salvate restano.
    assert.ok((await pool.query('SELECT count(*)::int AS n FROM expense_attachments WHERE expense_id IS NOT NULL')).rows[0].n > 0);
  });
});
