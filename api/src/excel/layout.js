// Mappa delle celle del modello Excel di un'organizzazione ("layout").
// Sta in organizzazione.json (chiave "modello", senza "file") e nel database
// insieme al file del modello (excel_templates.layout). Esempio, per BV:
//
// {
//   "foglio": "Foglio1",
//   "celle": { "mese": "B2", "nome": "B4", "cognome": "C4" },
//   "giorni": { "rigaNumeri": 2, "rigaSigle": 3, "primaColonna": "E" },   // 31 colonne consecutive
//   "attivita": { "colonnaNome": "D", "primaRiga": 4, "ultimaRiga": 33,
//                 "colonnaTotale": "AJ", "totaleGenerale": "AJ34" },
//   "sedutePt": { "primaRiga": 6, "ultimaRiga": 32, "formatoData": "dd/mm/yyyy",
//                 "palestra": { "colonnaData": "AL", "colonnaCliente": "AM" },
//                 "acqua": { "colonnaData": "AN", "colonnaCliente": "AO" } },
//   "nomiMesi": ["Gennaio", …],                  // 12 nomi, come vanno scritti nella cella del mese
//   "sigleGiorni": ["LU", "MA", …, "DO"],          // 7 sigle, da lunedì a domenica
//   "nomeFile": "{MM}_{MESE}_{AAAA}_{COGNOME}.xlsx"
// }

const CELLA = /^([A-Z]{1,3})([1-9]\d{0,6})$/;
const COLONNA = /^[A-Z]{1,3}$/;
const SEGNAPOSTO_NOME_FILE = ['{MM}', '{MESE}', '{AAAA}', '{COGNOME}', '{NOME}'];

// Numero della colonna: A = 1, Z = 26, AA = 27.
function numeroColonna(lettere) {
  let n = 0;
  for (const c of lettere) n = n * 26 + (c.charCodeAt(0) - 64);
  return n;
}

function letteraColonna(n) {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// Testo di una cella letta con ExcelJS (stringa, testo formattato o formula).
function testoCella(valore) {
  if (valore == null) return '';
  if (typeof valore === 'object' && Array.isArray(valore.richText)) {
    return valore.richText.map((p) => p.text).join('').trim();
  }
  if (typeof valore === 'object' && 'result' in valore) return String(valore.result ?? '').trim();
  return String(valore).trim();
}

// Controlla la mappa e la restituisce; se non è valida lancia un errore che
// elenca tutti i problemi trovati.
function validaLayout(layout) {
  const problemi = [];
  const oggetto = (v, nome) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
    problemi.push(`${nome} mancante`);
    return {};
  };
  const verifica = (ok, messaggio) => {
    if (!ok) problemi.push(messaggio);
    return ok;
  };
  const cella = (v, nome) => verifica(typeof v === 'string' && CELLA.test(v), `${nome}: cella non valida (${JSON.stringify(v)})`);
  const colonna = (v, nome) => verifica(typeof v === 'string' && COLONNA.test(v), `${nome}: colonna non valida (${JSON.stringify(v)})`);
  const riga = (v, nome) => verifica(Number.isInteger(v) && v > 0, `${nome}: riga non valida (${JSON.stringify(v)})`);
  const testi = (v, quanti, nome) => {
    if (!Array.isArray(v) || v.length !== quanti || !v.every((t) => typeof t === 'string' && t.trim())) {
      problemi.push(`${nome}: servono ${quanti} testi`);
    }
  };

  const l = oggetto(layout, 'layout');
  if (typeof l.foglio !== 'string' || !l.foglio) problemi.push('foglio mancante');
  const celle = oggetto(l.celle, 'celle');
  for (const k of ['mese', 'nome', 'cognome']) cella(celle[k], `celle.${k}`);

  const giorni = oggetto(l.giorni, 'giorni');
  riga(giorni.rigaNumeri, 'giorni.rigaNumeri');
  riga(giorni.rigaSigle, 'giorni.rigaSigle');
  colonna(giorni.primaColonna, 'giorni.primaColonna');

  const att = oggetto(l.attivita, 'attivita');
  colonna(att.colonnaNome, 'attivita.colonnaNome');
  colonna(att.colonnaTotale, 'attivita.colonnaTotale');
  cella(att.totaleGenerale, 'attivita.totaleGenerale');
  if (riga(att.primaRiga, 'attivita.primaRiga') && riga(att.ultimaRiga, 'attivita.ultimaRiga') && att.ultimaRiga < att.primaRiga) {
    problemi.push('attivita: ultimaRiga precede primaRiga');
  }

  const pt = oggetto(l.sedutePt, 'sedutePt');
  if (riga(pt.primaRiga, 'sedutePt.primaRiga') && riga(pt.ultimaRiga, 'sedutePt.ultimaRiga') && pt.ultimaRiga < pt.primaRiga) {
    problemi.push('sedutePt: ultimaRiga precede primaRiga');
  }
  if (typeof pt.formatoData !== 'string' || !pt.formatoData) problemi.push('sedutePt.formatoData mancante');
  for (const tipo of ['palestra', 'acqua']) {
    const t = oggetto(pt[tipo], `sedutePt.${tipo}`);
    colonna(t.colonnaData, `sedutePt.${tipo}.colonnaData`);
    colonna(t.colonnaCliente, `sedutePt.${tipo}.colonnaCliente`);
  }

  testi(l.nomiMesi, 12, 'nomiMesi');
  testi(l.sigleGiorni, 7, 'sigleGiorni');
  if (typeof l.nomeFile !== 'string' || !l.nomeFile.endsWith('.xlsx')) {
    problemi.push('nomeFile deve finire con .xlsx');
  } else {
    const sconosciuti = (l.nomeFile.match(/\{[^}]*\}/g) ?? []).filter((s) => !SEGNAPOSTO_NOME_FILE.includes(s));
    if (sconosciuti.length) problemi.push(`nomeFile: segnaposto sconosciuti ${sconosciuti.join(', ')}`);
  }

  if (problemi.length) throw new Error(`Mappa del modello Excel non valida:\n - ${problemi.join('\n - ')}`);
  return l;
}

// Righe disponibili nel modello per le sedute PT di ciascun tipo.
const sedutePtPerTipo = (layout) => layout.sedutePt.ultimaRiga - layout.sedutePt.primaRiga + 1;

module.exports = { validaLayout, sedutePtPerTipo, testoCella, numeroColonna, letteraColonna };
