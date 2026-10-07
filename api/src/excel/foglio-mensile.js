// Compila il modello Excel mensile di un'organizzazione con le registrazioni
// di un utente. Parte dal file del modello, così formattazione, celle unite,
// formule e testo del regolamento restano quelli originali; le posizioni delle
// celle vengono dalla mappa (layout.js), mai dal codice.
const ExcelJS = require('exceljs');
const { numeroColonna, testoCella } = require('./layout');

const GIORNI_COLONNE = 31;

// Il modello non corrisponde ai dati (attività su righe diverse, troppe
// sedute per le righe disponibili…): il file non va generato.
class ErroreModello extends Error {}

const giorniNelMese = (anno, mese) => new Date(Date.UTC(anno, mese, 0)).getUTCDate();
// Giorno della settimana: 0 = lunedì … 6 = domenica.
const giornoSettimana = (anno, mese, giorno) => (new Date(Date.UTC(anno, mese - 1, giorno)).getUTCDay() + 6) % 7;

// Parte del nome del file: niente caratteri vietati da Windows né spazi.
const perNomeFile = (testo) =>
  String(testo)
    .trim()
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\s\x00-\x1f]+/g, '_')
    .replace(/^_+|_+$/g, '');

function nomeFileMensile(layout, { anno, mese, nome, cognome }) {
  const valori = {
    '{MM}': String(mese).padStart(2, '0'),
    '{MESE}': layout.nomiMesi[mese - 1],
    '{AAAA}': String(anno),
    '{COGNOME}': cognome,
    '{NOME}': nome,
  };
  return layout.nomeFile.replace(/\{[A-Z]+\}/g, (s) => perNomeFile(valori[s] ?? s));
}

