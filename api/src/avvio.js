// Lavori in sottofondo dell'API: invio delle email in coda e promemoria.
// Ogni lavoro gira a intervalli e non si sovrappone a sé stesso.
const { elaboraCoda } = require('./posta/coda');
const { creaTrasporto } = require('./posta/trasporto');
const { eseguiPromemoria } = require('./promemoria');

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
  fermate.push(
    ripeti('Promemoria', config.promemoriaIntervalloSecondi, async () => {
      const esiti = await eseguiPromemoria(pool, config);
      for (const e of esiti.filter((x) => x.esito === 'inviati')) console.log(`Promemoria ${e.organizzazione} del ${e.data}: ${e.destinatari.length} destinatari`);
    }),
  );
  return () => fermate.forEach((f) => f());
}

module.exports = { avviaLavori };
