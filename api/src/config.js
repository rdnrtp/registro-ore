// Configurazione letta dalle variabili d'ambiente. La connessione a PostgreSQL
// usa le variabili standard PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE,
// lette direttamente dal driver pg.

function richiesta(nome) {
  const valore = process.env[nome];
  if (!valore) throw new Error(`Variabile d'ambiente mancante: ${nome}`);
  return valore;
}

function intero(nome, predefinito) {
  const valore = process.env[nome];
  if (valore === undefined || valore === '') return predefinito;
  const n = Number(valore);
  if (!Number.isInteger(n)) throw new Error(`${nome} deve essere un numero intero`);
  return n;
}

function caricaConfig() {
  const jwtSecret = richiesta('JWT_SECRET');
  if (jwtSecret.length < 32) throw new Error('JWT_SECRET deve essere lungo almeno 32 caratteri');
  return {
    port: intero('PORT', 3000),
    jwtSecret,
    jwtDurataOre: intero('JWT_DURATA_ORE', 168),
    // Validità dei link di invito e di reimpostazione della password.
    invitoDurataOre: intero('INVITO_DURATA_ORE', 72),
    cookieSecure: process.env.COOKIE_SECURE === 'true',
    // Numero di proxy fidati davanti all'API (il nginx del frontend = 1).
    trustProxy: intero('TRUST_PROXY', 1),
    login: {
      finestraMinuti: intero('LOGIN_FINESTRA_MINUTI', 15),
      maxFallitiPerEmail: intero('LOGIN_MAX_FALLITI_PER_EMAIL', 5),
      maxFallitiPerIp: intero('LOGIN_MAX_FALLITI_PER_IP', 30),
    },
    // Indirizzo dell'app visto dagli utenti: serve per i link nelle email.
    // Non si ricava dalla richiesta, che potrebbe indicare un host qualsiasi.
    appUrl: (process.env.APP_URL || 'http://localhost:8088').replace(/\/+$/, ''),
    posta: {
      // Senza SMTP_HOST le email restano in coda e non partono.
      host: process.env.SMTP_HOST || null,
      porta: intero('SMTP_PORT', 587),
      // true = TLS dall'inizio (porta 465); false = STARTTLS se il server lo offre.
      sicura: process.env.SMTP_SECURE === 'true',
      utente: process.env.SMTP_USER || null,
      password: process.env.SMTP_PASSWORD || null,
      // Indirizzo del mittente; il nome cambia a seconda dell'email.
      mittente: process.env.POSTA_MITTENTE || 'registro-ore@localhost',
      intervalloSecondi: intero('POSTA_INTERVALLO_SECONDI', 5),
      maxTentativi: intero('POSTA_MAX_TENTATIVI', 8),
    },
    // Ogni quanti secondi si controlla se è ora di mandare i promemoria.
    promemoriaIntervalloSecondi: intero('PROMEMORIA_INTERVALLO_SECONDI', 60),
  };
}

module.exports = { caricaConfig };
