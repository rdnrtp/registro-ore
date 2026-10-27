// Spese: lettura, PDF per la segreteria e invio, insieme al mese o subito.
// Destinatari: solo l'indirizzo dell'organizzazione, in copia l'utente. Mai
// i responsabili di settore: le ricevute possono contenere dati personali.
const crypto = require('node:crypto');
const { ErroreHttp } = require('../errori');
const { NOMI_MESI } = require('../validazione');
const { perNomeFile } = require('../excel/foglio-mensile');
const { accodaEmail, statoPubblico } = require('../posta/coda');
const { emailSpese } = require('../posta/messaggi');
const { dataOraIt } = require('../tempo');
const { generaPdfSpese, euro, dataBreve } = require('./pdf');
const { mb } = require('./allegati');

const NOMI_MESI_MAIUSCOLI = NOMI_MESI.map((m) => m[0].toUpperCase() + m.slice(1));
// Spazio occupato dal riepilogo e dalla struttura del PDF, oltre alle
// ricevute (stima larga).
const SPAZIO_RIEPILOGO = 96 * 1024;

const limiteByte = (config) => config.spese.maxPdfMb * 1024 * 1024;
const inizioMese = (anno, mese) => `${anno}-${String(mese).padStart(2, '0')}-01`;

const nomeFileSpese = ({ anno, mese, cognome }) => `Spese_${NOMI_MESI_MAIUSCOLI[mese - 1]}_${anno}_${perNomeFile(cognome)}.pdf`;
const nomeFileSpesa = ({ data, cognome }) => `Spesa_${data}_${perNomeFile(cognome)}.pdf`;

const email = (r) => (r.stato ? { stato: statoPubblico(r.stato), inviata_il: r.inviata_email_il, errore: r.errore_email } : null);

// Spese di un utente: quelle di un mese (anno, mese) oppure una sola
// (spesaId), dalla più vecchia, con le ricevute. conFile = con il contenuto
// delle ricevute; soloDaInviare = senza quelle già inviate da sole.
// Ogni spesa ha inviata = null oppure { il, email } (modalità "subito").
async function leggiSpese(db, { orgId, utenteId, anno, mese, spesaId = null, conFile = false, soloDaInviare = false }) {
  const { rows } = await db.query(
    `SELECT e.id, e.expense_date AS data, e.type_id AS tipo_id, t.name AS tipo, e.amount_cents AS importo_centesimi,
            e.reason AS motivo, e.submission_id, s.submitted_at AS inviata_il,
            m.status AS stato, m.sent_at AS inviata_email_il, m.last_error AS errore_email
       FROM expenses e
       JOIN expense_types t ON t.id = e.type_id AND t.organization_id = e.organization_id
       LEFT JOIN expense_submissions s ON s.id = e.submission_id AND s.organization_id = e.organization_id
       LEFT JOIN LATERAL (
         SELECT status, sent_at, last_error FROM email_outbox
          WHERE attachment_expense_submission_id = s.id AND organization_id = e.organization_id
          ORDER BY created_at DESC LIMIT 1) m ON true
      WHERE e.user_id = $1 AND e.organization_id = $2
        AND ($3::uuid IS NULL OR e.id = $3)
        AND ($4::date IS NULL OR (e.expense_date >= $4::date AND e.expense_date < $4::date + interval '1 month'))
        AND (NOT $5::boolean OR e.submission_id IS NULL)
      ORDER BY e.expense_date, e.created_at, e.id`,
    [utenteId, orgId, spesaId, spesaId ? null : inizioMese(anno, mese), soloDaInviare],
  );
  if (!rows.length) return [];
  const { rows: allegati } = await db.query(
    `SELECT id, expense_id, content_type, original_name, size, pages ${conFile ? ', file' : ''}
       FROM expense_attachments
      WHERE organization_id = $1 AND expense_id = ANY($2::uuid[])
      ORDER BY position, created_at`,
    [orgId, rows.map((r) => r.id)],
  );
  return rows.map((r) => ({
    id: r.id,
    data: r.data,
    tipo_id: r.tipo_id,
    tipo: r.tipo,
    importo_centesimi: r.importo_centesimi,
    motivo: r.motivo,
    inviata: r.submission_id ? { il: r.inviata_il, email: email(r) } : null,
    allegati: allegati
      .filter((a) => a.expense_id === r.id)
      .map((a) => ({
        id: a.id,
        tipo: a.content_type,
        nome: a.original_name,
        dimensione: a.size,
        pagine: a.pages,
        ...(conFile ? { file: a.file } : {}),
      })),
  }));
}

