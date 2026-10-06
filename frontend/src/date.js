// Date come giorni di calendario 'AAAA-MM-GG', senza ora e senza fusi: i
// calcoli usano Date.UTC solo per sapere quanti giorni ha un mese e che giorno
// della settimana è.

export const NOMI_MESI = [
  'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre',
];
// Indice 0 = lunedì (giorno ISO 1) … 6 = domenica (giorno ISO 7).
export const NOMI_GIORNI = ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica'];
export const GIORNI_BREVI = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];

const due = (n) => String(n).padStart(2, '0');
export const maiuscola = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Il giorno di oggi in Italia, qualunque sia il fuso impostato sul dispositivo.
export function oggiIso() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function isoData(anno, mese, giorno) {
  return `${anno}-${due(mese)}-${due(giorno)}`;
}

// Giorno della settimana ISO: 1 = lunedì … 7 = domenica.
export function giornoSettimana(data) {
  const [a, m, g] = data.split('-').map(Number);
  return ((new Date(Date.UTC(a, m - 1, g)).getUTCDay() + 6) % 7) + 1;
}

export function giorniDelMese(anno, mese) {
  const n = new Date(Date.UTC(anno, mese, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => {
    const data = isoData(anno, mese, i + 1);
    return { data, giorno: i + 1, settimana: giornoSettimana(data) };
  });
}

export function meseVicino(anno, mese, delta) {
  const indice = anno * 12 + (mese - 1) + delta;
  return { anno: Math.floor(indice / 12), mese: (indice % 12) + 1 };
}

// "lunedì 5 ottobre"
export function etichettaData(data, conAnno = false) {
  const [a, m, g] = data.split('-').map(Number);
  return `${NOMI_GIORNI[giornoSettimana(data) - 1]} ${g} ${NOMI_MESI[m - 1]}${conAnno ? ` ${a}` : ''}`;
}

// 7.5 -> "7,5"
export function numero(n) {
  return n.toLocaleString('it-IT', { maximumFractionDigits: 1 });
}
