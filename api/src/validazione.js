const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NOMI_MESI = [
  'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre',
];

// Anni ammessi (gli stessi del vincolo su month_submissions).
const ANNO_MIN = 2000;
const ANNO_MAX = 2100;

function isUuid(valore) {
  return typeof valore === 'string' && UUID.test(valore);
}

function normalizzaEmail(email) {
  return String(email).trim().toLowerCase();
}

function giorniNelMese(anno, mese) {
  return new Date(Date.UTC(anno, mese, 0)).getUTCDate();
}

// Anno e mese da stringhe ('2026', '10'); null se non validi.
function leggiAnnoMese(anno, mese) {
  if (!/^\d{4}$/.test(anno ?? '') || !/^\d{1,2}$/.test(mese ?? '')) return null;
  const a = Number(anno);
  const m = Number(mese);
  if (a < ANNO_MIN || a > ANNO_MAX || m < 1 || m > 12) return null;
  return { anno: a, mese: m };
}

// Data di calendario 'AAAA-MM-GG', senza ora né fuso; null se non valida.
function leggiData(valore) {
  const p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof valore === 'string' ? valore : '');
  if (!p) return null;
  const am = leggiAnnoMese(p[1], p[2]);
  const giorno = Number(p[3]);
  if (!am || giorno < 1 || giorno > giorniNelMese(am.anno, am.mese)) return null;
  return { ...am, giorno, testo: valore };
}

// Numero in formato italiano: 7.5 -> "7,5".
function numeroIt(n) {
  return String(n).replace('.', ',');
}

module.exports = { NOMI_MESI, isUuid, normalizzaEmail, giorniNelMese, leggiAnnoMese, leggiData, numeroIt };
