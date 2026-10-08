const express = require('express');
const { richiediRuolo } = require('../auth');
const { transazione } = require('../db');
const { ErroreHttp } = require('../errori');
const { isUuid, leggiAnnoMese, NOMI_MESI } = require('../validazione');
const { traccia } = require('../traccia');
const { notifica, NOME_APP } = require('../notifiche');
const { elencoInvii } = require('../invio-mese');
const { fileExcelMese, fileInviato, inviaFile } = require('./esportazione');

// Un sollecito alla stessa persona per lo stesso mese non prima di:
const PAUSA_SOLLECITI_MINUTI = 10;

// Viste in sola lettura sui mesi degli altri utenti.
// - Amministratore: tutti gli utenti dell'organizzazione, tutte le righe,
//   sedute PT comprese, il file Excel di chiunque, le versioni inviate; in più
//   riapre un mese inviato e sollecita chi non ha ancora inviato.
// - Responsabile: solo chi nel mese ha registrazioni su attività dei suoi
//   settori, e di ciascuno solo quelle righe. Niente sedute PT con il nome
//   del cliente (non sono legate a un settore) e niente file Excel.
// Nessuna rotta qui modifica le registrazioni: le cambia solo il titolare.
function rotteCollaboratori({ pool, config }) {
  const router = express.Router();
  router.use('/collaboratori', richiediRuolo('responsabile', 'amministratore'));
  const soloAdmin = richiediRuolo('amministratore');

  const nonTrovato = () => new ErroreHttp(404, 'Non trovato');

  function periodo(params) {
    const am = leggiAnnoMese(params.anno, params.mese);
    if (!am) throw new ErroreHttp(400, 'Mese non valido');
    return { ...am, inizio: `${am.anno}-${String(am.mese).padStart(2, '0')}-01` };
  }

  // Attività che l'utente può vedere nei mesi degli altri: tutte per
  // l'amministratore, quelle dei suoi settori per il responsabile.
  // Parametri: $1 organizzazione, $2 utente che guarda, $3 è amministratore.
  const ATTIVITA_VISIBILI = `
    SELECT a.id FROM activities a
     WHERE a.organization_id = $1
       AND ($3::boolean OR EXISTS (
             SELECT 1 FROM activity_sectors x
               JOIN sector_managers m ON m.sector_id = x.sector_id AND m.organization_id = x.organization_id
              WHERE x.activity_id = a.id AND x.organization_id = a.organization_id AND m.user_id = $2))`;

  const parametri = (req) => [req.utente.organizzazioneId, req.utente.id, req.utente.ruolo === 'amministratore'];
  const chiaveSolleciti = (anno, mese) => `sollecito:${anno}-${String(mese).padStart(2, '0')}:`;

  // Elenco dei collaboratori visibili nel mese, con totali e stato dell'invio.
  // Per l'amministratore è il quadro degli invii: tutti gli utenti attivi che
  // devono inviare (non esonerati), più chi ha dati o invii nel mese.
  // manca = deve inviare e non ha ancora inviato.
  router.get('/collaboratori/:anno/:mese', async (req, res) => {
    const { anno, mese, inizio } = periodo(req.params);
    const { rows } = await pool.query(
      `WITH visibili AS (${ATTIVITA_VISIBILI}),
       totali AS (
         SELECT t.user_id,
                COALESCE(sum(t.quantity) FILTER (WHERE a.unit = 'ore'), 0) AS ore,
                COALESCE(sum(t.quantity) FILTER (WHERE a.unit = 'sedute'), 0) AS sedute
           FROM time_entries t
           JOIN activities a ON a.id = t.activity_id AND a.organization_id = t.organization_id
          WHERE t.organization_id = $1 AND t.activity_id IN (SELECT id FROM visibili)
            AND t.entry_date >= $4::date AND t.entry_date < $4::date + interval '1 month'
          GROUP BY t.user_id),
       invii AS (
         SELECT user_id, max(version) AS versione FROM month_submission_versions
          WHERE organization_id = $1 AND year = $5 AND month = $6 GROUP BY user_id),
       solleciti AS (
         SELECT user_id, max(created_at) AS ultimo FROM notifications
          WHERE organization_id = $1 AND kind = 'sollecito' AND dedup_key LIKE $7 || '%' GROUP BY user_id)
       SELECT u.id, u.first_name AS nome, u.last_name AS cognome, u.active AS attivo,
              u.submission_exempt AS esonerato,
              COALESCE(t.ore, 0) AS ore, COALESCE(t.sedute, 0) AS sedute,
              COALESCE(s.status, 'aperto') AS stato,
              s.submitted_at AS inviato_il,
              i.versione,
              (i.versione IS NOT NULL AND COALESCE(s.status, 'aperto') = 'aperto') AS riaperto,
              (u.active AND NOT u.submission_exempt AND COALESCE(s.status, 'aperto') <> 'inviato') AS manca,
              CASE WHEN $3 THEN u.password_hash IS NOT NULL END AS password_impostata,
              CASE WHEN $3 THEN so.ultimo END AS ultimo_sollecito
         FROM users u
         LEFT JOIN totali t ON t.user_id = u.id
         LEFT JOIN invii i ON i.user_id = u.id
         LEFT JOIN solleciti so ON so.user_id = u.id
         LEFT JOIN month_submissions s
           ON s.user_id = u.id AND s.organization_id = u.organization_id AND s.year = $5 AND s.month = $6
        WHERE u.organization_id = $1
          AND (t.user_id IS NOT NULL
               OR ($3::boolean AND ((u.active AND NOT u.submission_exempt) OR i.user_id IS NOT NULL OR EXISTS (
                     SELECT 1 FROM pt_sessions p WHERE p.user_id = u.id AND p.organization_id = u.organization_id
                        AND p.session_date >= $4::date AND p.session_date < $4::date + interval '1 month'))))
        ORDER BY u.last_name, u.first_name`,
      [...parametri(req), inizio, anno, mese, chiaveSolleciti(anno, mese)],
    );
    // Per il responsabile "manca" non ha senso: vede solo chi ha registrato
    // qualcosa nei suoi settori.
    const admin = req.utente.ruolo === 'amministratore';
    res.json({
      anno,
      mese,
      collaboratori: rows.map((r) => (admin ? r : { ...r, manca: undefined, password_impostata: undefined, ultimo_sollecito: undefined })),
    });
  });

  // Mese di un collaboratore, in sola lettura, nello stesso formato di
  // GET /api/mese/:anno/:mese più i dati dell'utente.
  router.get('/collaboratori/:id/mese/:anno/:mese', async (req, res) => {
    if (!isUuid(req.params.id)) throw nonTrovato();
    const { anno, mese, inizio } = periodo(req.params);
    const admin = req.utente.ruolo === 'amministratore';
    const [p1, p2, p3] = parametri(req);
    const utente = await pool.query(
      `SELECT id, first_name AS nome, last_name AS cognome, active AS attivo, submission_exempt AS esonerato
         FROM users WHERE id = $1 AND organization_id = $2`,
      [req.params.id, p1],
    );
    if (!utente.rows[0]) throw nonTrovato();
    const [registrazioni, sedute, stato, org, invii] = await Promise.all([
      pool.query(
        `SELECT entry_date AS data, activity_id AS attivita_id, quantity AS quantita
           FROM time_entries
          WHERE organization_id = $1 AND user_id = $4 AND activity_id IN (${ATTIVITA_VISIBILI})
            AND entry_date >= $5::date AND entry_date < $5::date + interval '1 month'
          ORDER BY entry_date`,
        [p1, p2, p3, req.params.id, inizio],
      ),
      admin
        ? pool.query(
            `SELECT id, session_date AS data, kind AS tipo, client_name AS cliente
               FROM pt_sessions
              WHERE organization_id = $1 AND user_id = $2
                AND session_date >= $3::date AND session_date < $3::date + interval '1 month'
              ORDER BY session_date, created_at`,
            [p1, req.params.id, inizio],
          )
        : null,
      pool.query(
        `SELECT status, submitted_at FROM month_submissions
          WHERE organization_id = $1 AND user_id = $2 AND year = $3 AND month = $4`,
        [p1, req.params.id, anno, mese],
      ),
      pool.query('SELECT pt_sessions_per_kind FROM organizations WHERE id = $1', [p1]),
      admin ? elencoInvii(pool, { orgId: p1, utenteId: req.params.id, anno, mese }) : null,
    ]);
    // Il responsabile vede solo chi ha registrazioni nei suoi settori in quel
    // mese: per gli altri la risposta è la stessa di un utente inesistente.
    if (!admin && registrazioni.rows.length === 0) throw nonTrovato();
    res.json({
      utente: utente.rows[0],
      anno,
      mese,
      stato: stato.rows[0]?.status ?? 'aperto',
      inviato_il: stato.rows[0]?.submitted_at ?? null,
      max_sedute_pt_per_tipo: org.rows[0].pt_sessions_per_kind,
      registrazioni: registrazioni.rows,
      // null = non visibili (responsabile), diverso da [] = nessuna seduta.
      sedute_pt: sedute ? sedute.rows : null,
      // Versioni inviate con destinatari e stato dell'email: solo amministratore.
      invii,
      solo_settori_propri: !admin,
    });
  });

  router.get('/collaboratori/:id/mese/:anno/:mese/excel', soloAdmin, async (req, res) => {
    if (!isUuid(req.params.id)) throw nonTrovato();
    const { anno, mese } = periodo(req.params);
    inviaFile(res, await fileExcelMese(pool, { orgId: req.utente.organizzazioneId, utenteId: req.params.id, anno, mese }));
  });

  router.get('/collaboratori/:id/mese/:anno/:mese/invii/:versione/file', soloAdmin, async (req, res) => {
    if (!isUuid(req.params.id)) throw nonTrovato();
    const { anno, mese } = periodo(req.params);
    inviaFile(
      res,
      await fileInviato(pool, { orgId: req.utente.organizzazioneId, utenteId: req.params.id, anno, mese, versione: req.params.versione }),
    );
  });

  // Blocca la riga dell'utente come fanno le sue modifiche e il suo invio:
  // riapertura e sollecito non si incrociano con un invio in corso.
  async function bloccaCollaboratore(client, orgId, id) {
    if (!isUuid(id)) throw nonTrovato();
    const { rows } = await client.query(
      `SELECT id, email, first_name AS nome, last_name AS cognome, active AS attivo,
              submission_exempt AS esonerato, password_hash IS NOT NULL AS password_impostata
         FROM users WHERE id = $1 AND organization_id = $2 FOR NO KEY UPDATE`,
      [id, orgId],
    );
    if (!rows[0]) throw nonTrovato();
    return rows[0];
  }

  async function statoMese(client, orgId, id, anno, mese) {
    const { rows } = await client.query(
      `SELECT status FROM month_submissions WHERE organization_id = $1 AND user_id = $2 AND year = $3 AND month = $4`,
      [orgId, id, anno, mese],
    );
    return rows[0]?.status ?? 'aperto';
  }

  // Riapre un mese inviato perché il collaboratore lo corregga e lo reinvii.
  // Corpo: { motivazione }. Il file inviato resta tra le versioni.
  router.post('/collaboratori/:id/mese/:anno/:mese/riapertura', soloAdmin, async (req, res) => {
    const { anno, mese } = periodo(req.params);
    const motivazione = typeof req.body?.motivazione === 'string' ? req.body.motivazione.trim() : '';
    const org = req.utente.organizzazioneId;
    await transazione(pool, async (client) => {
      const u = await bloccaCollaboratore(client, org, req.params.id);
      if (!motivazione) throw new ErroreHttp(400, 'Indica la motivazione della riapertura');
      if (motivazione.length > 1000) throw new ErroreHttp(400, 'Motivazione troppo lunga (al massimo 1000 caratteri)');
      if ((await statoMese(client, org, u.id, anno, mese)) !== 'inviato') {
        throw new ErroreHttp(409, 'Il mese non è inviato: non c\'è niente da riaprire.');
      }
      const { rows } = await client.query(
        `UPDATE month_submission_versions SET reopened_at = now(), reopened_by = $5, reopen_reason = $6
          WHERE id = (SELECT id FROM month_submission_versions
                       WHERE organization_id = $1 AND user_id = $2 AND year = $3 AND month = $4
                       ORDER BY version DESC LIMIT 1)
          RETURNING version`,
        [org, u.id, anno, mese, req.utente.id, motivazione],
      );
      await client.query(
        `UPDATE month_submissions SET status = 'aperto', submitted_at = NULL
          WHERE organization_id = $1 AND user_id = $2 AND year = $3 AND month = $4`,
        [org, u.id, anno, mese],
      );
      await traccia(client, {
        organizzazioneId: org,
        utente: req.utente,
        azione: 'mese.riaperto',
        tipo: 'utente',
        id: u.id,
        dettagli: { nome: u.nome, cognome: u.cognome, email: u.email, anno, mese, versione: rows[0]?.version ?? null, motivazione },
      });
      const admin = await client.query('SELECT first_name, last_name FROM users WHERE id = $1', [req.utente.id]);
      const quale = `${NOMI_MESI[mese - 1]} ${anno}`;
      await notifica(client, config, {
        organizzazioneId: org,
        utenti: [u.id],
        tipo: 'riapertura',
        titolo: `Il tuo mese di ${quale} è stato riaperto`,
        testo:
          `${admin.rows[0].first_name} ${admin.rows[0].last_name} ha riaperto il mese di ${quale} per una correzione.\n` +
          `Motivazione: ${motivazione}\n\n` +
          'Correggi le registrazioni e invia di nuovo il mese dall\'app: la nuova email sostituirà quella precedente.',
        link: `#/`,
      });
    });
    res.json({ stato: 'aperto', invii: await elencoInvii(pool, { orgId: org, utenteId: req.params.id, anno, mese }) });
  });

  // Sollecita una persona che non ha ancora inviato il mese: le arriva una
  // notifica (email) a nome dell'amministratore, a cui può rispondere.
  router.post('/collaboratori/:id/mese/:anno/:mese/sollecito', soloAdmin, async (req, res) => {
    const { anno, mese } = periodo(req.params);
    const org = req.utente.organizzazioneId;
    const quando = await transazione(pool, async (client) => {
      const u = await bloccaCollaboratore(client, org, req.params.id);
      if (!u.attivo) throw new ErroreHttp(409, `${u.nome} ${u.cognome} è disattivato.`);
      if (u.esonerato) throw new ErroreHttp(409, `${u.nome} ${u.cognome} è esonerato dall'invio del mese.`);
      if (!u.password_impostata) {
        throw new ErroreHttp(409, `${u.nome} non ha ancora scelto la password: mandagli prima un nuovo link di invito (Gestione → Utenti).`);
      }
      if ((await statoMese(client, org, u.id, anno, mese)) === 'inviato') throw new ErroreHttp(409, `${u.nome} ha già inviato il mese.`);
      const chiave = chiaveSolleciti(anno, mese);
      const recente = await client.query(
        `SELECT 1 FROM notifications
          WHERE organization_id = $1 AND user_id = $2 AND kind = 'sollecito' AND dedup_key LIKE $3 || '%'
            AND created_at > now() - make_interval(mins => $4)`,
        [org, u.id, chiave, PAUSA_SOLLECITI_MINUTI],
      );
      if (recente.rows[0]) throw new ErroreHttp(409, `${u.nome} è già stato sollecitato pochi minuti fa.`);

      const { rows: io } = await client.query('SELECT first_name, last_name, email FROM users WHERE id = $1', [req.utente.id]);
      const mittente = `${io[0].first_name} ${io[0].last_name}`;
      const quale = `${NOMI_MESI[mese - 1]} ${anno}`;
      await notifica(client, config, {
        organizzazioneId: org,
        utenti: [u.id],
        tipo: 'sollecito',
        titolo: `Promemoria: invia le ore di ${quale}`,
        testo:
          `${mittente} ti ricorda che non hai ancora inviato il file delle ore di ${quale}. ` +
          'Controlla le registrazioni e invialo dall\'app con il pulsante "Invia il mese".',
        link: `#/`,
        chiave: `${chiave}${Date.now()}`,
        nomeMittente: `${mittente} tramite ${NOME_APP}`,
        rispondiA: io[0].email,
      });
      await traccia(client, {
        organizzazioneId: org,
        utente: req.utente,
        azione: 'mese.sollecitato',
        tipo: 'utente',
        id: u.id,
        dettagli: { nome: u.nome, cognome: u.cognome, email: u.email, anno, mese },
      });
      const { rows } = await client.query('SELECT now() AS adesso');
      return rows[0].adesso;
    });
    res.json({ ultimo_sollecito: quando });
  });

  return router;
}

module.exports = { rotteCollaboratori };
