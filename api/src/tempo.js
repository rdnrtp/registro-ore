// Date e ore come si leggono in Italia (Europe/Rome), qualunque sia il fuso
// del server. Le scadenze (fine del mese, promemoria alle 9) sono italiane.

const FUSO = 'Europe/Rome';

const parti = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

// { anno, mese, giorno, ora, minuto, data: 'AAAA-MM-GG' } dell'istante indicato.
function inItalia(istante = new Date()) {
  const p = Object.fromEntries(parti.formatToParts(istante).map((x) => [x.type, x.value]));
  return {
    anno: Number(p.year),
    mese: Number(p.month),
    giorno: Number(p.day),
    ora: Number(p.hour),
    minuto: Number(p.minute),
    data: `${p.year}-${p.month}-${p.day}`,
  };
}

const formatoDataOra = new Intl.DateTimeFormat('it-IT', { timeZone: FUSO, dateStyle: 'long', timeStyle: 'short' });
const formatoData = new Intl.DateTimeFormat('it-IT', { timeZone: FUSO, dateStyle: 'long' });

// "31 ottobre 2026 alle ore 18:02" (secondo la versione di ICU il separatore
// può essere una virgola: si uniforma).
const dataOraIt = (istante) =>
  formatoDataOra.format(new Date(istante)).replace(/(?:,| alle ore)? (\d{1,2}:\d{2})$/, ' alle ore $1');
// "31 ottobre 2026"
const dataIt = (istante) => formatoData.format(new Date(istante));

// Istante in cui in Italia è l'ora indicata del giorno indicato (ora solare
// o legale secondo il giorno). Il mese e il giorno possono sforare
// (giorno 32 = primo del mese dopo), come in Date.UTC.
function istanteItaliano(anno, mese, giorno, ora) {
  // Ora solare: UTC+1; se non torna, ora legale: UTC+2.
  let t = Date.UTC(anno, mese - 1, giorno, ora) - 3600 * 1000;
  if (inItalia(new Date(t)).ora !== ora) t -= 3600 * 1000;
  return new Date(t);
}

// Fascia di silenzio delle notifiche push: dalle 22:00 alle 7:00 italiane.
const SILENZIO = { dalle: 22, alle: 7 };

const inSilenzio = (istante = new Date()) => {
  const { ora } = inItalia(istante);
  return ora >= SILENZIO.dalle || ora < SILENZIO.alle;
};

// Primo istante utile per una push: subito, oppure le 7:00 se si è nella
// fascia di silenzio (del giorno dopo, se sono già passate le 22).
function fuoriDalSilenzio(istante = new Date()) {
  if (!inSilenzio(istante)) return istante;
  const { anno, mese, giorno, ora } = inItalia(istante);
  return istanteItaliano(anno, mese, ora >= SILENZIO.dalle ? giorno + 1 : giorno, SILENZIO.alle);
}

module.exports = { FUSO, inItalia, dataOraIt, dataIt, istanteItaliano, SILENZIO, inSilenzio, fuoriDalSilenzio };
