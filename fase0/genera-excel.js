// Fase 0 — prova di fattibilità: compila il modello Excel mensile di BV con ExcelJS.
// La mappa del modello (LAYOUT_BV) è separata dal codice: nell'app diventerà
// configurazione dell'organizzazione, insieme al file modello.
const ExcelJS = require('exceljs');

const LAYOUT_BV = {
  foglio: 'Foglio1',
  cellaMese: 'B2', // unita B2:C3
  cellaNome: 'B4', // unita B4:B33
  cellaCognome: 'C4', // unita C4:C33
  rigaNumeriGiorno: 2,
  rigaSigleGiorno: 3,
  colonnaPrimoGiorno: 'E', // giorni 1..31 = E..AI
  colonnaAttivita: 'D',
  primaRigaAttivita: 4,
  ultimaRigaAttivita: 33,
  colonnaTotale: 'AJ', // totale per attività
  cellaTotaleGenerale: 'AJ34',
  pt: {
    primaRiga: 6,
    ultimaRiga: 32,
    palestra: { data: 'AL', cliente: 'AM' },
    acqua: { data: 'AN', cliente: 'AO' },
    formatoData: 'dd/mm/yyyy',
  },
};

const MESI = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio',
  'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
const SIGLE = ['DO', 'LU', 'MA', 'ME', 'GI', 'VE', 'SA']; // indice = getUTCDay()

const giorniNelMese = (anno, mese) => new Date(Date.UTC(anno, mese, 0)).getUTCDate();
const siglaGiorno = (anno, mese, giorno) => SIGLE[new Date(Date.UTC(anno, mese - 1, giorno)).getUTCDay()];
const colonnaGiorno = (ws, layout, giorno) => ws.getColumn(layout.colonnaPrimoGiorno).number + giorno - 1;

