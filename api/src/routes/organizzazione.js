const express = require('express');
const { autenticato, richiediRuolo } = require('../auth');
const { isUuid } = require('../validazione');

// Dati di configurazione dell'organizzazione dell'utente autenticato. Ogni
// query filtra per req.utente.organizzazioneId: un identificativo di un'altra
// organizzazione produce semplicemente "non trovato".
function rotteOrganizzazione({ pool, config }) {
  const router = express.Router();
  router.use(autenticato(config));

  const nonTrovato = (res) => res.status(404).json({ errore: 'Non trovato' });

  const SELECT_ATTIVITA = `
    SELECT a.id, a.name AS nome, a.unit AS unita, a.template_row AS riga_modello,
           a.sort_order AS ordine, a.active AS attiva,
           COALESCE(array_agg(s.id ORDER BY s.sort_order) FILTER (WHERE s.id IS NOT NULL), '{}') AS settori
      FROM activities a
      LEFT JOIN activity_sectors x ON x.activity_id = a.id AND x.organization_id = a.organization_id
      LEFT JOIN sectors s ON s.id = x.sector_id AND s.organization_id = a.organization_id
     WHERE a.organization_id = $1`;

  router.get('/attivita', async (req, res) => {
    const { rows } = await pool.query(
      `${SELECT_ATTIVITA} GROUP BY a.id ORDER BY a.sort_order, a.name`,
      [req.utente.organizzazioneId],
    );
    res.json(rows);
  });

  router.get('/attivita/:id', async (req, res) => {
    if (!isUuid(req.params.id)) return nonTrovato(res);
    const { rows } = await pool.query(`${SELECT_ATTIVITA} AND a.id = $2 GROUP BY a.id`, [
      req.utente.organizzazioneId,
      req.params.id,
    ]);
    if (!rows[0]) return nonTrovato(res);
    res.json(rows[0]);
  });

  // Le email dei responsabili sono visibili solo agli amministratori.
  const colonneSettore = (req) =>
    req.utente.ruolo === 'amministratore'
      ? 'id, name AS nome, sort_order AS ordine, manager_emails AS email_responsabili'
      : 'id, name AS nome, sort_order AS ordine';

  router.get('/settori', async (req, res) => {
    const { rows } = await pool.query(
      `SELECT ${colonneSettore(req)} FROM sectors WHERE organization_id = $1 ORDER BY sort_order, name`,
      [req.utente.organizzazioneId],
    );
    res.json(rows);
  });

  router.get('/settori/:id', async (req, res) => {
    if (!isUuid(req.params.id)) return nonTrovato(res);
    const { rows } = await pool.query(
      `SELECT ${colonneSettore(req)} FROM sectors WHERE organization_id = $1 AND id = $2`,
      [req.utente.organizzazioneId, req.params.id],
    );
    if (!rows[0]) return nonTrovato(res);
    res.json(rows[0]);
  });

  const SELECT_UTENTE = `
    SELECT id, email, first_name AS nome, last_name AS cognome, role AS ruolo, active AS attivo
      FROM users WHERE organization_id = $1`;

  router.get('/utenti', richiediRuolo('amministratore'), async (req, res) => {
    const { rows } = await pool.query(`${SELECT_UTENTE} ORDER BY last_name, first_name`, [
      req.utente.organizzazioneId,
    ]);
    res.json(rows);
  });

  router.get('/utenti/:id', richiediRuolo('amministratore'), async (req, res) => {
    if (!isUuid(req.params.id)) return nonTrovato(res);
    const { rows } = await pool.query(`${SELECT_UTENTE} AND id = $2`, [
      req.utente.organizzazioneId,
      req.params.id,
    ]);
    if (!rows[0]) return nonTrovato(res);
    res.json(rows[0]);
  });

  return router;
}

module.exports = { rotteOrganizzazione };
