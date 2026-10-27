const crypto = require('node:crypto');
const express = require('express');
const { transazione } = require('../db');
const { ErroreHttp } = require('../errori');
const { leggiAnnoMese, giorniNelMese } = require('../validazione');
const { nomeFileMensile } = require('../excel/foglio-mensile');
const { inItalia } = require('../tempo');
const { accodaEmail } = require('../posta/coda');
const { emailInvioMese } = require('../posta/messaggi');
const { destinatariMese, elencoInvii } = require('../invio-mese');
const { leggiDatiMese, generaFileMese, totaliMese } = require('./esportazione');
const { riepilogoSpeseMese, inviaSpeseConMese } = require('../spese/invio');

// Invio del proprio mese alla segreteria. Come per le altre registrazioni
// personali, l'utente è sempre req.utente.id: nessuno invia il mese di un
// altro. Riapertura e solleciti (amministratore) sono in collaboratori.js.
// Se nel mese ci sono spese da rimborsare parte anche una seconda email,
// solo alla segreteria, con il PDF delle spese (spese/invio.js).
function rotteInvio({ pool, config }) {
  const router = express.Router();

  function periodo(params) {
    const am = leggiAnnoMese(params.anno, params.mese);
    if (!am) throw new ErroreHttp(400, 'Mese non valido');
    return am;
  }

  const senzaIndirizzo = () =>
    new ErroreHttp(409, "Manca l'indirizzo della segreteria a cui inviare il file: avvisa l'amministratore.");

  // Avvisi prima dell'invio (non impediscono di inviare).
  function avvisi(anno, mese, dati) {
    const oggi = inItalia();
    const indice = (a, m) => a * 12 + m;
    let giorniMancanti = 0;
    if (indice(anno, mese) > indice(oggi.anno, oggi.mese)) giorniMancanti = null; // mese futuro
    else if (indice(anno, mese) === indice(oggi.anno, oggi.mese)) giorniMancanti = giorniNelMese(anno, mese) - oggi.giorno;
    return {
      mese_futuro: giorniMancanti === null,
      // Giorni del mese dopo oggi (0 = oggi è l'ultimo giorno).
      giorni_mancanti: giorniMancanti,
      mese_non_finito: giorniMancanti === null || indice(anno, mese) === indice(oggi.anno, oggi.mese),
      vuoto: dati.registrazioni.length === 0,
    };
  }

  // Riepilogo prima dell'invio: totali, nome del file, destinatari, avvisi;
  // spese = cosa partirebbe con la seconda email (null = nessuna email).
  router.get('/mese/:anno/:mese/invio', async (req, res) => {
    const { anno, mese } = periodo(req.params);
    const u = req.utente;
    const chi = { orgId: u.organizzazioneId, utenteId: u.id, anno, mese };
    const r = await transazione(pool, async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      const dati = await leggiDatiMese(client, chi);
      const stato = await client.query(
        'SELECT status FROM month_submissions WHERE user_id = $1 AND organization_id = $2 AND year = $3 AND month = $4',
        [u.id, u.organizzazioneId, anno, mese],
      );
      return {
        dati,
        destinatari: await destinatariMese(client, chi),
        stato: stato.rows[0]?.status ?? 'aperto',
        invii: await elencoInvii(client, chi),
        spese: await riepilogoSpeseMese(client, chi, config),
      };
    });
    const precedente = r.invii[0];
    res.json({
      anno,
      mese,
      stato: r.stato,
      nome_file: nomeFileMensile(r.dati.modello.layout, { anno, mese, nome: r.dati.utente.nome, cognome: r.dati.utente.cognome }),
      destinatario: r.destinatari.a,
      copia: r.destinatari.cc,
      totali: totaliMese(r.dati),
      avvisi: avvisi(anno, mese, r.dati),
      // Dopo una riapertura il nuovo invio sostituisce il precedente.
      sostituisce: precedente ? { versione: precedente.versione, inviato_il: precedente.inviato_il } : null,
      spese: r.spese,
    });
  });

  // Invia il mese: genera il file, lo salva così com'è con destinatari, data
  // e ora, mette in coda l'email e blocca il mese (sola lettura).
  router.post('/mese/:anno/:mese/invio', async (req, res) => {
    const { anno, mese } = periodo(req.params);
    const u = req.utente;
    const chi = { orgId: u.organizzazioneId, utenteId: u.id, anno, mese };
    await transazione(pool, async (client) => {
      // Stesso blocco delle modifiche alle ore: mentre si genera il file
      // nessuna modifica dello stesso utente può inserirsi, e due invii
      // contemporanei vanno in fila (il secondo trova il mese già inviato).
      const { rows: utenti } = await client.query(
        'SELECT email FROM users WHERE id = $1 AND organization_id = $2 AND active FOR NO KEY UPDATE',
        [u.id, u.organizzazioneId],
      );
      if (!utenti[0]) throw new ErroreHttp(401, 'Utente non più attivo');
      const stato = await client.query(
        'SELECT status FROM month_submissions WHERE user_id = $1 AND organization_id = $2 AND year = $3 AND month = $4',
        [u.id, u.organizzazioneId, anno, mese],
      );
      if (stato.rows[0]?.status === 'inviato') throw new ErroreHttp(409, 'Il mese è già stato inviato.');

      const destinatari = await destinatariMese(client, chi);
      if (!destinatari.a) throw senzaIndirizzo();
      const dati = await leggiDatiMese(client, chi);
      const file = await generaFileMese(dati);
      const totali = totaliMese(dati);

      const { rows: prec } = await client.query(
        `SELECT v.version, v.submitted_at,
                (SELECT e.id FROM email_outbox e WHERE e.attachment_submission_id = v.id ORDER BY e.created_at DESC LIMIT 1) AS email_id
           FROM month_submission_versions v
          WHERE v.user_id = $1 AND v.organization_id = $2 AND v.year = $3 AND v.month = $4
          ORDER BY v.version DESC LIMIT 1`,
        [u.id, u.organizzazioneId, anno, mese],
      );
      const precedente = prec[0];
      const versione = (precedente?.version ?? 0) + 1;
      const { rows: nuova } = await client.query(
        `INSERT INTO month_submission_versions
           (organization_id, user_id, year, month, version, file, file_name, file_sha256, template_version,
            to_address, cc_addresses, total_hours, total_sessions, pt_sessions)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING id`,
        [
          u.organizzazioneId,
          u.id,
          anno,
          mese,
          versione,
          file.buffer,
          file.nomeFile,
          crypto.createHash('sha256').update(file.buffer).digest('hex'),
          dati.modello.version,
          destinatari.a,
          destinatari.cc,
          totali.ore,
          totali.sedute,
          totali.sedute_pt,
        ],
      );
      await client.query(
        `INSERT INTO month_submissions (organization_id, user_id, year, month, status, submitted_at)
         VALUES ($1, $2, $3, $4, 'inviato', now())
         ON CONFLICT (user_id, year, month) DO UPDATE SET status = 'inviato', submitted_at = now()`,
        [u.organizzazioneId, u.id, anno, mese],
      );
      const org = await client.query('SELECT name FROM organizations WHERE id = $1', [u.organizzazioneId]);
      const email = emailInvioMese({
        nome: dati.utente.nome,
        cognome: dati.utente.cognome,
        anno,
        mese,
        nomeFile: file.nomeFile,
        organizzazione: org.rows[0].name,
        versione,
        sostituisce: precedente?.submitted_at ?? null,
      });
      await accodaEmail(client, {
        organizzazioneId: u.organizzazioneId,
        tipo: 'invio_mese',
        utenteId: u.id,
        nomeMittente: email.nomeMittente,
        rispondiA: utenti[0].email,
        a: [destinatari.a],
        cc: destinatari.cc,
        oggetto: email.oggetto,
        testo: email.testo,
        allegatoInvioId: nuova[0].id,
        riferimentoId: precedente?.email_id ?? null,
      });
      // Seconda email con le spese; se il PDF è troppo grande l'invio del
      // mese si annulla tutto, con un messaggio chiaro.
      await inviaSpeseConMese(client, chi, nuova[0].id, config);
    });
    res.status(201).json({ anno, mese, stato: 'inviato', invii: await elencoInvii(pool, chi) });
  });

  return router;
}

module.exports = { rotteInvio };