// Utente e organizzazione per intestazioni ed email.
async function chiEInvia(db, { orgId, utenteId }) {
  const { rows } = await db.query(
    `SELECT u.first_name AS nome, u.last_name AS cognome, u.email, o.name AS organizzazione,
            o.submission_email AS destinatario, o.expense_send_mode AS modalita
       FROM users u JOIN organizations o ON o.id = u.organization_id
      WHERE u.id = $1 AND u.organization_id = $2`,
    [utenteId, orgId],
  );
  if (!rows[0]) throw new ErroreHttp(404, 'Non trovato');
  return rows[0];
}

const destinatari = (persona) => ({
  a: persona.destinatario?.toLowerCase() ?? null,
  cc: persona.email.toLowerCase() === persona.destinatario?.toLowerCase() ? [] : [persona.email.toLowerCase()],
});

function pdf(persona, spese, { titolo, sottotitolo }) {
  return generaPdfSpese({
    organizzazione: persona.organizzazione,
    nome: persona.nome,
    cognome: persona.cognome,
    titolo,
    sottotitolo,
    spese: spese.map((s) => ({ ...s, allegati: s.allegati.map((a) => ({ content_type: a.tipo, file: a.file, pagine: a.pagine })) })),
  });
}

const titoloMese = (anno, mese) => `Rimborso spese – ${NOMI_MESI[mese - 1]} ${anno}`;

// PDF delle spese del mese non ancora inviate da sole, generato ora:
// { buffer, nomeFile } oppure null se non ce ne sono.
async function pdfSpeseMese(db, chi, sottotitolo) {
  const persona = await chiEInvia(db, chi);
  const spese = await leggiSpese(db, { ...chi, conFile: true, soloDaInviare: true });
  if (!spese.length) return null;
  return {
    buffer: await pdf(persona, spese, { titolo: titoloMese(chi.anno, chi.mese), sottotitolo }),
    nomeFile: nomeFileSpese({ ...chi, cognome: persona.cognome }),
  };
}

const troppoGrande = (byte, config) =>
  new ErroreHttp(
    409,
    `Il PDF delle spese sarebbe di ${mb(byte)}: l'email alla segreteria può portare al massimo ${mb(limiteByte(config))}. ` +
      'Togli qualche ricevuta in PDF (o sostituiscila con una foto, che viene ridotta) e riprova.',
  );

// Ultimo invio delle spese del mese insieme al mese, con la sua email.
async function ultimoInvioSpeseMese(db, { orgId, utenteId, anno, mese }) {
  const { rows } = await db.query(
    `SELECT s.id, s.submitted_at, s.expense_count,
            (SELECT e.id FROM email_outbox e WHERE e.attachment_expense_submission_id = s.id ORDER BY e.created_at DESC LIMIT 1) AS email_id
       FROM expense_submissions s
      WHERE s.user_id = $1 AND s.organization_id = $2 AND s.year = $3 AND s.month = $4 AND s.mode = 'mese'
      ORDER BY s.submitted_at DESC LIMIT 1`,
    [utenteId, orgId, anno, mese],
  );
  return rows[0] ?? null;
}

// Cosa partirebbe con l'invio del mese: null se nessuna email delle spese,
// altrimenti { spese, buffer, nomeFile, totale, precedente, annulla }.
// Senza spese parte un'email solo se il precedente invio ne aveva (per
// annullarle).
async function preparaSpeseMese(db, chi, sottotitolo) {
  const persona = await chiEInvia(db, chi);
  const spese = await leggiSpese(db, { ...chi, conFile: true, soloDaInviare: true });
  const precedente = await ultimoInvioSpeseMese(db, chi);
  if (!spese.length && !(precedente?.expense_count > 0)) return null;
  return {
    persona,
    spese,
    buffer: spese.length ? await pdf(persona, spese, { titolo: titoloMese(chi.anno, chi.mese), sottotitolo }) : null,
    nomeFile: spese.length ? nomeFileSpese({ ...chi, cognome: persona.cognome }) : null,
    totale: spese.reduce((t, s) => t + s.importo_centesimi, 0),
    precedente,
    annulla: !spese.length,
  };
}

// Riepilogo per la schermata di invio del mese.
async function riepilogoSpeseMese(db, chi, config) {
  const p = await preparaSpeseMese(db, chi, 'Anteprima');
  if (!p) return null;
  const d = destinatari(p.persona);
  return {
    numero: p.spese.length,
    totale_centesimi: p.totale,
    nome_file: p.nomeFile,
    dimensione: p.buffer?.length ?? 0,
    limite: limiteByte(config),
    troppo_grande: Boolean(p.buffer && p.buffer.length > limiteByte(config)),
    destinatario: d.a,
    copia: d.cc,
    sostituisce: p.precedente ? p.precedente.submitted_at : null,
    annulla: p.annulla,
  };
}

