const express = require('express');
const { transazione } = require('../db');
const { ErroreHttp } = require('../errori');
const { leggiAnnoMese } = require('../validazione');
const { generaFoglioMensile, ErroreModello } = require('../excel/foglio-mensile');

const nessunModello = () =>
  new ErroreHttp(503, "Il modello Excel dell'impianto non è ancora stato caricato: avvisa l'amministratore.");

// Dati per il file del mese di un utente, letti con il client indicato (una
// transazione: tutto dalla stessa istantanea, o con la riga dell'utente
// bloccata). L'utente deve essere dell'organizzazione, altrimenti 404.
async function leggiDatiMese(client, { orgId, utenteId, anno, mese }) {
  const inizio = `${anno}-${String(mese).padStart(2, '0')}-01`;
  const q = async (sql, params) => (await client.query(sql, params)).rows;
  const [utente] = await q('SELECT first_name AS nome, last_name AS cognome FROM users WHERE id = $1 AND organization_id = $2', [
    utenteId,
    orgId,
  ]);
  if (!utente) throw new ErroreHttp(404, 'Non trovato');
  const [modello] = await q(
    'SELECT file, layout, version FROM excel_templates WHERE organization_id = $1 ORDER BY version DESC LIMIT 1',
    [orgId],
  );
  if (!modello) throw nessunModello();
  // Il confronto con il modello usa il nome della riga nel modello, non il
  // nome mostrato nell'app (che l'amministratore può cambiare).
  const attivita = await q(
    'SELECT id, template_label AS nome, template_row AS riga, unit AS unita FROM activities WHERE organization_id = $1',
    [orgId],
  );
  const registrazioni = await q(
    `SELECT EXTRACT(DAY FROM entry_date)::int AS giorno, activity_id AS attivita_id, quantity AS quantita
       FROM time_entries
      WHERE user_id = $1 AND organization_id = $2
        AND entry_date >= $3::date AND entry_date < $3::date + interval '1 month'`,
    [utenteId, orgId, inizio],
  );
  const sedutePt = await q(
    `SELECT EXTRACT(DAY FROM session_date)::int AS giorno, kind AS tipo, client_name AS cliente
       FROM pt_sessions
      WHERE user_id = $1 AND organization_id = $2
        AND session_date >= $3::date AND session_date < $3::date + interval '1 month'
      ORDER BY session_date, created_at, id`,
    [utenteId, orgId, inizio],
  );
  return { orgId, anno, mese, utente, modello, attivita, registrazioni, sedutePt };
}

// Totali del mese: ore, sedute della griglia, sedute PT con nome del cliente.
function totaliMese(dati) {
  const unita = new Map(dati.attivita.map((a) => [a.id, a.unita]));
  let ore = 0;
  let sedute = 0;
  for (const r of dati.registrazioni) {
    if (unita.get(r.attivita_id) === 'sedute') sedute += r.quantita;
    else ore += r.quantita;
  }
  return { ore, sedute, sedute_pt: dati.sedutePt.length };
}

// Compila il modello con i dati: { buffer, nomeFile }.
async function generaFileMese(dati) {
  try {
    return await generaFoglioMensile(dati.modello.file, dati.modello.layout, {
      anno: dati.anno,
      mese: dati.mese,
      nome: dati.utente.nome,
      cognome: dati.utente.cognome,
      attivita: dati.attivita,
      registrazioni: dati.registrazioni,
      sedutePt: dati.sedutePt,
    });
  } catch (err) {
    if (!(err instanceof ErroreModello)) throw err;
    console.error(`Esportazione Excel (organizzazione ${dati.orgId}): ${err.message}`);
    throw new ErroreHttp(
      500,
      `Il file Excel non può essere generato perché il modello dell'impianto non corrisponde ai dati (${err.message}). Avvisa l'amministratore.`,
    );
  }
}

// File Excel di un mese di un utente. Restituisce { buffer, nomeFile }.
// orgId e utenteId vengono sempre dal chiamante, che ha già verificato i
// permessi. Un mese inviato restituisce il file salvato al momento
// dell'invio, identico byte per byte; un mese aperto viene generato ora.
async function fileExcelMese(pool, { orgId, utenteId, anno, mese }) {
  // Tutte le letture nella stessa istantanea del database, così il file non
  // mescola dati prima e dopo una modifica contemporanea.
  const risultato = await transazione(pool, async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    const { rows } = await client.query(
      `SELECT v.file, v.file_name
         FROM month_submissions s
         JOIN month_submission_versions v
           ON v.user_id = s.user_id AND v.organization_id = s.organization_id AND v.year = s.year AND v.month = s.month
        WHERE s.user_id = $1 AND s.organization_id = $2 AND s.year = $3 AND s.month = $4 AND s.status = 'inviato'
        ORDER BY v.version DESC LIMIT 1`,
      [utenteId, orgId, anno, mese],
    );
    if (rows[0]) return { salvato: { buffer: rows[0].file, nomeFile: rows[0].file_name } };
    return { dati: await leggiDatiMese(client, { orgId, utenteId, anno, mese }) };
  });
  return risultato.salvato ?? generaFileMese(risultato.dati);
}

// Una versione inviata, per numero: { buffer, nomeFile } oppure 404.
async function fileInviato(pool, { orgId, utenteId, anno, mese, versione }) {
  if (!/^\d{1,6}$/.test(versione ?? '')) throw new ErroreHttp(404, 'Non trovato');
  const { rows } = await pool.query(
    `SELECT file, file_name FROM month_submission_versions
      WHERE user_id = $1 AND organization_id = $2 AND year = $3 AND month = $4 AND version = $5`,
    [utenteId, orgId, anno, mese, Number(versione)],
  );
  if (!rows[0]) throw new ErroreHttp(404, 'Non trovato');
  return { buffer: rows[0].file, nomeFile: rows[0].file_name };
}

function inviaFile(res, file) {
  res.attachment(file.nomeFile);
  res.set('Cache-Control', 'no-store');
  res.send(file.buffer);
}

// Il proprio file del mese: l'utente è sempre req.utente.id, sia per i mesi
// aperti sia per quelli inviati. I file degli altri sono in collaboratori.js.
function rotteEsportazione({ pool }) {
  const router = express.Router();

  const periodo = (params) => {
    const am = leggiAnnoMese(params.anno, params.mese);
    if (!am) throw new ErroreHttp(400, 'Mese non valido');
    return am;
  };

  router.get('/mese/:anno/:mese/excel', async (req, res) => {
    const u = req.utente;
    inviaFile(res, await fileExcelMese(pool, { orgId: u.organizzazioneId, utenteId: u.id, ...periodo(req.params) }));
  });

  // Una delle versioni inviate (anche quelle sostituite dopo una riapertura).
  router.get('/mese/:anno/:mese/invii/:versione/file', async (req, res) => {
    const u = req.utente;
    const am = periodo(req.params);
    inviaFile(res, await fileInviato(pool, { orgId: u.organizzazioneId, utenteId: u.id, ...am, versione: req.params.versione }));
  });

  return router;
}

module.exports = { rotteEsportazione, fileExcelMese, fileInviato, leggiDatiMese, generaFileMese, totaliMese, inviaFile, nessunModello };
