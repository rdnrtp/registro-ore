const { ErroreHttp } = require('./errori');

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

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Testo obbligatorio inviato dal client: spazi ripetuti ridotti, lunghezza
// massima. Lancia un 400 con il nome del campo.
function leggiTesto(valore, campo, massimo) {
  const testo = typeof valore === 'string' ? valore.trim().replace(/\s+/g, ' ') : '';
  if (!testo) throw new ErroreHttp(400, `${campo}: campo obbligatorio`);
  if (testo.length > massimo) throw new ErroreHttp(400, `${campo}: al massimo ${massimo} caratteri`);
  return testo;
}

// Email in minuscolo; 400 se non valida.
function leggiEmail(valore) {
  const email = typeof valore === 'string' ? normalizzaEmail(valore) : '';
  if (!EMAIL.test(email) || email.length > 254) throw new ErroreHttp(400, `Email non valida: ${String(valore ?? '')}`);
  return email;
}

// Numero in formato italiano: 7.5 -> "7,5".
function numeroIt(n) {
  return String(n).replace('.', ',');
}

module.exports = {
  NOMI_MESI, isUuid, normalizzaEmail, giorniNelMese, leggiAnnoMese, leggiData, numeroIt, leggiTesto, leggiEmail,
};