async function registraInvio(client, { chi, persona, modo, monthSubmissionId = null, buffer, nomeFile, numero, totale }) {
  const d = destinatari(persona);
  if (!d.a) throw new ErroreHttp(409, "Manca l'indirizzo della segreteria a cui inviare le spese: avvisa l'amministratore.");
  const { rows } = await client.query(
    `INSERT INTO expense_submissions
       (organization_id, user_id, year, month, mode, month_submission_id, file, file_name, file_sha256,
        expense_count, total_cents, to_address, cc_addresses)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id, submitted_at`,
    [
      chi.orgId,
      chi.utenteId,
      chi.anno,
      chi.mese,
      modo,
      monthSubmissionId,
      buffer,
      nomeFile,
      buffer ? crypto.createHash('sha256').update(buffer).digest('hex') : null,
      numero,
      totale,
      d.a,
      d.cc,
    ],
  );
  return { ...rows[0], destinatari: d };
}

// Con l'invio del mese (nella sua transazione, utente già bloccato):
// seconda email con il PDF delle spese, se ce ne sono o se vanno annullate
// quelle inviate prima. Restituisce l'id dell'invio delle spese o null.
async function inviaSpeseConMese(client, chi, monthSubmissionId, config) {
  const p = await preparaSpeseMese(client, chi, `Inviato il ${dataOraIt(new Date())}`);
  if (!p) return null;
  if (p.buffer && p.buffer.length > limiteByte(config)) throw troppoGrande(p.buffer.length, config);
  const invio = await registraInvio(client, {
    chi,
    persona: p.persona,
    modo: 'mese',
    monthSubmissionId,
    buffer: p.buffer,
    nomeFile: p.nomeFile,
    numero: p.spese.length,
    totale: p.totale,
  });
  const testo = emailSpese({
    nome: p.persona.nome,
    cognome: p.persona.cognome,
    anno: chi.anno,
    mese: chi.mese,
    nomeFile: p.nomeFile,
    organizzazione: p.persona.organizzazione,
    numero: p.spese.length,
    totale: euro(p.totale),
    sostituisce: p.precedente?.submitted_at ?? null,
    annulla: p.annulla,
  });
  await accodaEmail(client, {
    organizzazioneId: chi.orgId,
    tipo: 'invio_spese',
    utenteId: chi.utenteId,
    nomeMittente: testo.nomeMittente,
    rispondiA: p.persona.email,
    a: [invio.destinatari.a],
    cc: invio.destinatari.cc,
    oggetto: testo.oggetto,
    testo: testo.testo,
    allegatoSpeseId: invio.id,
    riferimentoId: p.precedente?.email_id ?? null,
  });
  return invio.id;
}

// Modalità "subito": invia una spesa appena confermata (nella transazione
// che l'ha salvata, utente già bloccato) e la rende di sola lettura.
async function inviaSpesaSubito(client, chi, spesaId, config) {
  const persona = await chiEInvia(client, chi);
  const [spesa] = await leggiSpese(client, { ...chi, spesaId, conFile: true });
  const buffer = await pdf(persona, [spesa], {
    titolo: `Rimborso spesa del ${dataBreve(spesa.data)}`,
    sottotitolo: `Inviata il ${dataOraIt(new Date())}`,
  });
  if (buffer.length > limiteByte(config)) throw troppoGrande(buffer.length, config);
  const nomeFile = nomeFileSpesa({ data: spesa.data, cognome: persona.cognome });
  const anno = Number(spesa.data.slice(0, 4));
  const mese = Number(spesa.data.slice(5, 7));
  const invio = await registraInvio(client, {
    chi: { ...chi, anno, mese },
    persona,
    modo: 'subito',
    buffer,
    nomeFile,
    numero: 1,
    totale: spesa.importo_centesimi,
  });
  await client.query('UPDATE expenses SET submission_id = $3 WHERE id = $1 AND organization_id = $2', [spesaId, chi.orgId, invio.id]);
  const testo = emailSpese({
    nome: persona.nome,
    cognome: persona.cognome,
    anno,
    mese,
    data: spesa.data,
    nomeFile,
    organizzazione: persona.organizzazione,
    numero: 1,
    totale: euro(spesa.importo_centesimi),
  });
  await accodaEmail(client, {
    organizzazioneId: chi.orgId,
    tipo: 'invio_spese',
    utenteId: chi.utenteId,
    nomeMittente: testo.nomeMittente,
    rispondiA: persona.email,
    a: [invio.destinatari.a],
    cc: invio.destinatari.cc,
    oggetto: testo.oggetto,
    testo: testo.testo,
    allegatoSpeseId: invio.id,
  });
}

