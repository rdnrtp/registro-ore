const crypto = require('node:crypto');
const { accodaEmail } = require('./posta/coda');
const { emailInvito } = require('./posta/messaggi');
const { NOME_APP } = require('./notifiche');

// Codice del link di invito: 32 byte casuali. Nel database va solo l'hash,
// quindi il link si vede una volta sola, quando viene creato.
const hashCodice = (codice) => crypto.createHash('sha256').update(String(codice)).digest('hex');
const CODICE = /^[A-Za-z0-9_-]{43}$/;

// Crea un nuovo link per l'utente e annulla quelli precedenti non ancora usati.
// Durata in ore oppure in minuti; origine = 'amministratore' | 'richiesta' |
// 'terminale' (vedi migrazione 011). Restituisce { codice, scadenza }.
async function creaInvito(db, { organizzazioneId, utenteId, creatoDa, durataOre, durataMinuti, origine = 'amministratore' }) {
  await db.query('DELETE FROM user_invites WHERE user_id = $1 AND organization_id = $2 AND used_at IS NULL', [
    utenteId,
    organizzazioneId,
  ]);
  const codice = crypto.randomBytes(32).toString('base64url');
  const { rows } = await db.query(
    `INSERT INTO user_invites (organization_id, user_id, token_hash, created_by, expires_at, origin)
     VALUES ($1, $2, $3, $4, now() + make_interval(mins => $5), $6)
     RETURNING expires_at`,
    [organizzazioneId, utenteId, hashCodice(codice), creatoDa, durataMinuti ?? durataOre * 60, origine],
  );
  return { codice, scadenza: rows[0].expires_at };
}

// Manda il link per email all'interessato (nella stessa transazione in cui
// il link è stato creato). Il link resta visibile anche all'amministratore.
// Il testo dell'email, che contiene il link, viene cancellato dopo l'invio.
async function accodaEmailInvito(db, config, { organizzazioneId, utente, invito, reimposta }) {
  const { rows } = await db.query('SELECT name FROM organizations WHERE id = $1', [organizzazioneId]);
  const organizzazione = rows[0].name;
  const { oggetto, testo } = emailInvito({
    nome: utente.nome,
    organizzazione,
    url: `${config.appUrl}/#/invito/${invito.codice}`,
    privacy: `${config.appUrl}/#/privacy`,
    scadenza: invito.scadenza,
    reimposta,
  });
  return accodaEmail(db, {
    organizzazioneId,
    tipo: 'invito',
    utenteId: utente.id,
    nomeMittente: `${organizzazione} · ${NOME_APP}`,
    a: [utente.email],
    oggetto,
    testo,
    riservata: true,
  });
}

module.exports = { creaInvito, accodaEmailInvito, hashCodice, CODICE };