// dati: { anno, mese (1-12), nome, cognome,
//         attivita: [{ id, nome, riga }]                  tutte le attività dell'organizzazione
//         registrazioni: [{ giorno, attivita_id, quantita }]
//         sedutePt: [{ giorno, tipo: 'palestra' | 'acqua', cliente }] }
// Restituisce { buffer, nomeFile, totaleFile }: totaleFile è il valore del
// totale generale del modello (somma di tutte le righe, sedute comprese).
async function generaFoglioMensile(modello, layout, dati) {
  const { anno, mese } = dati;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(modello);
  const ws = wb.getWorksheet(layout.foglio);
  if (!ws) throw new ErroreModello(`il foglio "${layout.foglio}" non esiste nel modello`);
  const nGiorni = giorniNelMese(anno, mese);
  const colPrimo = numeroColonna(layout.giorni.primaColonna);
  const att = layout.attivita;

  // Ogni attività deve trovarsi nel modello sulla sua riga, con lo stesso nome:
  // se il modello è cambiato senza aggiornare le attività il file sarebbe sbagliato.
  const rigaDi = new Map();
  for (const a of dati.attivita) {
    if (a.riga < att.primaRiga || a.riga > att.ultimaRiga) {
      throw new ErroreModello(`l'attività "${a.nome}" è sulla riga ${a.riga}, fuori dalle righe delle attività`);
    }
    const nelModello = testoCella(ws.getCell(`${att.colonnaNome}${a.riga}`).value);
    if (nelModello !== a.nome) {
      throw new ErroreModello(`alla riga ${a.riga} il modello ha "${nelModello}" invece di "${a.nome}"`);
    }
    rigaDi.set(a.id, a.riga);
  }

  // Intestazione: mese, nome, numeri e sigle dei giorni. Le colonne dei
  // giorni che il mese non ha restano vuote.
  ws.getCell(layout.celle.mese).value = layout.nomiMesi[mese - 1];
  ws.getCell(layout.celle.nome).value = dati.nome;
  ws.getCell(layout.celle.cognome).value = dati.cognome;
  for (let g = 1; g <= GIORNI_COLONNE; g++) {
    const col = colPrimo + g - 1;
    const esiste = g <= nGiorni;
    ws.getCell(layout.giorni.rigaNumeri, col).value = esiste ? g : null;
    ws.getCell(layout.giorni.rigaSigle, col).value = esiste ? layout.sigleGiorni[giornoSettimana(anno, mese, g)] : null;
  }

  // Svuota la griglia (il modello contiene valori di esempio e trattini).
  for (let r = att.primaRiga; r <= att.ultimaRiga; r++) {
    for (let g = 1; g <= GIORNI_COLONNE; g++) ws.getCell(r, colPrimo + g - 1).value = null;
  }

  // Quantità nella riga dell'attività e nella colonna del giorno; le attività
  // a sedute scrivono il numero di sedute.
  const somme = new Map();
  for (const { giorno, attivita_id: id, quantita } of dati.registrazioni) {
    const r = rigaDi.get(id);
    if (!r) throw new ErroreModello(`attività ${id} sconosciuta`);
    if (!Number.isInteger(giorno) || giorno < 1 || giorno > nGiorni) throw new ErroreModello(`giorno ${giorno} non valido`);
    if (!(quantita > 0) || !Number.isInteger(quantita * 2)) throw new ErroreModello(`quantità ${quantita} non valida`);
    const cella = ws.getCell(r, colPrimo + giorno - 1);
    if (cella.value != null) throw new ErroreModello(`due valori per la riga ${r} il giorno ${giorno}`);
    cella.value = quantita;
    somme.set(r, (somme.get(r) ?? 0) + quantita);
  }

  // Totali: le formule restano formule, con il risultato calcolato in cache
  // (ExcelJS non calcola le formule). Se una cella non è una formula si
  // scrive il valore. .formula traduce anche le formule condivise.
  let totaleFile = 0;
  const totali = [];
  for (let r = att.primaRiga; r <= att.ultimaRiga; r++) {
    const valore = somme.get(r) ?? 0;
    totaleFile += valore;
    totali.push([ws.getCell(`${att.colonnaTotale}${r}`), valore]);
  }
  totali.push([ws.getCell(att.totaleGenerale), totaleFile]);
  for (const [cella, valore] of totali) {
    const { formula } = cella;
    cella.value = formula ? { formula, result: valore } : valore;
  }

  // Sedute di personal training, in ordine di data, nelle due tabelle.
  const pt = layout.sedutePt;
  for (let r = pt.primaRiga; r <= pt.ultimaRiga; r++) {
    for (const tipo of ['palestra', 'acqua']) {
      ws.getCell(`${pt[tipo].colonnaData}${r}`).value = null;
      ws.getCell(`${pt[tipo].colonnaCliente}${r}`).value = null;
    }
  }
  const prossimaRiga = { palestra: pt.primaRiga, acqua: pt.primaRiga };
  const sedute = [...dati.sedutePt].sort((a, b) => a.giorno - b.giorno);
  for (const s of sedute) {
    if (!Object.hasOwn(prossimaRiga, s.tipo)) throw new ErroreModello(`tipo di seduta "${s.tipo}" non valido`);
    const t = pt[s.tipo];
    if (!Number.isInteger(s.giorno) || s.giorno < 1 || s.giorno > nGiorni) throw new ErroreModello(`giorno ${s.giorno} non valido`);
    const r = prossimaRiga[s.tipo]++;
    if (r > pt.ultimaRiga) {
      throw new ErroreModello(`troppe sedute PT in ${s.tipo}: il modello ne contiene ${pt.ultimaRiga - pt.primaRiga + 1}`);
    }
    const cData = ws.getCell(`${t.colonnaData}${r}`);
    cData.value = new Date(Date.UTC(anno, mese - 1, s.giorno));
    // ExcelJS condivide lo stesso oggetto stile tra celle con lo stesso
    // formato: va clonato, altrimenti cambierebbe il formato di tutte.
    cData.style = { ...cData.style, numFmt: pt.formatoData };
    ws.getCell(`${t.colonnaCliente}${r}`).value = s.cliente;
  }

  // ExcelJS scriverebbe useFirstPageNumber="1" se firstPageNumber è valorizzato.
  if (ws.pageSetup.firstPageNumber === 1 && !ws.pageSetup.useFirstPageNumber) ws.pageSetup.firstPageNumber = undefined;

  // Altrimenti il file eredita autore e data di modifica del modello.
  wb.lastModifiedBy = `${dati.nome} ${dati.cognome}`;
  wb.modified = new Date();
  // Excel ricalcola tutte le formule all'apertura.
  wb.calcProperties.fullCalcOnLoad = true;

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, nomeFile: nomeFileMensile(layout, dati), totaleFile };
}

module.exports = { generaFoglioMensile, nomeFileMensile, ErroreModello };
