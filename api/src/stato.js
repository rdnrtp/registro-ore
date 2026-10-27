// Stato dell'app per un servizio esterno di monitoraggio (GET /api/stato).
// Pubblico: risponde solo "ok" o il nome del controllo fallito, mai dati.
//
// - database: risponde a una query;
// - posta: nessuna email in attesa da più di 30 minuti (normalmente partono
//   in pochi secondi: oltre, il server di posta rifiuta o non risponde);
// - push: nessuna notifica push che doveva partire da più di 30 minuti
//   (quelle rinviate alle 7 per la fascia di silenzio non contano);
// - lavori: ogni lavoro in sottofondo (code email e push, promemoria, pulizia
//   delle ricevute) ha concluso un giro negli ultimi 5 minuti.
const POSTA_RITARDO_MINUTI = 30;
const LAVORI_FERMI_MINUTI = 5;

async function statoApp(pool, ultimiGiri, adesso = Date.now()) {
  const stato = { database: 'ok', posta: 'ok', push: 'ok', lavori: 'ok' };
  try {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS ferme FROM email_outbox
        WHERE status = 'in_attesa' AND created_at < now() - make_interval(mins => $1)`,
      [POSTA_RITARDO_MINUTI],
    );
    if (rows[0].ferme > 0) stato.posta = 'in ritardo';
    const push = await pool.query(
      `SELECT count(*)::int AS ferme FROM push_outbox
        WHERE status = 'in_attesa' AND next_attempt_at < now() - make_interval(mins => $1)`,
      [POSTA_RITARDO_MINUTI],
    );
    if (push.rows[0].ferme > 0) stato.push = 'in ritardo';
  } catch {
    stato.database = 'errore';
    stato.posta = 'sconosciuto';
    stato.push = 'sconosciuto';
  }
  for (const ultimo of ultimiGiri.values()) {
    if (adesso - ultimo > LAVORI_FERMI_MINUTI * 60 * 1000) stato.lavori = 'fermi';
  }
  const ok = Object.values(stato).every((v) => v === 'ok');
  return { ok, ...stato };
}

module.exports = { statoApp };
