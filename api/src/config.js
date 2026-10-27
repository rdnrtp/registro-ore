// Configurazione letta dalle variabili d'ambiente. La connessione a PostgreSQL
// usa le variabili standard PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE,
// lette direttamente dal driver pg.
//
// Con AMBIENTE=produzione (compose.prod.yml) l'API si rifiuta di partire se
// manca una variabile necessaria o se contiene ancora un valore di esempio:
// vedi controllaProduzione().

function richiesta(env, nome) {
  const valore = env[nome];
  if (!valore) throw new Error(`Variabile d'ambiente mancante: ${nome}`);
  return valore;
}

function intero(env, nome, predefinito) {
  const valore = env[nome];
  if (valore === undefined || valore === '') return predefinito;
  const n = Number(valore);
  if (!Number.isInteger(n)) throw new Error(`${nome} deve essere un numero intero`);
  return n;
}

// Testi dei file di esempio (.env.example, .env.production.example) che
// segnalano un valore da sostituire.
const SEGNAPOSTO = /SOSTITUISCI|cambia-questa|esempio\.it|example\.(com|org|net|it)/i;
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

// Chiavi VAPID delle notifiche push (base64url): la pubblica è un punto
// P-256 non compresso (65 byte, inizia con 0x04), la privata 32 byte.
const base64url = (v) => (/^[A-Za-z0-9_-]+$/.test(v) ? Buffer.from(v, 'base64url') : Buffer.alloc(0));
const chiavePubblicaValida = (v) => {
  const b = base64url(v);
  return b.length === 65 && b[0] === 4;
};
const chiavePrivataValida = (v) => base64url(v).length === 32;

// Variabili necessarie in produzione, con un controllo in più (facoltativo).
// Restituisce l'elenco dei problemi: mai i valori, che possono essere segreti.
function controllaProduzione(env) {
  const problemi = [];
  const regole = {
    PGHOST: null,
    PGUSER: null,
    PGDATABASE: null,
    PGPASSWORD: (v) => v.length >= 20 || 'deve essere lunga almeno 20 caratteri',
    JWT_SECRET: (v) => v.length >= 32 || 'deve essere lunga almeno 32 caratteri',
    APP_URL: (v) => /^https:\/\/[^/\s]+\/?$/.test(v) || 'deve essere https://<dominio>, senza percorso',
    SMTP_HOST: (v) => !/^(mailpit|localhost|127\.)/.test(v) || 'non può essere la casella finta dello sviluppo',
    SMTP_PORT: (v) => /^\d+$/.test(v) || 'deve essere un numero',
    SMTP_USER: null,
    SMTP_PASSWORD: null,
    POSTA_MITTENTE: (v) => (EMAIL.test(v) && !v.endsWith('@localhost')) || 'deve essere un indirizzo email del dominio di invio',
    ALLARMI_EMAIL: (v) => EMAIL.test(v) || 'deve essere un indirizzo email',
    VAPID_PUBLIC_KEY: (v) => chiavePubblicaValida(v) || 'non è una chiave pubblica VAPID (vedi RUNBOOK.md, notifiche push)',
    VAPID_PRIVATE_KEY: (v) => chiavePrivataValida(v) || 'non è una chiave privata VAPID (vedi RUNBOOK.md, notifiche push)',
  };
  for (const [nome, controllo] of Object.entries(regole)) {
    const valore = env[nome]?.trim();
    if (!valore) {
      problemi.push(`${nome} manca`);
    } else if (SEGNAPOSTO.test(valore)) {
      problemi.push(`${nome} contiene ancora il valore di esempio`);
    } else if (controllo) {
      const esito = controllo(valore);
      if (esito !== true) problemi.push(`${nome} ${esito}`);
    }
  }
  return problemi;
}

// Notifiche push: senza le due chiavi VAPID sono spente (sviluppo) e tutte
// le notifiche vanno per email. In produzione sono obbligatorie.
function configPush(env) {
  const pubblica = env.VAPID_PUBLIC_KEY?.trim();
  const privata = env.VAPID_PRIVATE_KEY?.trim();
  if (!pubblica && !privata) return null;
  if (!chiavePubblicaValida(pubblica ?? '') || !chiavePrivataValida(privata ?? '')) {
    throw new Error('VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY: chiavi mancanti o non valide');
  }
  return {
    chiavePubblica: pubblica,
    chiavePrivata: privata,
    // Contatto per i servizi push (Google, Apple, …) in caso di problemi.
    soggetto: env.ALLARMI_EMAIL ? `mailto:${env.ALLARMI_EMAIL}` : (env.APP_URL || 'http://localhost:8088').replace(/\/+$/, ''),
    intervalloSecondi: intero(env, 'PUSH_INTERVALLO_SECONDI', 5),
    maxTentativi: intero(env, 'PUSH_MAX_TENTATIVI', 6),
  };
}