// PDF delle spese del mese da scaricare: quello inviato con l'ultima
// versione, se il mese è inviato; altrimenti generato ora. 404 se non c'è.
async function fileSpeseMese(db, chi) {
  const { rows } = await db.query(
    `SELECT es.file, es.file_name
       FROM month_submissions s
       JOIN month_submission_versions v
         ON v.user_id = s.user_id AND v.organization_id = s.organization_id AND v.year = s.year AND v.month = s.month
       LEFT JOIN expense_submissions es ON es.month_submission_id = v.id
      WHERE s.user_id = $1 AND s.organization_id = $2 AND s.year = $3 AND s.month = $4 AND s.status = 'inviato'
      ORDER BY v.version DESC LIMIT 1`,
    [chi.utenteId, chi.orgId, chi.anno, chi.mese],
  );
  if (rows[0]) {
    if (!rows[0].file) throw new ErroreHttp(404, 'Con questo mese non sono state inviate spese.');
    return { buffer: rows[0].file, nomeFile: rows[0].file_name };
  }
  const file = await pdfSpeseMese(db, chi, `Anteprima del ${dataOraIt(new Date())}: non ancora inviato`);
  if (!file) throw new ErroreHttp(404, 'Nessuna spesa da inviare in questo mese.');
  return file;
}

// PDF delle spese inviato con una versione del mese.
async function fileSpeseVersione(db, { orgId, utenteId, anno, mese, versione }) {
  if (!/^\d{1,6}$/.test(versione ?? '')) throw new ErroreHttp(404, 'Non trovato');
  const { rows } = await db.query(
    `SELECT es.file, es.file_name
       FROM month_submission_versions v
       JOIN expense_submissions es ON es.month_submission_id = v.id
      WHERE v.user_id = $1 AND v.organization_id = $2 AND v.year = $3 AND v.month = $4 AND v.version = $5
        AND es.file IS NOT NULL`,
    [utenteId, orgId, anno, mese, Number(versione)],
  );
  if (!rows[0]) throw new ErroreHttp(404, 'Non trovato');
  return { buffer: rows[0].file, nomeFile: rows[0].file_name };
}

// PDF con cui è partita una spesa inviata da sola.
async function fileSpesaInviata(db, { orgId, utenteId, spesaId }) {
  const { rows } = await db.query(
    `SELECT s.file, s.file_name
       FROM expenses e JOIN expense_submissions s ON s.id = e.submission_id AND s.organization_id = e.organization_id
      WHERE e.id = $1 AND e.user_id = $2 AND e.organization_id = $3`,
    [spesaId, utenteId, orgId],
  );
  if (!rows[0]) throw new ErroreHttp(404, 'Non trovato');
  return { buffer: rows[0].file, nomeFile: rows[0].file_name };
}

// Una ricevuta. soloSalvate = senza quelle di spese non ancora salvate
// (l'amministratore non vede le bozze).
async function fileAllegato(db, { orgId, utenteId, allegatoId, soloSalvate = false }) {
  const { rows } = await db.query(
    `SELECT file, content_type, original_name FROM expense_attachments
      WHERE id = $1 AND user_id = $2 AND organization_id = $3 AND (NOT $4::boolean OR expense_id IS NOT NULL)`,
    [allegatoId, utenteId, orgId, soloSalvate],
  );
  if (!rows[0]) throw new ErroreHttp(404, 'Non trovato');
  return rows[0];
}

// Ricevuta come risposta: le foto si mostrano nella pagina, i PDF si scaricano.
function inviaAllegato(res, a) {
  res.set('Cache-Control', 'private, no-store');
  res.set('Content-Security-Policy', "default-src 'none'; sandbox");
  res.type(a.content_type);
  if (a.content_type === 'application/pdf') res.attachment(a.original_name);
  else res.set('Content-Disposition', 'inline');
  res.send(a.file);
}

module.exports = {
  leggiSpese,
  limiteByte,
  SPAZIO_RIEPILOGO,
  riepilogoSpeseMese,
  inviaSpeseConMese,
  inviaSpesaSubito,
  fileSpeseMese,
  fileSpeseVersione,
  fileSpesaInviata,
  fileAllegato,
  inviaAllegato,
  troppoGrande,
};
