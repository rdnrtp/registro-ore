const nodemailer = require('nodemailer');

// Collegamento al server SMTP configurato (SMTP_HOST, …). In sviluppo è la
// casella finta Mailpit del Compose: nessuna email esce davvero.
// null se SMTP_HOST manca: le email restano in coda.
function creaTrasporto(posta) {
  if (!posta.host) return null;
  return nodemailer.createTransport({
    host: posta.host,
    port: posta.porta,
    secure: posta.sicura,
    auth: posta.utente ? { user: posta.utente, pass: posta.password ?? '' } : undefined,
    // Tempi brevi: un invio non deve restare appeso oltre il tempo massimo
    // previsto dalla coda (10 minuti).
    connectionTimeout: 30_000,
    greetingTimeout: 30_000,
    socketTimeout: 60_000,
  });
}

module.exports = { creaTrasporto };
