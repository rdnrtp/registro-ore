const express = require('express');
const { richiediRuolo } = require('../auth');
const { transazione } = require('../db');
const { ErroreHttp } = require('../errori');
const { isUuid } = require('../validazione');
const { traccia } = require('../traccia');
const { riprovaEmail, statoPubblico } = require('../posta/coda');

// Email in uscita dell'organizzazione e il loro stato, solo amministratore.
function rottePosta({ pool }) {
  const router = express.Router();
  router.use('/email', richiediRuolo('amministratore'));

  // Le 100 più recenti; ?salta=100 per le precedenti; ?stato=errore per filtrare.
  router.get('/email', async (req, res) => {
    const salta = req.query.salta === undefined ? 0 : Number(req.query.salta);
    if (!Number.isInteger(salta) || salta < 0 || salta > 1_000_000) throw new ErroreHttp(400, 'Valore di "salta" non valido');
    const stato = req.query.stato;
    if (stato !== undefined && !['in_attesa', 'inviata', 'errore'].includes(stato)) throw new ErroreHttp(400, 'Stato non valido');
    const stati = stato === 'in_attesa' ? ['in_attesa', 'in_invio'] : stato ? [stato] : null;
    const { rows } = await pool.query(
      `SELECT id, kind AS tipo, to_addresses AS a, cc_addresses AS cc, subject AS oggetto, status AS stato,
              attempts AS tentativi, last_error AS errore, created_at AS creata_il, sent_at AS inviata_il,
              CASE WHEN status = 'in_attesa' THEN next_attempt_at END AS prossimo_tentativo,
              (status = 'errore' AND NOT sensitive) AS si_puo_riprovare
         FROM email_outbox
        WHERE organization_id = $1 AND ($3::text[] IS NULL OR status = ANY($3))
        ORDER BY created_at DESC, id DESC
        LIMIT 100 OFFSET $2`,
      [req.utente.organizzazioneId, salta, stati],
    );
    res.json({ email: rows.map((r) => ({ ...r, stato: statoPubblico(r.stato) })) });
  });

  // Rimette in coda un'email in errore. Un'email con un link di invito non si
  // ritenta (il testo è stato cancellato): si crea un nuovo link.
  router.post('/email/:id/riprova', async (req, res) => {
    if (!isUuid(req.params.id)) throw new ErroreHttp(404, 'Non trovato');
    const org = req.utente.organizzazioneId;
    await transazione(pool, async (client) => {
      const { rows } = await client.query(
        'SELECT subject, status, sensitive FROM email_outbox WHERE id = $1 AND organization_id = $2 FOR UPDATE',
        [req.params.id, org],
      );
      if (!rows[0]) throw new ErroreHttp(404, 'Non trovato');
      if (rows[0].status !== 'errore') throw new ErroreHttp(409, "Si può riprovare solo un'email in errore.");
      if (rows[0].sensitive) throw new ErroreHttp(409, "Email con un link di invito: crea un nuovo link dalla pagina Utenti.");
      await riprovaEmail(client, org, req.params.id);
      await traccia(client, {
        organizzazioneId: org,
        utente: req.utente,
        azione: 'email.riprovata',
        tipo: 'email',
        id: req.params.id,
        dettagli: { oggetto: rows[0].subject },
      });
    });
    res.json({ ok: true });
  });

  return router;
}

module.exports = { rottePosta };
