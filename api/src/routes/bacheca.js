const express = require('express');
const { richiediRuolo } = require('../auth');
const { transazione } = require('../db');
const { ErroreHttp } = require('../errori');
const { isUuid, leggiTesto } = require('../validazione');
const { traccia, differenze } = require('../traccia');
const { notifica, NOME_APP } = require('../notifiche');

const MAX_TESTO = 5000;

// L'utente (espressione SQL, per esempio $2 o u.id) è destinatario
// dell'avviso a: avviso per tutti, oppure per un settore di cui l'utente ha
// un'attività tra "Le mie attività" o di cui è responsabile.
const destinatario = (u) => `(a.for_everyone OR EXISTS (
  SELECT 1 FROM announcement_sectors x
   WHERE x.announcement_id = a.id AND x.organization_id = a.organization_id
     AND (EXISTS (SELECT 1 FROM user_activities ua
                    JOIN activity_sectors s ON s.activity_id = ua.activity_id AND s.organization_id = ua.organization_id
                   WHERE ua.user_id = ${u} AND ua.organization_id = a.organization_id AND s.sector_id = x.sector_id)
          OR EXISTS (SELECT 1 FROM sector_managers m
                      WHERE m.user_id = ${u} AND m.organization_id = a.organization_id AND m.sector_id = x.sector_id))))`;

// Letto = aperto dopo l'ultima versione del testo.
const LETTO = 'r.read_at >= COALESCE(a.updated_at, a.published_at)';

