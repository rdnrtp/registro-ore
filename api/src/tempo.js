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

module.exports = { FUSO, inItalia, dataOraIt, dataIt };
