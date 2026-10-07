const express = require('express');
const { richiediRuolo } = require('../auth');
const { transazione } = require('../db');
const { ErroreHttp } = require('../errori');
const { traccia, differenze } = require('../traccia');
const { isUuid, leggiTesto, leggiEmail, numeroIt } = require('../validazione');

const UNITA = ['ore', 'sedute'];
const MAX_ORE_GIORNO = 24;

// Configurazione dell'organizzazione modificata dall'amministratore: attività,
// settori, indirizzo di invio, traccia delle modifiche. Le letture per tutti
// (elenco attività e settori) sono in organizzazione.js.
// Ogni modifica è registrata in audit_log nella stessa transazione.
function rotteConfigurazione({ pool }) {
  const router = express.Router();
  const soloAdmin = richiediRuolo('amministratore');

  const nonTrovato = () => new ErroreHttp(404, 'Non trovato');
  const nonValido = (messaggio) => new ErroreHttp(400, messaggio);

  function elencoIds(valore, cosa) {
    if (!Array.isArray(valore) || valore.length > 200 || !valore.every(isUuid)) throw nonValido(`${cosa} non validi`);
    return [...new Set(valore)];
  }

  // Id di righe dell'organizzazione: { ids, nomi } oppure 400 se uno manca.
  async function verificaIds(db, sql, orgId, ids, messaggio) {
    const { rows } = await db.query(sql, [orgId, ids]);
    if (rows.length !== ids.length) throw nonValido(messaggio);
    return { ids, nomi: rows.map((r) => r.nome) };
  }

  const settoriPerId = (db, orgId, ids) =>
    verificaIds(
      db,
      'SELECT name AS nome FROM sectors WHERE organization_id = $1 AND id = ANY($2::uuid[]) ORDER BY sort_order, name',
      orgId,
      ids,
      'Settore non trovato',
    );

  // ------------------------------------------------------------ Attività

  const SELECT_ATTIVITA = `
    SELECT a.id, a.name AS nome, a.template_label AS nome_modello, a.unit AS unita, a.sort_order AS ordine,
           a.active AS attiva,
           COALESCE(array_agg(x.sector_id) FILTER (WHERE x.sector_id IS NOT NULL), '{}') AS settori
      FROM activities a
      LEFT JOIN activity_sectors x ON x.activity_id = a.id AND x.organization_id = a.organization_id
     WHERE a.organization_id = $1 AND a.id = $2
     GROUP BY a.id`;

  // Il cambio di unità non deve rendere non valide le quantità già registrate.
  async function verificaCambioUnita(client, orgId, id, nome, unita) {
    if (unita === 'sedute') {
      const { rows } = await client.query(
        `SELECT (SELECT count(*) FROM time_entries WHERE activity_id = $1 AND organization_id = $2 AND quantity <> trunc(quantity))
              + (SELECT count(*) FROM schedule_templates WHERE activity_id = $1 AND organization_id = $2 AND quantity <> trunc(quantity))
                AS n`,
        [id, orgId],
      );
      if (Number(rows[0].n) > 0) {
        throw new ErroreHttp(
          409,
          `"${nome}" non può passare a sedute: ci sono registrazioni o orari tipo con mezze ore. Vanno prima corrette.`,
        );
      }
      return;
    }
    // Da sedute a ore: le sedute diventano ore e non devono superare le 24 ore in un giorno.
    const { rows } = await client.query(
      `SELECT max(ore) AS massimo FROM (
         SELECT sum(t.quantity) AS ore FROM time_entries t
           JOIN activities a ON a.id = t.activity_id AND a.organization_id = t.organization_id
          WHERE t.organization_id = $1 AND (a.unit = 'ore' OR a.id = $2)
            AND (t.user_id, t.entry_date) IN (SELECT user_id, entry_date FROM time_entries WHERE activity_id = $2)
          GROUP BY t.user_id, t.entry_date
         UNION ALL
         SELECT sum(s.quantity) FROM schedule_templates s
           JOIN activities a ON a.id = s.activity_id AND a.organization_id = s.organization_id
          WHERE s.organization_id = $1 AND (a.unit = 'ore' OR a.id = $2)
            AND (s.user_id, s.weekday) IN (SELECT user_id, weekday FROM schedule_templates WHERE activity_id = $2)
          GROUP BY s.user_id, s.weekday) totali`,
      [orgId, id],
    );
    if (rows[0].massimo > MAX_ORE_GIORNO) {
      throw new ErroreHttp(
        409,
        `"${nome}" non può passare a ore: in alcuni giorni il totale supererebbe le ${MAX_ORE_GIORNO} ore ` +
          `(fino a ${numeroIt(rows[0].massimo)}).`,
      );
    }
  }

  // Corpo: { nome?, unita?, attiva?, settori? }. Il nome è quello mostrato
  // nell'app: nel file Excel resta quello scritto nel modello (nome_modello).
  router.patch('/attivita/:id', soloAdmin, async (req, res) => {
    if (!isUuid(req.params.id)) throw nonTrovato();
    const b = req.body ?? {};
    const org = req.utente.organizzazioneId;
    const id = req.params.id;
    if (b.attiva !== undefined && typeof b.attiva !== 'boolean') throw nonValido('Valore di "attiva" non valido');
    if (b.unita !== undefined && !UNITA.includes(b.unita)) throw nonValido('Unità non valida: ore o sedute');

    await transazione(pool, async (client) => {
      // Blocca la riga dell'attività: due modifiche contemporanee vanno in fila.
      await client.query('SELECT 1 FROM activities WHERE id = $1 AND organization_id = $2 FOR UPDATE', [id, org]);
      const prima = (await client.query(SELECT_ATTIVITA, [org, id])).rows[0];
      if (!prima) throw nonTrovato();
      const dopo = {
        nome: b.nome === undefined ? prima.nome : leggiTesto(b.nome, 'Nome', 100),
        unita: b.unita ?? prima.unita,
        attiva: b.attiva ?? prima.attiva,
      };
      const settori = b.settori === undefined ? prima.settori : (await settoriPerId(client, org, elencoIds(b.settori, 'Settori'))).ids;

      if (dopo.nome !== prima.nome) {
        const doppio = await client.query('SELECT 1 FROM activities WHERE organization_id = $1 AND name = $2 AND id <> $3', [
          org,
          dopo.nome,
          id,
        ]);
        if (doppio.rows[0]) throw new ErroreHttp(409, `Esiste già un'attività chiamata "${dopo.nome}"`);
      }
      if (dopo.unita !== prima.unita) {
        // Blocca gli utenti dell'organizzazione come fanno le modifiche alle
        // ore: nessuno registra quantità durante il controllo e il cambio.
        await client.query('SELECT 1 FROM users WHERE organization_id = $1 ORDER BY id FOR NO KEY UPDATE', [org]);
        await verificaCambioUnita(client, org, id, prima.nome, dopo.unita);
      }

      await client.query('UPDATE activities SET name = $3, unit = $4, active = $5 WHERE id = $1 AND organization_id = $2', [
        id,
        org,
        dopo.nome,
        dopo.unita,
        dopo.attiva,
      ]);
      await client.query('DELETE FROM activity_sectors WHERE activity_id = $1 AND organization_id = $2', [id, org]);
      await client.query(
        'INSERT INTO activity_sectors (organization_id, activity_id, sector_id) SELECT $1, $2, unnest($3::uuid[])',
        [org, id, settori],
      );

      const diff = differenze(
        { ...prima, settori: (await settoriPerId(client, org, prima.settori)).nomi },
        { ...dopo, settori: (await settoriPerId(client, org, settori)).nomi },
      );
      if (Object.keys(diff).length) {
        await traccia(client, {
          organizzazioneId: org,
          utente: req.utente,
          azione: 'attivita.modificata',
          tipo: 'attivita',
          id,
          dettagli: { attivita: prima.nome, ...diff },
        });
      }
    });
    const { rows } = await pool.query(SELECT_ATTIVITA, [org, id]);
    res.json(rows[0]);
  });

  // Ordine delle attività nell'app (non nel file Excel, che segue il modello).
  // Corpo: { attivita: [id, ...] } con tutte le attività dell'organizzazione.
  router.put('/ordine-attivita', soloAdmin, async (req, res) => {
    const ids = elencoIds(req.body?.attivita, 'Attività');
    const org = req.utente.organizzazioneId;
    await transazione(pool, async (client) => {
      const { rows } = await client.query(
        'SELECT id, name FROM activities WHERE organization_id = $1 ORDER BY sort_order, name FOR UPDATE',
        [org],
      );
      const esistenti = new Set(rows.map((r) => r.id));
      if (ids.length !== rows.length || !ids.every((i) => esistenti.has(i))) {
        throw nonValido("L'elenco deve contenere tutte le attività, una volta sola");
      }
      const prima = rows.map((r) => r.name);
      await client.query(
        `UPDATE activities a SET sort_order = o.posizione
           FROM unnest($2::uuid[]) WITH ORDINALITY AS o(id, posizione)
          WHERE a.id = o.id AND a.organization_id = $1`,
        [org, ids],
      );
      const nomi = new Map(rows.map((r) => [r.id, r.name]));
      const dopo = ids.map((i) => nomi.get(i));
      if (JSON.stringify(prima) !== JSON.stringify(dopo)) {
        await traccia(client, { organizzazioneId: org, utente: req.utente, azione: 'attivita.ordine_cambiato', dettagli: { ordine: dopo } });
      }
    });
    res.json({ ok: true });
  });

  // ------------------------------------------------------------- Settori

  function leggiEmailResponsabili(valore) {
    if (!Array.isArray(valore) || valore.length > 20) throw nonValido('Email dei responsabili non valide');
    return [...new Set(valore.map(leggiEmail))];
  }

  // Utenti da indicare come responsabili: dell'organizzazione e con ruolo "responsabile".
  const responsabiliPerId = (db, orgId, ids) =>
    verificaIds(
      db,
      `SELECT first_name || ' ' || last_name AS nome FROM users
        WHERE organization_id = $1 AND id = ANY($2::uuid[]) AND role = 'responsabile'
        ORDER BY last_name, first_name`,
      orgId,
      ids,
      'Si possono indicare solo utenti con ruolo "responsabile" di questo impianto',
    );

  const SELECT_SETTORE = `
    SELECT s.id, s.name AS nome, s.sort_order AS ordine, s.manager_emails AS email_responsabili,
           COALESCE((SELECT array_agg(m.user_id) FROM sector_managers m
                      WHERE m.sector_id = s.id AND m.organization_id = s.organization_id), '{}') AS responsabili
      FROM sectors s WHERE s.organization_id = $1 AND s.id = $2`;

  async function nomeSettoreLibero(db, orgId, nome, tranneId = null) {
    const { rows } = await db.query('SELECT 1 FROM sectors WHERE organization_id = $1 AND name = $2 AND id IS DISTINCT FROM $3', [
      orgId,
      nome,
      tranneId,
    ]);
    if (rows[0]) throw new ErroreHttp(409, `Esiste già un settore chiamato "${nome}"`);
  }

  async function impostaResponsabili(db, orgId, settoreId, ids) {
    await db.query('DELETE FROM sector_managers WHERE sector_id = $1 AND organization_id = $2', [settoreId, orgId]);
    await db.query('INSERT INTO sector_managers (organization_id, sector_id, user_id) SELECT $1, $2, unnest($3::uuid[])', [
      orgId,
      settoreId,
      ids,
    ]);
  }

  // Corpo: { nome, email_responsabili: [email], responsabili: [id utente] }
  router.post('/settori', soloAdmin, async (req, res) => {
    const b = req.body ?? {};
    const org = req.utente.organizzazioneId;
    const nome = leggiTesto(b.nome, 'Nome', 100);
    const email = leggiEmailResponsabili(b.email_responsabili ?? []);
    const id = await transazione(pool, async (client) => {
      await client.query('SELECT 1 FROM organizations WHERE id = $1 FOR UPDATE', [org]);
      await nomeSettoreLibero(client, org, nome);
      const responsabili = await responsabiliPerId(client, org, elencoIds(b.responsabili ?? [], 'Responsabili'));
      const { rows } = await client.query(
        `INSERT INTO sectors (organization_id, name, manager_emails, sort_order)
         VALUES ($1, $2, $3, (SELECT COALESCE(max(sort_order), 0) + 1 FROM sectors WHERE organization_id = $1))
         RETURNING id`,
        [org, nome, email],
      );
      await impostaResponsabili(client, org, rows[0].id, responsabili.ids);
      await traccia(client, {
        organizzazioneId: org,
        utente: req.utente,
        azione: 'settore.creato',
        tipo: 'settore',
        id: rows[0].id,
        dettagli: { nome, email_responsabili: email, responsabili: responsabili.nomi },
      });
      return rows[0].id;
    });
    res.status(201).json((await pool.query(SELECT_SETTORE, [org, id])).rows[0]);
  });

  // Corpo: { nome?, email_responsabili?, responsabili? }
  router.patch('/settori/:id', soloAdmin, async (req, res) => {
    if (!isUuid(req.params.id)) throw nonTrovato();
    const b = req.body ?? {};
    const org = req.utente.organizzazioneId;
    const id = req.params.id;
    await transazione(pool, async (client) => {
      await client.query('SELECT 1 FROM organizations WHERE id = $1 FOR UPDATE', [org]);
      const prima = (await client.query(SELECT_SETTORE, [org, id])).rows[0];
      if (!prima) throw nonTrovato();
      const dopo = {
        nome: b.nome === undefined ? prima.nome : leggiTesto(b.nome, 'Nome', 100),
        email_responsabili: b.email_responsabili === undefined ? prima.email_responsabili : leggiEmailResponsabili(b.email_responsabili),
      };
      if (dopo.nome !== prima.nome) await nomeSettoreLibero(client, org, dopo.nome, id);
      const responsabili =
        b.responsabili === undefined ? prima.responsabili : (await responsabiliPerId(client, org, elencoIds(b.responsabili, 'Responsabili'))).ids;
      await client.query('UPDATE sectors SET name = $3, manager_emails = $4 WHERE id = $1 AND organization_id = $2', [
        id,
        org,
        dopo.nome,
        dopo.email_responsabili,
      ]);
      // Tra i responsabili precedenti può esserci chi non ha più quel ruolo:
      // la verifica vale solo per quelli indicati ora.
      if (b.responsabili !== undefined) await impostaResponsabili(client, org, id, responsabili);
      const nomiResponsabili = async (ids) =>
        (
          await client.query(
            `SELECT first_name || ' ' || last_name AS nome FROM users
              WHERE organization_id = $1 AND id = ANY($2::uuid[]) ORDER BY last_name, first_name`,
            [org, ids],
          )
        ).rows.map((r) => r.nome);
      const diff = differenze(
        { ...prima, responsabili: await nomiResponsabili(prima.responsabili) },
        { ...dopo, responsabili: await nomiResponsabili(responsabili) },
      );
      if (Object.keys(diff).length) {
        await traccia(client, {
          organizzazioneId: org,
          utente: req.utente,
          azione: 'settore.modificato',
          tipo: 'settore',
          id,
          dettagli: { settore: prima.nome, ...diff },
        });
      }
    });
    res.json((await pool.query(SELECT_SETTORE, [org, id])).rows[0]);
  });

  // Elimina il settore con i suoi abbinamenti ad attività e responsabili.
  // Le ore registrate non cambiano.
  router.delete('/settori/:id', soloAdmin, async (req, res) => {
    if (!isUuid(req.params.id)) throw nonTrovato();
    const org = req.utente.organizzazioneId;
    await transazione(pool, async (client) => {
      const { rows } = await client.query('DELETE FROM sectors WHERE organization_id = $1 AND id = $2 RETURNING name', [
        org,
        req.params.id,
      ]);
      if (!rows[0]) throw nonTrovato();
      await traccia(client, {
        organizzazioneId: org,
        utente: req.utente,
        azione: 'settore.eliminato',
        tipo: 'settore',
        id: req.params.id,
        dettagli: { settore: rows[0].name },
      });
    });
    res.json({ ok: true });
  });

  // ------------------------------------------------------ Organizzazione

  const SELECT_ORGANIZZAZIONE = `
    SELECT name AS nome, slug, submission_email AS email_invio, pt_sessions_per_kind AS max_sedute_pt_per_tipo
      FROM organizations WHERE id = $1`;

  router.get('/organizzazione', soloAdmin, async (req, res) => {
    res.json((await pool.query(SELECT_ORGANIZZAZIONE, [req.utente.organizzazioneId])).rows[0]);
  });

  // Corpo: { email_invio } = indirizzo a cui si inviano i file mensili.
  router.patch('/organizzazione', soloAdmin, async (req, res) => {
    const org = req.utente.organizzazioneId;
    const email = leggiEmail(req.body?.email_invio);
    await transazione(pool, async (client) => {
      const { rows } = await client.query('SELECT submission_email FROM organizations WHERE id = $1 FOR UPDATE', [org]);
      if (rows[0].submission_email === email) return;
      await client.query('UPDATE organizations SET submission_email = $2 WHERE id = $1', [org, email]);
      await traccia(client, {
        organizzazioneId: org,
        utente: req.utente,
        azione: 'organizzazione.modificata',
        dettagli: { email_invio: { prima: rows[0].submission_email, dopo: email } },
      });
    });
    res.json((await pool.query(SELECT_ORGANIZZAZIONE, [org])).rows[0]);
  });

  // ------------------------------------------------ Traccia delle modifiche

  // Le 100 voci più recenti; ?salta=100 per le 100 precedenti, e così via.
  // (Le voci di una stessa modifica hanno lo stesso istante: uno scostamento
  // numerico non ne salta nessuna, un filtro per data sì.)
  router.get('/registro-modifiche', soloAdmin, async (req, res) => {
    const salta = req.query.salta === undefined ? 0 : Number(req.query.salta);
    if (!Number.isInteger(salta) || salta < 0 || salta > 1_000_000) throw nonValido('Valore di "salta" non valido');
    const { rows } = await pool.query(
      `SELECT l.id, l.created_at AS quando, l.action AS azione, l.target_type AS tipo, l.target_id AS oggetto_id,
              l.details AS dettagli, u.first_name AS nome, u.last_name AS cognome
         FROM audit_log l
         LEFT JOIN users u ON u.id = l.actor_id AND u.organization_id = l.organization_id
        WHERE l.organization_id = $1
        ORDER BY l.created_at DESC, l.id DESC
        LIMIT 100 OFFSET $2`,
      [req.utente.organizzazioneId, salta],
    );
    res.json({
      voci: rows.map(({ nome, cognome, ...r }) => ({ ...r, autore: nome ? `${nome} ${cognome}` : null })),
    });
  });

  return router;
}

module.exports = { rotteConfigurazione };
