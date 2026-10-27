const crypto = require('node:crypto');
const express = require('express');
const { transazione } = require('../db');
const { ErroreHttp } = require('../errori');
const { NOMI_MESI, isUuid, leggiAnnoMese, leggiData, leggiTesto } = require('../validazione');
const { inItalia } = require('../tempo');
const { elaboraAllegato, ErroreAllegato, MAX_FOTO_BYTE, mb } = require('../spese/allegati');
const {
  leggiSpese,
  limiteByte,
  SPAZIO_RIEPILOGO,
  inviaSpesaSubito,
  fileSpeseMese,
  fileSpeseVersione,
  fileSpesaInviata,
  fileAllegato,
  inviaAllegato,
} = require('../spese/invio');
const { inviaFile } = require('./esportazione');

const MAX_ALLEGATI = 5;
const MAX_SPESE_MESE = 60;
// Ricevute caricate ma non ancora legate a una spesa salvata, per utente.
const MAX_BOZZE = 30;

// Spese di trasferta da rimborsare: ogni utente legge e modifica solo le
// proprie (req.utente.id), anche l'amministratore. Le viste sulle spese
// degli altri (solo amministratore) sono in collaboratori.js.
//
// Una spesa si salva in due passi: prima si caricano le ricevute una alla
// volta (POST /spese/allegati: il file viene verificato, ridotto e ripulito
// e resta "in bozza"), poi la spesa con l'elenco delle ricevute.
//
// Sola lettura: con il mese inviato (modalità "insieme al mese") oppure
// quando la spesa è già partita da sola (modalità "subito").
function rotteSpese({ pool, config }) {
  const router = express.Router();
  const nonValido = (messaggio) => new ErroreHttp(400, messaggio);
  const nonTrovato = () => new ErroreHttp(404, 'Non trovato');
  const maxPdfByte = () => limiteByte(config) - SPAZIO_RIEPILOGO;

  async function bloccaUtente(client, u) {
    const { rows } = await client.query(
      'SELECT 1 FROM users WHERE id = $1 AND organization_id = $2 AND active FOR NO KEY UPDATE',
      [u.id, u.organizzazioneId],
    );
    if (!rows[0]) throw new ErroreHttp(401, 'Utente non più attivo');
  }

  async function verificaMeseAperto(client, u, anno, mese) {
    const { rows } = await client.query(
      'SELECT status FROM month_submissions WHERE user_id = $1 AND organization_id = $2 AND year = $3 AND month = $4',
      [u.id, u.organizzazioneId, anno, mese],
    );
    if (rows[0]?.status === 'inviato') {
      throw new ErroreHttp(409, `Il mese di ${NOMI_MESI[mese - 1]} ${anno} è già stato inviato: le sue spese sono in sola lettura.`);
    }
  }

  async function modalita(db, orgId) {
    return (await db.query('SELECT expense_send_mode FROM organizations WHERE id = $1', [orgId])).rows[0].expense_send_mode;
  }

  // ------------------------------------------------------------- Letture

  // Tipi di spesa dell'organizzazione (anche i non attivi, per le spese
  // già registrate con quel tipo).
  router.get('/tipi-spesa', async (req, res) => {
    const { rows } = await pool.query(
      'SELECT id, name AS nome, active AS attivo FROM expense_types WHERE organization_id = $1 ORDER BY sort_order, name',
      [req.utente.organizzazioneId],
    );
    res.json(rows);
  });

  router.get('/mese/:anno/:mese/spese', async (req, res) => {
    const am = leggiAnnoMese(req.params.anno, req.params.mese);
    if (!am) throw nonValido('Mese non valido');
    const u = req.utente;
    const spese = await leggiSpese(pool, { orgId: u.organizzazioneId, utenteId: u.id, ...am });
    const daInviare = spese.filter((s) => !s.inviata);
    res.json({
      ...am,
      modalita: await modalita(pool, u.organizzazioneId),
      spese,
      totale_centesimi: spese.reduce((t, s) => t + s.importo_centesimi, 0),
      // Ricevute che partirebbero con il mese, rispetto al limite dell'email.
      dimensione_ricevute: daInviare.reduce((t, s) => t + s.allegati.reduce((x, a) => x + a.dimensione, 0), 0),
      limite: limiteByte(config) - SPAZIO_RIEPILOGO,
    });
  });

  // PDF delle spese del mese: quello inviato se il mese è inviato,
  // altrimenti un'anteprima generata ora.
  router.get('/mese/:anno/:mese/spese/pdf', async (req, res) => {
    const am = leggiAnnoMese(req.params.anno, req.params.mese);
    if (!am) throw nonValido('Mese non valido');
    inviaFile(res, await fileSpeseMese(pool, { orgId: req.utente.organizzazioneId, utenteId: req.utente.id, ...am }));
  });

  router.get('/mese/:anno/:mese/invii/:versione/spese', async (req, res) => {
    const am = leggiAnnoMese(req.params.anno, req.params.mese);
    if (!am) throw nonValido('Mese non valido');
    const u = req.utente;
    inviaFile(res, await fileSpeseVersione(pool, { orgId: u.organizzazioneId, utenteId: u.id, ...am, versione: req.params.versione }));
  });

  router.get('/spese/:id/pdf', async (req, res) => {
    if (!isUuid(req.params.id)) throw nonTrovato();
    const u = req.utente;
    inviaFile(res, await fileSpesaInviata(pool, { orgId: u.organizzazioneId, utenteId: u.id, spesaId: req.params.id }));
  });

  router.get('/spese/allegati/:id', async (req, res) => {
    if (!isUuid(req.params.id)) throw nonTrovato();
    const u = req.utente;
    inviaAllegato(res, await fileAllegato(pool, { orgId: u.organizzazioneId, utenteId: u.id, allegatoId: req.params.id }));
  });

  // ------------------------------------------------------------ Ricevute

  // Corpo = il file così com'è; nome originale nell'intestazione X-Nome-File.
  // Il limite di Express è quello delle foto (le più grandi): il limite dei
  // PDF lo controlla elaboraAllegato, con un messaggio più chiaro.
  router.post(
    '/spese/allegati',
    express.raw({ type: () => true, limit: MAX_FOTO_BYTE }),
    async (req, res) => {
      const u = req.utente;
      if (!Buffer.isBuffer(req.body) || !req.body.length) throw nonValido('Nessun file ricevuto.');
      let nome = 'ricevuta';
      try {
        nome = decodeURIComponent(req.get('X-Nome-File') ?? '') || nome;
      } catch {
        // nome non valido: si usa quello predefinito
      }
      // eslint-disable-next-line no-control-regex
      nome = nome.replace(/[\x00-\x1f\\/]+/g, '_').trim().slice(0, 150) || 'ricevuta';
      const { rows: bozze } = await pool.query(
        'SELECT count(*)::int AS n FROM expense_attachments WHERE user_id = $1 AND organization_id = $2 AND expense_id IS NULL',
        [u.id, u.organizzazioneId],
      );
      if (bozze[0].n >= MAX_BOZZE) {
        throw new ErroreHttp(429, 'Hai caricato molte ricevute senza salvare le spese: salva o annulla quelle aperte, poi riprova.');
      }
      let elaborato;
      try {
        elaborato = await elaboraAllegato(req.body, { maxPdfByte: maxPdfByte() });
      } catch (err) {
        if (err instanceof ErroreAllegato) throw nonValido(err.message);
        throw err;
      }
      // Le foto diventano JPEG: anche il nome lo dice.
      if (elaborato.tipo === 'image/jpeg') nome = `${nome.replace(/\.[a-z0-9]{1,5}$/i, '')}.jpg`;
      else if (!/\.pdf$/i.test(nome)) nome = `${nome}.pdf`;
      const { rows } = await pool.query(
        `INSERT INTO expense_attachments (organization_id, user_id, content_type, original_name, file, size, sha256, pages)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, content_type AS tipo, original_name AS nome, size AS dimensione, pages AS pagine`,
        [
          u.organizzazioneId,
          u.id,
          elaborato.tipo,
          nome,
          elaborato.buffer,
          elaborato.buffer.length,
          crypto.createHash('sha256').update(elaborato.buffer).digest('hex'),
          elaborato.pagine,
        ],
      );
      res.status(201).json(rows[0]);
    },
  );

  // --------------------------------------------------------------- Spese

  // Corpo: { data, tipo_id, importo_centesimi, motivo, allegati: [id] }.
  function leggiSpesa(b) {
    const data = leggiData(b?.data);
    if (!data) throw nonValido('Data non valida');
    if (data.testo > inItalia().data) throw nonValido('La data della spesa non può essere nel futuro.');
    if (!isUuid(b.tipo_id)) throw nonValido('Scegli il tipo di spesa');
    const importo = b.importo_centesimi;
    if (!Number.isInteger(importo) || importo < 1 || importo > 1_000_000) {
      throw nonValido("Importo non valido: da 0,01 a 10.000,00 euro");
    }
    const motivo = leggiTesto(b.motivo, 'Motivo della trasferta', 300);
    const allegati = b.allegati;
    if (!Array.isArray(allegati) || !allegati.every(isUuid) || new Set(allegati).size !== allegati.length) {
      throw nonValido('Ricevute non valide');
    }
    if (allegati.length < 1) throw nonValido('Allega almeno una ricevuta (foto o PDF).');
    if (allegati.length > MAX_ALLEGATI) throw nonValido(`Al massimo ${MAX_ALLEGATI} ricevute per spesa.`);
    return { data, tipoId: b.tipo_id, importo, motivo, allegati };
  }

  // Spesa propria con il suo mese, oppure 404.
  async function spesaPropria(client, u, id) {
    if (!isUuid(id)) throw nonTrovato();
    const { rows } = await client.query(
      `SELECT type_id, submission_id, EXTRACT(YEAR FROM expense_date)::int AS anno, EXTRACT(MONTH FROM expense_date)::int AS mese
         FROM expenses WHERE id = $1 AND user_id = $2 AND organization_id = $3`,
      [id, u.id, u.organizzazioneId],
    );
    if (!rows[0]) throw nonTrovato();
    if (rows[0].submission_id) throw new ErroreHttp(409, 'La spesa è già stata inviata alla segreteria: è in sola lettura.');
    return rows[0];
  }

  // Verifiche comuni a creazione e modifica; spesaId = null per una nuova.
  async function verifica(client, u, s, spesaId, tipoPrima, modo) {
    const { rows: tipo } = await client.query('SELECT active FROM expense_types WHERE id = $1 AND organization_id = $2', [
      s.tipoId,
      u.organizzazioneId,
    ]);
    if (!tipo[0]) throw nonValido('Tipo di spesa non trovato');
    if (!tipo[0].active && s.tipoId !== tipoPrima) throw nonValido('Questo tipo di spesa non è più in uso: scegline un altro.');

    const { rows: allegati } = await client.query(
      `SELECT id, size FROM expense_attachments
        WHERE organization_id = $1 AND user_id = $2 AND id = ANY($3::uuid[])
          AND (expense_id IS NULL OR expense_id = $4)`,
      [u.organizzazioneId, u.id, s.allegati, spesaId],
    );
    if (allegati.length !== s.allegati.length) throw nonValido('Ricevuta non trovata: caricala di nuovo.');
    const nuove = allegati.reduce((t, a) => t + a.size, 0);

    // Le ricevute devono entrare nel PDF dell'email: quelle di questa spesa
    // da sola ("subito") o con le altre del mese non ancora inviate.
    let altre = 0;
    if (modo === 'mese') {
      const { rows } = await client.query(
        `SELECT COALESCE(sum(a.size), 0)::bigint AS byte, count(DISTINCT e.id)::int AS spese
           FROM expenses e LEFT JOIN expense_attachments a ON a.expense_id = e.id AND a.organization_id = e.organization_id
          WHERE e.user_id = $1 AND e.organization_id = $2 AND e.submission_id IS NULL
            AND e.expense_date >= make_date($3, $4, 1) AND e.expense_date < make_date($3, $4, 1) + interval '1 month'
            AND e.id IS DISTINCT FROM $5`,
        [u.id, u.organizzazioneId, s.data.anno, s.data.mese, spesaId],
      );
      altre = Number(rows[0].byte);
      if (rows[0].spese >= MAX_SPESE_MESE) throw nonValido(`Al massimo ${MAX_SPESE_MESE} spese in un mese.`);
    }
    const limite = limiteByte(config) - SPAZIO_RIEPILOGO;
    if (nuove + altre > limite) {
      throw nonValido(
        modo === 'mese'
          ? `Con queste ricevute le spese di ${NOMI_MESI[s.data.mese - 1]} ${s.data.anno} arriverebbero a ${mb(nuove + altre)}: ` +
              `l'email alla segreteria ne porta al massimo ${mb(limite)}. Usa foto invece di PDF, o meno ricevute.`
          : `Le ricevute sono ${mb(nuove)}: l'email alla segreteria ne porta al massimo ${mb(limite)}. Usa foto invece di PDF.`,
      );
    }
  }

  async function salvaRicevute(client, u, spesaId, allegati) {
    await client.query(
      `DELETE FROM expense_attachments WHERE expense_id = $1 AND organization_id = $2 AND NOT (id = ANY($3::uuid[]))`,
      [spesaId, u.organizzazioneId, allegati],
    );
    await client.query(
      `UPDATE expense_attachments a SET expense_id = $1, position = x.posizione - 1
         FROM unnest($3::uuid[]) WITH ORDINALITY AS x(id, posizione)
        WHERE a.id = x.id AND a.organization_id = $2`,
      [spesaId, u.organizzazioneId, allegati],
    );
  }

  const chi = (u) => ({ orgId: u.organizzazioneId, utenteId: u.id });

  // Modalità "subito": salvare = confermare e inviare.
  router.post('/spese', async (req, res) => {
    const s = leggiSpesa(req.body);
    const u = req.utente;
    const id = await transazione(pool, async (client) => {
      await bloccaUtente(client, u);
      await verificaMeseAperto(client, u, s.data.anno, s.data.mese);
      const modo = await modalita(client, u.organizzazioneId);
      await verifica(client, u, s, null, null, modo);
      const { rows } = await client.query(
        `INSERT INTO expenses (organization_id, user_id, expense_date, type_id, amount_cents, reason)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [u.organizzazioneId, u.id, s.data.testo, s.tipoId, s.importo, s.motivo],
      );
      await salvaRicevute(client, u, rows[0].id, s.allegati);
      if (modo === 'subito') await inviaSpesaSubito(client, chi(u), rows[0].id, config);
      return rows[0].id;
    });
    const [spesa] = await leggiSpese(pool, { ...chi(u), spesaId: id });
    res.status(201).json(spesa);
  });

  // Sia il mese di partenza sia quello di arrivo devono essere aperti.
  router.put('/spese/:id', async (req, res) => {
    const u = req.utente;
    if (!isUuid(req.params.id)) throw nonTrovato();
    const s = leggiSpesa(req.body);
    await transazione(pool, async (client) => {
      await bloccaUtente(client, u);
      const prima = await spesaPropria(client, u, req.params.id);
      await verificaMeseAperto(client, u, prima.anno, prima.mese);
      await verificaMeseAperto(client, u, s.data.anno, s.data.mese);
      const modo = await modalita(client, u.organizzazioneId);
      await verifica(client, u, s, req.params.id, prima.type_id, modo);
      await client.query(
        `UPDATE expenses SET expense_date = $4, type_id = $5, amount_cents = $6, reason = $7, updated_at = now()
          WHERE id = $1 AND user_id = $2 AND organization_id = $3`,
        [req.params.id, u.id, u.organizzazioneId, s.data.testo, s.tipoId, s.importo, s.motivo],
      );
      await salvaRicevute(client, u, req.params.id, s.allegati);
      if (modo === 'subito') await inviaSpesaSubito(client, chi(u), req.params.id, config);
    });
    const [spesa] = await leggiSpese(pool, { ...chi(u), spesaId: req.params.id });
    res.json(spesa);
  });

  router.delete('/spese/:id', async (req, res) => {
    const u = req.utente;
    await transazione(pool, async (client) => {
      await bloccaUtente(client, u);
      const s = await spesaPropria(client, u, req.params.id);
      await verificaMeseAperto(client, u, s.anno, s.mese);
      await client.query('DELETE FROM expenses WHERE id = $1 AND user_id = $2 AND organization_id = $3', [
        req.params.id,
        u.id,
        u.organizzazioneId,
      ]);
    });
    res.json({ ok: true });
  });

  // Ricevuta caricata e non usata (spesa annullata prima di salvarla).
  router.delete('/spese/allegati/:id', async (req, res) => {
    if (!isUuid(req.params.id)) throw nonTrovato();
    const { rowCount } = await pool.query(
      'DELETE FROM expense_attachments WHERE id = $1 AND user_id = $2 AND organization_id = $3 AND expense_id IS NULL',
      [req.params.id, req.utente.id, req.utente.organizzazioneId],
    );
    if (!rowCount) throw nonTrovato();
    res.json({ ok: true });
  });

  return router;
}

// Ricevute caricate e mai legate a una spesa: si cancellano dopo un giorno.
async function pulisciBozzeSpese(pool) {
  const { rowCount } = await pool.query(
    "DELETE FROM expense_attachments WHERE expense_id IS NULL AND created_at < now() - interval '1 day'",
  );
  return rowCount;
}

module.exports = { rotteSpese, pulisciBozzeSpese };
