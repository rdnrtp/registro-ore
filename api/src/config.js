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
    cookieSecure: process.env.COOKIE_SECURE === 'true',
    // Numero di proxy fidati davanti all'API (il nginx del frontend = 1).
    trustProxy: intero('TRUST_PROXY', 1),
    login: {
      finestraMinuti: intero('LOGIN_FINESTRA_MINUTI', 15),
      maxFallitiPerEmail: intero('LOGIN_MAX_FALLITI_PER_EMAIL', 5),
      maxFallitiPerIp: intero('LOGIN_MAX_FALLITI_PER_IP', 30),
    },
  };
}

module.exports = { caricaConfig };
