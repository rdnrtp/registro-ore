const express = require('express');
const { richiediRuolo } = require('../auth');
const { transazione } = require('../db');
const { ErroreHttp } = require('../errori');
const { validaLayout } = require('../excel/layout');
const {
  ErroreFileModello,
  leggiRigheAttivita,
  confrontaAttivita,
  provaGenerazione,
  applicaAttivita,
  salvaVersione,
  attivitaEsistenti,
  riassunto,
  descriviMancanti,
  sha256,
} = require('../excel/modello');
const { traccia } = require('../traccia');

const MAX_DIMENSIONE = 5 * 1024 * 1024;
const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Modello Excel dell'organizzazione, solo per l'amministratore. Un nuovo file
// deve avere la stessa disposizione delle celle di quello in uso: si valida
// con la mappa esistente (che dall'app non si modifica) e con una prova di
// generazione, come fa il comando carica-organizzazione.
function rotteModello({ pool }) {
  const router = express.Router();
  router.use('/modello', richiediRuolo('amministratore'));

  async function ultimo(db, orgId, conFile = false) {
    const { rows } = await db.query(
      `SELECT version AS versione, file_name AS nome_file, sha256, layout, created_at AS caricato_il
              ${conFile ? ', file' : ''}
         FROM excel_templates WHERE organization_id = $1 ORDER BY version DESC LIMIT 1`,
      [orgId],
    );
    return rows[0];
  }

  router.get('/modello', async (req, res) => {
    const { rows } = await pool.query(
      `SELECT version AS versione, file_name AS nome_file, created_at AS caricato_il
         FROM excel_templates WHERE organization_id = $1 ORDER BY version DESC`,
      [req.utente.organizzazioneId],
    );
    res.json({ versioni: rows });
  });

  // Il file del modello in uso, per controllarlo.
  router.get('/modello/file', async (req, res) => {
    const m = await ultimo(pool, req.utente.organizzazioneId, true);
    if (!m) throw new ErroreHttp(404, 'Nessun modello caricato');
    res.attachment(m.nome_file);
    res.set('Cache-Control', 'no-store');
    res.type(TIPO_XLSX).send(m.file);
  });

  // Corpo: il file .xlsx (non JSON). Intestazione X-Nome-File: nome del file,
  // codificato con encodeURIComponent. ?anteprima=1: verifica e descrive i
  // cambiamenti senza salvare nulla.
  router.post(
    '/modello',
    express.raw({ type: () => true, limit: MAX_DIMENSIONE }),
    async (req, res) => {
      const buffer = req.body;
      if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new ErroreHttp(400, 'Nessun file ricevuto');
      let nomeFile = 'modello.xlsx';
      try {
        nomeFile = decodeURIComponent(req.get('X-Nome-File') ?? nomeFile).slice(0, 200) || nomeFile;
      } catch {
        // nome non decodificabile: si tiene quello predefinito
      }
      if (!/\.xlsx$/i.test(nomeFile)) throw new ErroreHttp(400, 'Il modello deve essere un file .xlsx');
      const anteprima = req.query.anteprima === '1';
      const org = req.utente.organizzazioneId;

      const attuale = await ultimo(pool, org);
      if (!attuale) {
        throw new ErroreHttp(409, 'Questo impianto non ha ancora un modello: il primo si carica con il comando carica-organizzazione.');
      }
      const layout = validaLayout(attuale.layout);
      if (sha256(buffer) === attuale.sha256) {
        throw new ErroreHttp(409, `Questo file è identico al modello in uso (versione ${attuale.versione}).`);
      }

      const rifiuta = (motivo) =>
        new ErroreHttp(400, `Il file non può essere usato come modello: ${motivo}. Il modello in uso non è cambiato.`);
      let righe;
      try {
        righe = await leggiRigheAttivita(buffer, layout);
        await provaGenerazione(buffer, layout, righe);
      } catch (err) {
        if (err instanceof ErroreFileModello) throw rifiuta(err.message);
        throw err;
      }

      const risultato = await transazione(pool, async (client) => {
        // Un caricamento alla volta per organizzazione.
        await client.query('SELECT 1 FROM organizations WHERE id = $1 FOR UPDATE', [org]);
        const confronto = confrontaAttivita(await attivitaEsistenti(client, org), righe);
        if (confronto.mancanti.length) {
          throw rifiuta(`mancano attività che esistono nell'app: ${descriviMancanti(confronto.mancanti)}`);
        }
        const cambiamenti = riassunto(confronto);
        if (anteprima) return { anteprima: true, cambiamenti };
        try {
          await applicaAttivita(client, org, confronto);
        } catch (err) {
          if (err instanceof ErroreFileModello) throw rifiuta(err.message);
          throw err;
        }
        const versione = await salvaVersione(client, org, { buffer, nomeFile, layout });
        await traccia(client, {
          organizzazioneId: org,
          utente: req.utente,
          azione: 'modello.caricato',
          dettagli: { versione: versione.versione, nome_file: nomeFile, sha256: versione.sha256, ...cambiamenti },
        });
        return { versione: versione.versione, nome_file: nomeFile, cambiamenti };
      });
      res.status(anteprima ? 200 : 201).json(risultato);
    },
  );

  return router;
}

module.exports = { rotteModello };
