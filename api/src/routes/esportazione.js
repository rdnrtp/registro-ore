const express = require('express');
const { autenticato } = require('../auth');
const { transazione } = require('../db');
const { ErroreHttp } = require('../errori');
const { leggiAnnoMese } = require('../validazione');
const { generaFoglioMensile, ErroreModello } = require('../excel/foglio-mensile');

// Esportazione del file Excel mensile, compilato sul modello dell'organizzazione.
// Come per le altre registrazioni personali, l'utente è sempre req.utente.id:
// ognuno scarica solo i propri mesi, sia aperti sia inviati.
function rotteEsportazione({ pool, config }) {
  const router = express.Router();
  router.use(autenticato(config));

  router.get('/mese/:anno/:mese/excel', async (req, res) => {
    const am = leggiAnnoMese(req.params.anno, req.params.mese);
    if (!am) throw new ErroreHttp(400, 'Mese non valido');
    const { anno, mese } = am;
    const u = req.utente;
    const inizio = `${anno}-${String(mese).padStart(2, '0')}-01`;

    // Tutte le letture nella stessa istantanea del database, così il file non
    // mescola dati prima e dopo una modifica contemporanea.
    const dati = await transazione(pool, async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      const q = async (sql, params) => (await client.query(sql, params)).rows;
      const [utente] = await q(
        'SELECT first_name AS nome, last_name AS cognome FROM users WHERE id = $1 AND organization_id = $2 AND active',
        [u.id, u.organizzazioneId],
      );
      if (!utente) throw new ErroreHttp(401, 'Utente non più attivo');
      const [modello] = await q(
        'SELECT file, layout FROM excel_templates WHERE organization_id = $1 ORDER BY version DESC LIMIT 1',
        [u.organizzazioneId],
      );
      if (!modello) {
        throw new ErroreHttp(503, "Il modello Excel dell'impianto non è ancora stato caricato: avvisa l'amministratore.");
      }
      const attivita = await q(
        'SELECT id, name AS nome, template_row AS riga FROM activities WHERE organization_id = $1',
        [u.organizzazioneId],
      );
      const registrazioni = await q(
        `SELECT EXTRACT(DAY FROM entry_date)::int AS giorno, activity_id AS attivita_id, quantity AS quantita
           FROM time_entries
          WHERE user_id = $1 AND organization_id = $2
            AND entry_date >= $3::date AND entry_date < $3::date + interval '1 month'`,
        [u.id, u.organizzazioneId, inizio],
      );
      const sedutePt = await q(
        `SELECT EXTRACT(DAY FROM session_date)::int AS giorno, kind AS tipo, client_name AS cliente
           FROM pt_sessions
          WHERE user_id = $1 AND organization_id = $2
            AND session_date >= $3::date AND session_date < $3::date + interval '1 month'
          ORDER BY session_date, created_at, id`,
        [u.id, u.organizzazioneId, inizio],
      );
      return { utente, modello, attivita, registrazioni, sedutePt };
    });

    let file;
    try {
      file = await generaFoglioMensile(dati.modello.file, dati.modello.layout, {
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
      console.error(`Esportazione Excel (organizzazione ${u.organizzazioneId}): ${err.message}`);
      throw new ErroreHttp(
        500,
        `Il file Excel non può essere generato perché il modello dell'impianto non corrisponde ai dati (${err.message}). Avvisa l'amministratore.`,
      );
    }

    res.attachment(file.nomeFile);
    res.set('Cache-Control', 'no-store');
    res.send(file.buffer);
  });

  return router;
}

module.exports = { rotteEsportazione };