// Bacheca: l'amministratore pubblica avvisi, i destinatari li leggono.
// Comunicazione a senso unico: nessuna risposta. Gli avvisi ritirati spariscono
// per i destinatari e restano visibili all'amministratore.
function rotteBacheca({ pool, config }) {
  const router = express.Router();
  const soloAdmin = richiediRuolo('amministratore');

  const nonTrovato = () => new ErroreHttp(404, 'Non trovato');
  const nonValido = (messaggio) => new ErroreHttp(400, messaggio);
  const eAdmin = (req) => req.utente.ruolo === 'amministratore';

  // ------------------------------------------------------ Destinatari

  router.get('/avvisi', async (req, res) => {
    const { rows } = await pool.query(
      `SELECT a.id, a.title AS titolo, a.body AS testo, a.important AS importante,
              a.published_at AS pubblicato_il, a.updated_at AS modificato_il,
              au.first_name || ' ' || au.last_name AS autore,
              r.read_at AS letto_il, NOT COALESCE(${LETTO}, false) AS da_leggere
         FROM announcements a
         JOIN users au ON au.id = a.created_by AND au.organization_id = a.organization_id
         LEFT JOIN announcement_reads r ON r.announcement_id = a.id AND r.user_id = $2
        WHERE a.organization_id = $1 AND a.withdrawn_at IS NULL AND ${destinatario('$2')}
        ORDER BY (a.important AND NOT COALESCE(${LETTO}, false)) DESC, a.published_at DESC`,
      [req.utente.organizzazioneId, req.utente.id],
    );
    res.json({ avvisi: rows });
  });

  // Contatore per la barra delle sezioni.
  router.get('/avvisi/non-letti', async (req, res) => {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS non_letti, count(*) FILTER (WHERE a.important)::int AS importanti
         FROM announcements a
         LEFT JOIN announcement_reads r ON r.announcement_id = a.id AND r.user_id = $2
        WHERE a.organization_id = $1 AND a.withdrawn_at IS NULL AND ${destinatario('$2')}
          AND NOT COALESCE(${LETTO}, false)`,
      [req.utente.organizzazioneId, req.utente.id],
    );
    res.json(rows[0]);
  });

  // ------------------------------------------------- Amministratore: elenco

  const COLONNE_GESTIONE = `
    a.id, a.title AS titolo, a.body AS testo, a.important AS importante, a.for_everyone AS per_tutti,
    COALESCE((SELECT array_agg(x.sector_id ORDER BY s.sort_order, s.name) FROM announcement_sectors x
                JOIN sectors s ON s.id = x.sector_id AND s.organization_id = x.organization_id
               WHERE x.announcement_id = a.id), '{}') AS settori,
    a.published_at AS pubblicato_il, a.updated_at AS modificato_il, a.withdrawn_at AS ritirato_il,
    au.first_name || ' ' || au.last_name AS autore,
    (SELECT count(*) FROM users u WHERE u.organization_id = a.organization_id AND u.active AND ${destinatario('u.id')})::int AS destinatari,
    (SELECT count(*) FROM users u
       JOIN announcement_reads r ON r.announcement_id = a.id AND r.user_id = u.id
      WHERE u.organization_id = a.organization_id AND u.active AND ${destinatario('u.id')} AND ${LETTO})::int AS letti`;

  router.get('/avvisi/gestione', soloAdmin, async (req, res) => {
    const { rows } = await pool.query(
      `SELECT ${COLONNE_GESTIONE}
         FROM announcements a
         JOIN users au ON au.id = a.created_by AND au.organization_id = a.organization_id
        WHERE a.organization_id = $1
        ORDER BY a.withdrawn_at IS NOT NULL, a.published_at DESC`,
      [req.utente.organizzazioneId],
    );
    res.json({ avvisi: rows });
  });

  // ------------------------------------------------------ Singolo avviso

  // Avviso visibile all'utente: destinatario e non ritirato; l'amministratore
  // vede tutti quelli dell'organizzazione. Altrimenti 404.
  async function leggiAvviso(db, req, id) {
    if (!isUuid(id)) throw nonTrovato();
    const { rows } = await db.query(
      `SELECT a.id, a.title AS titolo, a.body AS testo, a.important AS importante, a.for_everyone AS per_tutti,
              COALESCE((SELECT array_agg(s.name ORDER BY s.sort_order, s.name) FROM announcement_sectors x
                          JOIN sectors s ON s.id = x.sector_id AND s.organization_id = x.organization_id
                         WHERE x.announcement_id = a.id), '{}') AS nomi_settori,
              a.published_at AS pubblicato_il, a.updated_at AS modificato_il, a.withdrawn_at AS ritirato_il,
              au.first_name || ' ' || au.last_name AS autore,
              ${destinatario('$3')} AS sono_destinatario,
              r.read_at AS letto_il, NOT COALESCE(${LETTO}, false) AS da_leggere
         FROM announcements a
         JOIN users au ON au.id = a.created_by AND au.organization_id = a.organization_id
         LEFT JOIN announcement_reads r ON r.announcement_id = a.id AND r.user_id = $3
        WHERE a.organization_id = $1 AND a.id = $2`,
      [req.utente.organizzazioneId, id, req.utente.id],
    );
    const a = rows[0];
    if (!a) throw nonTrovato();
    if (!eAdmin(req) && (!a.sono_destinatario || a.ritirato_il)) throw nonTrovato();
    return a;
  }

  // Dettaglio, con le versioni precedenti del testo se è stato modificato.
  router.get('/avvisi/:id', async (req, res) => {
    const a = await leggiAvviso(pool, req, req.params.id);
    const { rows } = await pool.query(
      `SELECT title AS titolo, body AS testo, important AS importante, audience AS destinatari,
              written_at AS scritto_il, replaced_at AS sostituito_il
         FROM announcement_revisions WHERE announcement_id = $1 AND organization_id = $2
        ORDER BY replaced_at DESC`,
      [a.id, req.utente.organizzazioneId],
    );
    res.json({ ...a, versioni_precedenti: rows });
  });

  // Aprire un avviso lo segna come letto (solo per i destinatari).
  router.post('/avvisi/:id/letto', async (req, res) => {
    const a = await leggiAvviso(pool, req, req.params.id);
    if (!a.sono_destinatario || a.ritirato_il) throw nonTrovato();
    await pool.query(
      `INSERT INTO announcement_reads (organization_id, announcement_id, user_id) VALUES ($1, $2, $3)
       ON CONFLICT (announcement_id, user_id) DO UPDATE SET read_at = now()`,
      [req.utente.organizzazioneId, a.id, req.utente.id],
    );
    res.json({ ok: true });
  });

  // Chi l'ha letto e chi no, tra i destinatari attuali.
  router.get('/avvisi/:id/letture', soloAdmin, async (req, res) => {
    const a = await leggiAvviso(pool, req, req.params.id);
    const { rows } = await pool.query(
      `SELECT u.id, u.first_name AS nome, u.last_name AS cognome, r.read_at AS letto_il,
              COALESCE(${LETTO}, false) AS letto
         FROM announcements a
         JOIN users u ON u.organization_id = a.organization_id AND u.active AND ${destinatario('u.id')}
         LEFT JOIN announcement_reads r ON r.announcement_id = a.id AND r.user_id = u.id
        WHERE a.organization_id = $1 AND a.id = $2
        ORDER BY u.last_name, u.first_name`,
      [req.utente.organizzazioneId, a.id],
    );
    res.json({
      letto: rows.filter((r) => r.letto).map(({ letto, ...r }) => r),
      // letto_il valorizzato = aveva letto una versione precedente alla modifica.
      non_letto: rows.filter((r) => !r.letto).map(({ letto, ...r }) => r),
    });
  });

  // ------------------------------------------- Amministratore: modifiche

  function leggiCorpo(valore) {
    const testo = typeof valore === 'string' ? valore.replace(/\r\n?/g, '\n').trim() : '';
    if (!testo) throw nonValido('Testo: campo obbligatorio');
    if (testo.length > MAX_TESTO) throw nonValido(`Testo: al massimo ${MAX_TESTO} caratteri`);
    return testo;
  }

  // Destinatari: { per_tutti: true } oppure { per_tutti: false, settori: [id] }.
  async function leggiDestinatari(db, orgId, perTutti, settori) {
    if (typeof perTutti !== 'boolean') throw nonValido('Indica se l\'avviso è per tutti o per alcuni settori');
    if (perTutti) return { ids: [], nomi: ['tutti'] };
    if (!Array.isArray(settori) || !settori.length || settori.length > 100 || !settori.every(isUuid)) {
      throw nonValido('Scegli almeno un settore');
    }
    const ids = [...new Set(settori)];
    const { rows } = await db.query(
      'SELECT name FROM sectors WHERE organization_id = $1 AND id = ANY($2::uuid[]) ORDER BY sort_order, name',
      [orgId, ids],
    );
    if (rows.length !== ids.length) throw nonValido('Settore non trovato');
    return { ids, nomi: rows.map((r) => r.name) };
  }

  async function impostaSettori(db, orgId, avvisoId, ids) {
    await db.query('DELETE FROM announcement_sectors WHERE announcement_id = $1 AND organization_id = $2', [avvisoId, orgId]);
    await db.query(
      'INSERT INTO announcement_sectors (organization_id, announcement_id, sector_id) SELECT $1, $2, unnest($3::uuid[])',
      [orgId, avvisoId, ids],
    );
  }

  // Corpo: { titolo, testo, importante?, per_tutti, settori? }
  // Pubblica subito e manda la notifica ai destinatari (tranne l'autore).
  router.post('/avvisi', soloAdmin, async (req, res) => {
    const b = req.body ?? {};
    const titolo = leggiTesto(b.titolo, 'Titolo', 150);
    const testo = leggiCorpo(b.testo);
    if (b.importante !== undefined && typeof b.importante !== 'boolean') throw nonValido('Valore di "importante" non valido');
    const importante = b.importante ?? false;
    const org = req.utente.organizzazioneId;
    const id = await transazione(pool, async (client) => {
      const dest = await leggiDestinatari(client, org, b.per_tutti, b.settori);
      const { rows } = await client.query(
        `INSERT INTO announcements (organization_id, title, body, important, for_everyone, created_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [org, titolo, testo, importante, b.per_tutti, req.utente.id],
      );
      const avviso = rows[0].id;
      await impostaSettori(client, org, avviso, dest.ids);
      // L'autore l'ha già letto.
      await client.query('INSERT INTO announcement_reads (organization_id, announcement_id, user_id) VALUES ($1, $2, $3)', [
        org,
        avviso,
        req.utente.id,
      ]);
      await traccia(client, {
        organizzazioneId: org,
        utente: req.utente,
        azione: 'avviso.pubblicato',
        tipo: 'avviso',
        id: avviso,
        dettagli: { titolo, importante, destinatari: dest.nomi },
      });
      const { rows: destinatari } = await client.query(
        `SELECT u.id FROM announcements a
           JOIN users u ON u.organization_id = a.organization_id AND u.active AND ${destinatario('u.id')}
          WHERE a.id = $1 AND a.organization_id = $2 AND u.id <> $3`,
        [avviso, org, req.utente.id],
      );
      const { rows: io } = await client.query('SELECT first_name, last_name FROM users WHERE id = $1', [req.utente.id]);
      // Nell'email solo il titolo: l'avviso si legge nell'app, così risulta letto.
      await notifica(client, config, {
        organizzazioneId: org,
        utenti: destinatari.map((d) => d.id),
        autore: req.utente.id,
        tipo: 'avviso',
        titolo: `${importante ? 'Avviso importante' : 'Nuovo avviso'}: ${titolo}`,
        testo: `in bacheca c'è un nuovo avviso${importante ? ' importante' : ''} per te: «${titolo}».\nAprilo nell'app per leggerlo.`,
        breve: 'Tocca per leggerlo in bacheca.',
        link: `#/bacheca/${avviso}`,
        chiave: `avviso:${avviso}`,
        nomeMittente: `${io[0].first_name} ${io[0].last_name} tramite ${NOME_APP}`,
      });
      return avviso;
    });
    res.status(201).json(await leggiAvviso(pool, req, id));
  });

  async function bloccaAvviso(client, org, id) {
    if (!isUuid(id)) throw nonTrovato();
    const { rows } = await client.query(
      `SELECT a.id, a.title, a.body, a.important, a.for_everyone, a.withdrawn_at,
              COALESCE(a.updated_at, a.published_at) AS scritto_il,
              COALESCE((SELECT array_agg(x.sector_id) FROM announcement_sectors x WHERE x.announcement_id = a.id), '{}') AS settori,
              COALESCE((SELECT array_agg(s.name ORDER BY s.sort_order, s.name) FROM announcement_sectors x
                          JOIN sectors s ON s.id = x.sector_id AND s.organization_id = x.organization_id
                         WHERE x.announcement_id = a.id), '{}') AS nomi_settori
         FROM announcements a WHERE a.id = $1 AND a.organization_id = $2 FOR UPDATE`,
      [id, org],
    );
    if (!rows[0]) throw nonTrovato();
    if (rows[0].withdrawn_at) throw new ErroreHttp(409, 'L\'avviso è stato ritirato e non si può più modificare.');
    return rows[0];
  }

  // Corpo: { titolo?, testo?, importante?, per_tutti?, settori? }.
  // Il testo precedente resta tra le versioni precedenti, visibili a tutti i
  // destinatari, e l'avviso torna "da leggere" per chi l'aveva già letto.
  router.patch('/avvisi/:id', soloAdmin, async (req, res) => {
    const b = req.body ?? {};
    const org = req.utente.organizzazioneId;
    if (b.importante !== undefined && typeof b.importante !== 'boolean') throw nonValido('Valore di "importante" non valido');
    await transazione(pool, async (client) => {
      const prima = await bloccaAvviso(client, org, req.params.id);
      const dopo = {
        titolo: b.titolo === undefined ? prima.title : leggiTesto(b.titolo, 'Titolo', 150),
        testo: b.testo === undefined ? prima.body : leggiCorpo(b.testo),
        importante: b.importante ?? prima.important,
      };
      const cambiaDestinatari = b.per_tutti !== undefined || b.settori !== undefined;
      const dest = cambiaDestinatari
        ? await leggiDestinatari(client, org, b.per_tutti ?? prima.for_everyone, b.settori ?? prima.settori)
        : { ids: prima.settori, nomi: prima.for_everyone ? ['tutti'] : prima.nomi_settori };
      const perTutti = cambiaDestinatari ? (b.per_tutti ?? prima.for_everyone) : prima.for_everyone;
      const destinatariPrima = prima.for_everyone ? ['tutti'] : prima.nomi_settori;
      const diff = differenze(
        { titolo: prima.title, testo: prima.body, importante: prima.important, destinatari: destinatariPrima },
        { ...dopo, destinatari: dest.nomi },
      );
      if (!Object.keys(diff).length) return;
      await client.query(
        `INSERT INTO announcement_revisions
           (organization_id, announcement_id, title, body, important, audience, written_at, replaced_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [org, prima.id, prima.title, prima.body, prima.important, destinatariPrima, prima.scritto_il, req.utente.id],
      );
      await client.query(
        `UPDATE announcements SET title = $3, body = $4, important = $5, for_everyone = $6, updated_at = now(), updated_by = $7
          WHERE id = $1 AND organization_id = $2`,
        [prima.id, org, dopo.titolo, dopo.testo, dopo.importante, perTutti, req.utente.id],
      );
      await impostaSettori(client, org, prima.id, dest.ids);
      // L'autore della modifica l'ha letta.
      await client.query(
        `INSERT INTO announcement_reads (organization_id, announcement_id, user_id) VALUES ($1, $2, $3)
         ON CONFLICT (announcement_id, user_id) DO UPDATE SET read_at = now()`,
        [org, prima.id, req.utente.id],
      );
      // Nel registro il testo non viene copiato per intero.
      if (diff.testo) diff.testo = { prima: '(testo precedente)', dopo: '(testo nuovo)' };
      await traccia(client, {
        organizzazioneId: org,
        utente: req.utente,
        azione: 'avviso.modificato',
        tipo: 'avviso',
        id: prima.id,
        dettagli: { avviso: dopo.titolo, ...diff },
      });
    });
    res.json(await leggiAvviso(pool, req, req.params.id));
  });

  // Ritira l'avviso: sparisce per i destinatari. Non si può annullare.
  router.post('/avvisi/:id/ritiro', soloAdmin, async (req, res) => {
    const org = req.utente.organizzazioneId;
    await transazione(pool, async (client) => {
      const a = await bloccaAvviso(client, org, req.params.id);
      await client.query('UPDATE announcements SET withdrawn_at = now(), withdrawn_by = $3 WHERE id = $1 AND organization_id = $2', [
        a.id,
        org,
        req.utente.id,
      ]);
      await traccia(client, {
        organizzazioneId: org,
        utente: req.utente,
        azione: 'avviso.ritirato',
        tipo: 'avviso',
        id: a.id,
        dettagli: { avviso: a.title },
      });
    });
    res.json(await leggiAvviso(pool, req, req.params.id));
  });

  return router;
}

module.exports = { rotteBacheca };
