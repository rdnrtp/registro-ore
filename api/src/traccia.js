// Traccia delle azioni amministrative (audit_log): chi ha fatto cosa e quando.
// Va scritta nella stessa transazione della modifica, così non esiste una
// modifica senza traccia né una traccia di una modifica annullata.
// utente = req.utente, oppure null per i comandi da terminale.
async function traccia(db, { organizzazioneId, utente, azione, tipo = null, id = null, dettagli = {} }) {
  await db.query(
    `INSERT INTO audit_log (organization_id, actor_id, action, target_type, target_id, details)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [organizzazioneId, utente?.id ?? null, azione, tipo, id, JSON.stringify(dettagli)],
  );
}

// Solo i campi cambiati: { campo: { prima, dopo } }.
function differenze(prima, dopo) {
  const diff = {};
  for (const k of Object.keys(dopo)) {
    if (JSON.stringify(prima[k]) !== JSON.stringify(dopo[k])) diff[k] = { prima: prima[k], dopo: dopo[k] };
  }
  return diff;
}

module.exports = { traccia, differenze };