function caricaConfig(env = process.env) {
  const produzione = env.AMBIENTE === 'produzione';
  if (produzione) {
    const problemi = controllaProduzione(env);
    if (problemi.length) {
      throw new Error(
        `Configurazione di produzione non valida (file .env.production):\n- ${problemi.join('\n- ')}`,
      );
    }
  }
  const jwtSecret = richiesta(env, 'JWT_SECRET');
  if (jwtSecret.length < 32) throw new Error('JWT_SECRET deve essere lungo almeno 32 caratteri');
  return {
    produzione,
    port: intero(env, 'PORT', 3000),
    jwtSecret,
    jwtDurataOre: intero(env, 'JWT_DURATA_ORE', 168),
    // Validità dei link di invito e di reimpostazione della password.
    invitoDurataOre: intero(env, 'INVITO_DURATA_ORE', 72),
    // In produzione l'app è sempre in HTTPS: il cookie è sempre "Secure".
    cookieSecure: produzione || env.COOKIE_SECURE === 'true',
    // Numero di proxy fidati davanti all'API (il nginx del frontend = 1;
    // in produzione Caddy + nginx = 2).
    trustProxy: intero(env, 'TRUST_PROXY', 1),
    login: {
      finestraMinuti: intero(env, 'LOGIN_FINESTRA_MINUTI', 15),
      maxFallitiPerEmail: intero(env, 'LOGIN_MAX_FALLITI_PER_EMAIL', 5),
      maxFallitiPerIp: intero(env, 'LOGIN_MAX_FALLITI_PER_IP', 30),
    },
    // "Password dimenticata?": validità del link e richieste ammesse (tutte,
    // non solo quelle fallite) per email e per IP nella finestra.
    reimpostazione: {
      durataMinuti: intero(env, 'RESET_DURATA_MINUTI', 60),
      finestraMinuti: intero(env, 'RESET_FINESTRA_MINUTI', 60),
      maxPerEmail: intero(env, 'RESET_MAX_PER_EMAIL', 3),
      maxPerIp: intero(env, 'RESET_MAX_PER_IP', 10),
    },
    // Indirizzo dell'app visto dagli utenti: serve per i link nelle email.
    // Non si ricava dalla richiesta, che potrebbe indicare un host qualsiasi.
    appUrl: (env.APP_URL || 'http://localhost:8088').replace(/\/+$/, ''),
    posta: {
      // Senza SMTP_HOST le email restano in coda e non partono.
      host: env.SMTP_HOST || null,
      porta: intero(env, 'SMTP_PORT', 587),
      // true = TLS dall'inizio (porta 465); false = STARTTLS se il server lo offre.
      sicura: env.SMTP_SECURE === 'true',
      // In produzione la connessione deve essere cifrata: senza TLS (465) si
      // esige STARTTLS, così password e testi non viaggiano mai in chiaro.
      richiediTls: produzione,
      utente: env.SMTP_USER || null,
      password: env.SMTP_PASSWORD || null,
      // Indirizzo del mittente; il nome cambia a seconda dell'email.
      mittente: env.POSTA_MITTENTE || 'registro-ore@localhost',
      intervalloSecondi: intero(env, 'POSTA_INTERVALLO_SECONDI', 5),
      maxTentativi: intero(env, 'POSTA_MAX_TENTATIVI', 8),
    },
    // Rimborsi spese: dimensione massima del PDF allegato all'email alla
    // segreteria, in MB. Brevo indica 20 MB per email in tutto e allegati
    // "sotto i 4 MB": 4 è il valore prudente (vedi RUNBOOK.md).
    spese: { maxPdfMb: intero(env, 'SPESE_MAX_PDF_MB', 4) },
    // Chi riceve gli avvisi tecnici (backup fallito): comando avviso-sistema.
    allarmiEmail: env.ALLARMI_EMAIL || null,
    push: configPush(env),
    // Ogni quanti secondi si controlla se è ora di mandare i promemoria.
    promemoriaIntervalloSecondi: intero(env, 'PROMEMORIA_INTERVALLO_SECONDI', 60),
  };
}

module.exports = { caricaConfig, controllaProduzione };
