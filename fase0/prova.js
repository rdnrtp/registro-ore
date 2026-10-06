// Genera i casi di prova in fase0/output/ e li confronta con il modello.
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const JSZip = require('jszip'); // dipendenza di exceljs
const { generaFoglioMensile, giorniNelMese, siglaGiorno, MESI } = require('./genera-excel');

const MODELLO = path.join(__dirname, '..', 'modello', 'modello_bv.xlsx');
const OUTPUT = path.join(__dirname, 'output');

// Espande un orario tipo settimanale ({ LU: [[attività, ore], ...], ... }) sul mese
function daOrarioTipo(anno, mese, orario, eccezioni = {}) {
  const ore = [];
  for (let g = 1; g <= giorniNelMese(anno, mese); g++) {
    const righe = eccezioni[g] ?? orario[siglaGiorno(anno, mese, g)] ?? [];
    for (const [attivita, h] of righe) ore.push({ giorno: g, attivita, ore: h });
  }
  return ore;
}

const CASI = [
  {
    titolo: 'Ottobre 2026 — 31 giorni, il 1° è giovedì',
    dati: {
      anno: 2026, mese: 10, nome: 'Andrea', cognome: 'Petris',
      ore: daOrarioTipo(2026, 10, {
        LU: [['Segreteria', 4]], MA: [['NUOTO AGONISTICO', 2]], ME: [['Segreteria', 4]],
        GI: [['NUOTO AGONISTICO', 2]], VE: [['Segreteria', 4]],
      }),
      pt: [],
    },
  },
  {
    titolo: 'Febbraio 2027 — 28 giorni',
    dati: {
      anno: 2027, mese: 2, nome: 'Mario', cognome: 'Rossi',
      ore: daOrarioTipo(2027, 2, { SA: [['Bagnino', 6]], DO: [['Bagnino', 5.5]] }),
      pt: [],
    },
  },
  {
    titolo: 'Novembre 2026 — 30 giorni, più attività, mezz\'ore e sedute PT',
    dati: {
      anno: 2026, mese: 11, nome: 'Giulia', cognome: 'De Santis',
      ore: daOrarioTipo(2026, 11, {
        LU: [['Corsi nuoto Bambini', 1.5], ['Sala pesi', 3]],
        MA: [['Corsi Fit h2o', 1], ['Bagnino', 4.5]],
        ME: [['Corsi nuoto Bambini', 1.5], ['Sala pesi', 3]],
        GI: [['Corsi Fit h2o', 1], ['Bagnino', 4.5]],
        VE: [['Corsi nuoto Adulti', 2]],
        DO: [['Sala pesi domenica', 4]],
      }, {
        // eccezioni: 1/11 festivo, 15/11 compleanno, 20/11 corso di formazione
        1: [],
        15: [['Compleanni', 3]],
        20: [['Corsi formazione', 8]],
      }).concat([
        { giorno: 3, attivita: 'PT H2O singola', ore: 1 },
        { giorno: 10, attivita: 'PT Pal. singola', ore: 1 },
        { giorno: 12, attivita: 'PT Pal. Coppia', ore: 1 },
        { giorno: 30, attivita: 'Danza', ore: 0.5 },
      ]),
      pt: [
        { giorno: 3, tipo: 'acqua', cliente: 'Cliente Uno' },
        { giorno: 10, tipo: 'palestra', cliente: 'Cliente Due' },
        { giorno: 12, tipo: 'palestra', cliente: 'Cliente Tre e Quattro' },
        { giorno: 24, tipo: 'acqua', cliente: 'Cliente Cinque' },
      ],
    },
  },
];