function nomeFile({ anno, mese, cognome }) {
  const mm = String(mese).padStart(2, '0');
  const c = cognome.trim().replace(/[\\/:*?"<>|\s]+/g, '_');
  return `${mm}_${MESI[mese - 1]}_${anno}_${c}.xlsx`;
}

// dati: { anno, mese (1-12), nome, cognome,
//         ore: [{ giorno, attivita, ore }], pt: [{ giorno, tipo: 'palestra'|'acqua', cliente }] }
async function generaFoglioMensile(percorsoModello, dati, layout = LAYOUT_BV) {
  const { anno, mese } = dati;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(percorsoModello);
  const ws = wb.getWorksheet(layout.foglio);
  const nGiorni = giorniNelMese(anno, mese);
  const colPrimo = ws.getColumn(layout.colonnaPrimoGiorno).number;

  // Intestazione: mese, nome, numeri e sigle dei giorni
  ws.getCell(layout.cellaMese).value = MESI[mese - 1];
  ws.getCell(layout.cellaNome).value = dati.nome;
  ws.getCell(layout.cellaCognome).value = dati.cognome;
  for (let g = 1; g <= 31; g++) {
    const col = colPrimo + g - 1;
    const esiste = g <= nGiorni;
    ws.getCell(layout.rigaNumeriGiorno, col).value = esiste ? g : null;
    ws.getCell(layout.rigaSigleGiorno, col).value = esiste ? siglaGiorno(anno, mese, g) : null;
  }

  // Attività lette dal modello (colonna D) -> riga
  const rigaPerAttivita = new Map();
  for (let r = layout.primaRigaAttivita; r <= layout.ultimaRigaAttivita; r++) {
    const nome = String(ws.getCell(layout.colonnaAttivita + r).value ?? '').trim();
    if (nome) rigaPerAttivita.set(nome.toLowerCase(), r);
  }

  // Svuota la griglia ore (il modello contiene ore di esempio e trattini)
  for (let r = layout.primaRigaAttivita; r <= layout.ultimaRigaAttivita; r++) {
    for (let g = 1; g <= 31; g++) ws.getCell(r, colPrimo + g - 1).value = null;
  }

  // Scrive le ore, controllando giorno, attività e passo di mezz'ora
  const somme = new Map();
  for (const { giorno, attivita, ore } of dati.ore) {
    if (giorno < 1 || giorno > nGiorni) throw new Error(`Giorno ${giorno} non valido per ${MESI[mese - 1]} ${anno}`);
    const r = rigaPerAttivita.get(attivita.trim().toLowerCase());
    if (!r) throw new Error(`Attività "${attivita}" non presente nel modello`);
    if (!(ore > 0) || !Number.isInteger(ore * 2)) throw new Error(`Ore ${ore} non valide (passi di mezz'ora)`);
    const cella = ws.getCell(r, colPrimo + giorno - 1);
    if (cella.value != null) throw new Error(`Doppia riga per ${attivita} il giorno ${giorno}`);
    cella.value = ore;
    somme.set(r, (somme.get(r) || 0) + ore);
  }

  // Totali: se sono formule le conserva e scrive il risultato in cache,
  // altrimenti scrive direttamente il valore.
  const totali = [];
  let totaleGenerale = 0;
  for (let r = layout.primaRigaAttivita; r <= layout.ultimaRigaAttivita; r++) {
    const cella = ws.getCell(layout.colonnaTotale + r);
    const valore = somme.get(r) || 0;
    totaleGenerale += valore;
    totali.push({ cella, formula: cella.formula, valore }); // .formula traduce anche le formule condivise
  }
  totali.push({ cella: ws.getCell(layout.cellaTotaleGenerale), formula: ws.getCell(layout.cellaTotaleGenerale).formula, valore: totaleGenerale });
  for (const { cella, formula, valore } of totali) {
    cella.value = formula ? { formula, result: valore } : valore;
  }

  // Sedute PT
  const { pt } = layout;
  for (let r = pt.primaRiga; r <= pt.ultimaRiga; r++) {
    for (const t of [pt.palestra, pt.acqua]) {
      ws.getCell(t.data + r).value = null;
      ws.getCell(t.cliente + r).value = null;
    }
  }
  const prossimaRiga = { palestra: pt.primaRiga, acqua: pt.primaRiga };
  const sedute = [...(dati.pt || [])].sort((a, b) => a.giorno - b.giorno);
  for (const s of sedute) {
    const t = pt[s.tipo];
    if (!t) throw new Error(`Tipo PT "${s.tipo}" non valido`);
    if (s.giorno < 1 || s.giorno > nGiorni) throw new Error(`Giorno PT ${s.giorno} non valido`);
    const r = prossimaRiga[s.tipo]++;
    if (r > pt.ultimaRiga) throw new Error(`Troppe sedute PT ${s.tipo}: il modello ne contiene ${pt.ultimaRiga - pt.primaRiga + 1}`);
    const cData = ws.getCell(t.data + r);
    cData.value = new Date(Date.UTC(anno, mese - 1, s.giorno));
    // ExcelJS condivide l'oggetto stile tra celle con lo stesso formato: va clonato,
    // altrimenti cData.numFmt = ... cambierebbe il formato di tutta la colonna
    cData.style = { ...cData.style, numFmt: pt.formatoData };
    ws.getCell(t.cliente + r).value = s.cliente;
  }

  // ExcelJS scriverebbe useFirstPageNumber="1" se firstPageNumber è valorizzato: il modello non lo ha
  if (ws.pageSetup.firstPageNumber === 1 && !ws.pageSetup.useFirstPageNumber) ws.pageSetup.firstPageNumber = undefined;

  // Metadati: altrimenti il file eredita autore e data del modello
  wb.lastModifiedBy = `${dati.nome} ${dati.cognome}`;
  wb.modified = new Date();

  // Excel ricalcola tutte le formule all'apertura
  wb.calcProperties.fullCalcOnLoad = true;

  return { workbook: wb, nomeFile: nomeFile(dati), totaleGenerale };
}

module.exports = { generaFoglioMensile, nomeFile, giorniNelMese, siglaGiorno, LAYOUT_BV, MESI };
