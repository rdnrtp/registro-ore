const express = require('express');
const { transazione } = require('../db');
const { ErroreHttp } = require('../errori');
const { leggiAnnoMese } = require('../validazione');
const { generaFoglioMensile, ErroreModello } = require('../excel/foglio-mensile');

// File Excel di un mese di un utente, compilato sul modello dell'organizzazione.
// Restituisce { buffer, nomeFile }. orgId e utenteId vengono sempre dal
// chiamante, che ha già verificato i permessi; l'utente deve essere
// dell'organizzazione (altrimenti 404).
async function fileExcelMese(pool, { orgId, utenteId, anno, mese }) {
  const inizio = `${anno}-${String(mese).padStart(2, '0')}-01`;

  // Tutte le letture nella stessa istantanea del database, così il file non
  // mescola dati prima e dopo una modifica contemporanea.
  const dati = await transazione(pool, async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    const q = async (sql, params) => (await client.query(sql, params)).rows;
    const [utente] = await q('SELECT first_name AS nome, last_name AS cognome FROM users WHERE id = $1 AND organization_id = $2', [
      utenteId,
      orgId,
    ]);
    if (!utente) throw new ErroreHttp(404, 'Non trovato');
    const [modello] = await q(
      'SELECT file, layout FROM excel_templates WHERE organization_id = $1 ORDER BY version DESC LIMIT 1',
      [orgId],
    );
    if (!modello) {
      throw new ErroreHttp(503, "Il modello Excel dell'impianto non è ancora stato caricato: avvisa l'amministratore.");
    }
    // Il confronto con il modello usa il nome della riga nel modello, non il
    // nome mostrato nell'app (che l'amministratore può cambiare).
    const attivita = await q(
      'SELECT id, template_label AS nome, template_row AS riga FROM activities WHERE organization_id = $1',
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
    return { utente, modello, attivita, registrazioni, sedutePt };
  });

  try {
    return await generaFoglioMensile(dati.modello.file, dati.modello.layout, {
      anno,
      mese,
      nome: dati.utente.nome,
      cognome: dati.utente.cognome,
      attivita: dati.attivita,
      registrazioni: dati.registrazioni,
      sedutePt: dati.sedutePt,
    });
  } catch (err) {
    if (!(err instanceof ErroreModello)) throw err;
    console.error(`Esportazione Excel (organizzazione ${orgId}): ${err.message}`);
    throw new ErroreHttp(
      500,
      `Il file Excel non può essere generato perché il modello dell'impianto non corrisponde ai dati (${err.message}). Avvisa l'amministratore.`,
    );
  }
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

  router.get('/mese/:anno/:mese/excel', async (req, res) => {
    const am = leggiAnnoMese(req.params.anno, req.params.mese);
    if (!am) throw new ErroreHttp(400, 'Mese non valido');
    const u = req.utente;
    inviaFile(res, await fileExcelMese(pool, { orgId: u.organizzazioneId, utenteId: u.id, ...am }));
  });

  return router;
}

module.exports = { rotteEsportazione, fileExcelMese, inviaFile };
