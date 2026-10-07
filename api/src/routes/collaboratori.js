const express = require('express');
const { richiediRuolo } = require('../auth');
const { ErroreHttp } = require('../errori');
const { isUuid, leggiAnnoMese } = require('../validazione');
const { fileExcelMese, inviaFile } = require('./esportazione');

// Viste in sola lettura sui mesi degli altri utenti.
// - Amministratore: tutti gli utenti dell'organizzazione, tutte le righe,
//   sedute PT comprese, e il file Excel di chiunque.
// - Responsabile: solo chi nel mese ha registrazioni su attività dei suoi
//   settori, e di ciascuno solo quelle righe. Niente sedute PT con il nome
//   del cliente (non sono legate a un settore) e niente file Excel.
// Nessuna rotta qui modifica dati: le registrazioni le cambia solo il titolare.
function rotteCollaboratori({ pool }) {
  const router = express.Router();
  router.use('/collaboratori', richiediRuolo('responsabile', 'amministratore'));

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

  // Elenco dei collaboratori visibili nel mese, con totali e stato.
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
          GROUP BY t.user_id)
       SELECT u.id, u.first_name AS nome, u.last_name AS cognome, u.active AS attivo,
              COALESCE(t.ore, 0) AS ore, COALESCE(t.sedute, 0) AS sedute,
              COALESCE(s.status, 'aperto') AS stato
         FROM users u
         LEFT JOIN totali t ON t.user_id = u.id
         LEFT JOIN month_submissions s
           ON s.user_id = u.id AND s.organization_id = u.organization_id AND s.year = $5 AND s.month = $6
        WHERE u.organization_id = $1
          AND (t.user_id IS NOT NULL
               OR ($3::boolean AND (u.active OR EXISTS (
                     SELECT 1 FROM pt_sessions p WHERE p.user_id = u.id AND p.organization_id = u.organization_id
                        AND p.session_date >= $4::date AND p.session_date < $4::date + interval '1 month'))))
        ORDER BY u.last_name, u.first_name`,
      [...parametri(req), inizio, anno, mese],
    );
    res.json({ anno, mese, collaboratori: rows });
  });

  // Mese di un collaboratore, in sola lettura, nello stesso formato di
  // GET /api/mese/:anno/:mese più i dati dell'utente.
  router.get('/collaboratori/:id/mese/:anno/:mese', async (req, res) => {
    if (!isUuid(req.params.id)) throw nonTrovato();
    const { anno, mese, inizio } = periodo(req.params);
    const admin = req.utente.ruolo === 'amministratore';
    const [p1, p2, p3] = parametri(req);
    const utente = await pool.query(
      'SELECT id, first_name AS nome, last_name AS cognome, active AS attivo FROM users WHERE id = $1 AND organization_id = $2',
      [req.params.id, p1],
    );
    if (!utente.rows[0]) throw nonTrovato();
    const [registrazioni, sedute, stato, org] = await Promise.all([
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
      pool.query('SELECT status FROM month_submissions WHERE organization_id = $1 AND user_id = $2 AND year = $3 AND month = $4', [
        p1,
        req.params.id,
        anno,
        mese,
      ]),
      pool.query('SELECT pt_sessions_per_kind FROM organizations WHERE id = $1', [p1]),
    ]);
    // Il responsabile vede solo chi ha registrazioni nei suoi settori in quel
    // mese: per gli altri la risposta è la stessa di un utente inesistente.
    if (!admin && registrazioni.rows.length === 0) throw nonTrovato();
    res.json({
      utente: utente.rows[0],
      anno,
      mese,
      stato: stato.rows[0]?.status ?? 'aperto',
      max_sedute_pt_per_tipo: org.rows[0].pt_sessions_per_kind,
      registrazioni: registrazioni.rows,
      // null = non visibili (responsabile), diverso da [] = nessuna seduta.
      sedute_pt: sedute ? sedute.rows : null,
      solo_settori_propri: !admin,
    });
  });

  router.get('/collaboratori/:id/mese/:anno/:mese/excel', richiediRuolo('amministratore'), async (req, res) => {
    if (!isUuid(req.params.id)) throw nonTrovato();
    const { anno, mese } = periodo(req.params);
    inviaFile(res, await fileExcelMese(pool, { orgId: req.utente.organizzazioneId, utenteId: req.params.id, anno, mese }));
  });

  return router;
}

module.exports = { rotteCollaboratori };