// ---------- Verifica ----------
const coord = (r, c) => `${colonna(c)}${r}`;
function colonna(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

async function verifica(fileOut, dati, modello) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(fileOut);
  const ws = wb.worksheets[0];
  const wm = modello.worksheets[0];
  const problemi = [];
  const nGiorni = giorniNelMese(dati.anno, dati.mese);

  // Struttura: celle unite, larghezze, altezze, impostazioni di stampa
  const ordina = (v) => (v && typeof v === 'object' && !Array.isArray(v)) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, ordina(v[k])])) : v;
  const eq = (a, b) => JSON.stringify(ordina(a)) === JSON.stringify(ordina(b));
  if (!eq([...ws.model.merges].sort(), [...wm.model.merges].sort())) problemi.push('celle unite diverse');
  for (let c = 1; c <= 41; c++) if (ws.getColumn(c).width !== wm.getColumn(c).width) problemi.push(`larghezza colonna ${colonna(c)}`);
  for (let r = 1; r <= 49; r++) if (ws.getRow(r).height !== wm.getRow(r).height) problemi.push(`altezza riga ${r}`);
  const { firstPageNumber: _a, ...psOut } = ws.pageSetup, { firstPageNumber: _b, ...psMod } = wm.pageSetup;
  if (!eq(psOut, psMod)) problemi.push('impostazioni di pagina diverse: ' + JSON.stringify(psOut));

  // Stili cella per cella (bordi, riempimenti, font, allineamento, formato numero)
  let celleStile = 0;
  for (let r = 1; r <= 50; r++) for (let c = 1; c <= 42; c++) {
    const a = ws.getCell(r, c), b = wm.getCell(r, c);
    celleStile++;
    for (const k of ['border', 'fill', 'font', 'alignment', 'protection']) {
      if (!eq(a[k] ?? null, b[k] ?? null)) problemi.push(`${k} diverso in ${coord(r, c)}`);
    }
    const dataPT = (c === 38 || c === 40) && r >= 6 && r <= 32 && a.value instanceof Date;
    if (!dataPT && (a.numFmt ?? null) !== (b.numFmt ?? null)) problemi.push(`formato numero diverso in ${coord(r, c)}`);
  }

  // Regolamento
  if (ws.getCell('B35').value !== wm.getCell('B35').value) problemi.push('testo regolamento diverso');

  // Contenuti attesi
  if (ws.getCell('B2').value !== MESI[dati.mese - 1]) problemi.push('mese errato');
  if (ws.getCell('B4').value !== dati.nome || ws.getCell('C4').value !== dati.cognome) problemi.push('nome errato');
  for (let g = 1; g <= 31; g++) {
    const n = ws.getCell(2, 4 + g).value, s = ws.getCell(3, 4 + g).value;
    if (g <= nGiorni && (n !== g || s !== siglaGiorno(dati.anno, dati.mese, g))) problemi.push(`intestazione giorno ${g}`);
    if (g > nGiorni) {
      for (let r = 2; r <= 33; r++) if (ws.getCell(r, 4 + g).value != null) problemi.push(`colonna giorno ${g} non vuota (riga ${r})`);
    }
  }
  let atteso = 0, formule = 0;
  for (let r = 4; r <= 33; r++) {
    let somma = 0;
    for (let c = 5; c <= 35; c++) { const v = ws.getCell(r, c).value; if (v != null) somma += v; }
    atteso += somma;
    const t = ws.getCell(`AJ${r}`);
    if (t.formula) formule++;
    if (t.formula !== `SUM(E${r}:AI${r})` || t.result !== somma) problemi.push(`totale AJ${r}: ${JSON.stringify(t.value)} atteso ${somma}`);
  }
  const tg = ws.getCell('AJ34');
  if (tg.formula !== 'SUM(AJ4:AJ33)' || tg.result !== atteso) problemi.push(`totale generale ${JSON.stringify(tg.value)} atteso ${atteso}`);
  const oreDati = dati.ore.reduce((s, x) => s + x.ore, 0);
  if (oreDati !== atteso) problemi.push(`ore nel file ${atteso} ≠ ore nei dati ${oreDati}`);
  // ExcelJS non rilegge calcPr: si controlla direttamente l'XML
  const zip = await JSZip.loadAsync(fs.readFileSync(fileOut));
  const workbookXml = await zip.file('xl/workbook.xml').async('string');
  if (!/<calcPr[^>]*fullCalcOnLoad="1"/.test(workbookXml)) problemi.push('fullCalcOnLoad non impostato');

  return { problemi, totale: atteso, formule: formule + (tg.formula ? 1 : 0), celleStile };
}

(async () => {
  fs.mkdirSync(OUTPUT, { recursive: true });
  const modello = new ExcelJS.Workbook();
  await modello.xlsx.readFile(MODELLO);
  let ok = true;
  for (const { titolo, dati } of CASI) {
    const { workbook, nomeFile } = await generaFoglioMensile(MODELLO, dati);
    const out = path.join(OUTPUT, nomeFile);
    await workbook.xlsx.writeFile(out);
    const { problemi, totale, formule, celleStile } = await verifica(out, dati, modello);
    console.log(`\n${titolo}\n  file: ${nomeFile}\n  ore totali: ${totale} — formule totali conservate: ${formule}/31 — celle con stile confrontate: ${celleStile}`);
    if (problemi.length) { ok = false; console.log('  PROBLEMI:\n   - ' + problemi.join('\n   - ')); }
    else console.log('  verifica: OK');
  }
  process.exitCode = ok ? 0 : 1;
})();
