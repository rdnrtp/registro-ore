const crypto = require('node:crypto');

// Codice del link di invito: 32 byte casuali. Nel database va solo l'hash,
// quindi il link si vede una volta sola, quando viene creato.
const hashCodice = (codice) => crypto.createHash('sha256').update(String(codice)).digest('hex');
const CODICE = /^[A-Za-z0-9_-]{43}$/;

// Crea un nuovo link per l'utente e annulla quelli precedenti non ancora usati.
// Restituisce { codice, scadenza }.
async function creaInvito(db, { organizzazioneId, utenteId, creatoDa, durataOre }) {
  await db.query('DELETE FROM user_invites WHERE user_id = $1 AND organization_id = $2 AND used_at IS NULL', [
    utenteId,
    organizzazioneId,
  ]);
  const codice = crypto.randomBytes(32).toString('base64url');
  const { rows } = await db.query(
    `INSERT INTO user_invites (organization_id, user_id, token_hash, created_by, expires_at)
     VALUES ($1, $2, $3, $4, now() + make_interval(hours => $5))
     RETURNING expires_at`,
    [organizzazioneId, utenteId, hashCodice(codice), creatoDa, durataOre],
  );
  return { codice, scadenza: rows[0].expires_at };
}

module.exports = { creaInvito, hashCodice, CODICE };
