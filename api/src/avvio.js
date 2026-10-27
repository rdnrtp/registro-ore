// Lavori in sottofondo dell'API: invio delle email e delle push in coda,
// promemoria, pulizia delle ricevute caricate e mai salvate. Ogni lavoro gira a intervalli e non si sovrappone a sé stesso.
const { elaboraCoda } = require('./posta/coda');
const { creaTrasporto } = require('./posta/trasporto');
const { elaboraCodaPush } = require('./push/coda');
const { creaInvioPush } = require('./push/invio');
const { eseguiPromemoria } = require('./promemoria');
const { pulisciBozzeSpese } = require('./routes/spese');

// Ultimo giro concluso di ogni lavoro (anche con errore): lo legge /api/stato
// per accorgersi di un lavoro fermo. Vuoto finché i lavori non partono (test).
const ultimiGiri = new Map();

function ripeti(nome, secondi, fn) {
  let inCorso = false;
  const giro = async () => {
    if (inCorso) return;
    inCorso = true;
    try {
      await fn();
    } catch (err) {
      console.error(`${nome}: ${err.message}`);
    } finally {
      ultimiGiri.set(nome, Date.now());
      inCorso = false;
    }
  };
  const timer = setInterval(giro, secondi * 1000);
  setImmediate(giro);
  return () => clearInterval(timer);
}

// Restituisce una funzione che ferma tutti i lavori.
function avviaLavori(pool, config) {
  const fermate = [];
  const trasporto = creaTrasporto(config.posta);
  if (trasporto) {
    fermate.push(
      ripeti('Coda email', config.posta.intervalloSecondi, () =>
        elaboraCoda(pool, { trasporto, config, log: (m) => console.warn(m) }),
      ),
    );
  } else {
    console.warn('SMTP_HOST non impostato: le email restano in coda e non vengono inviate.');
  }
  const invia = creaInvioPush(config.push);
  if (invia) {
    fermate.push(
      ripeti('Coda push', config.push.intervalloSecondi, () =>
        elaboraCodaPush(pool, { invia, config, log: (m) => console.warn(m) }),
      ),
    );
  } else {
    console.warn('Chiavi VAPID non impostate: notifiche push spente, tutte le notifiche vanno per email.');
  }
  fermate.push(
    ripeti('Promemoria', config.promemoriaIntervalloSecondi, async () => {
      const esiti = await eseguiPromemoria(pool, config);
      for (const e of esiti.filter((x) => x.esito === 'inviati')) console.log(`Promemoria ${e.organizzazione} del ${e.data}: ${e.destinatari.length} destinatari`);
    }),
  );
  fermate.push(
    // Ogni minuto come gli altri: /api/stato considera fermo un lavoro senza giri da 5 minuti.
    ripeti('Pulizia ricevute', 60, async () => {
      const n = await pulisciBozzeSpese(pool);
      if (n) console.log(`Ricevute caricate e mai salvate cancellate: ${n}`);
    }),
  );
  return () => fermate.forEach((f) => f());
}

module.exports = { avviaLavori, ultimiGiri };
