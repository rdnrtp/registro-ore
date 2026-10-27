// PDF delle spese per la segreteria: prima il riepilogo (una o più pagine:
// data, tipo, motivo, importo, pagine delle ricevute, totale), poi le
// ricevute nell'ordine della tabella: ogni foto su una pagina sua, con
// un'intestazione che dice a quale spesa appartiene; i PDF allegati con
// tutte le loro pagine, così come sono.
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { NOME_APP } = require('../notifiche');

const A4 = [595.28, 841.89];
const MARGINE = 48;
const NERO = rgb(0, 0, 0);
const GRIGIO = rgb(0.4, 0.4, 0.4);
const RIGA = rgb(0.75, 0.75, 0.75);

// I caratteri standard del PDF conoscono solo la codifica WinAnsi: gli altri
// diventano equivalenti semplici o "?".
const WINANSI = new Set(
  [...'€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'].map((c) => c.codePointAt(0)).concat(
    Array.from({ length: 95 }, (_, i) => 0x20 + i),
    Array.from({ length: 96 }, (_, i) => 0xa0 + i),
  ),
);
function testoPdf(s) {
  return String(s ?? '')
    .normalize('NFC')
    .replace(/[   \t\r\n]/g, ' ')
    .replace(/[‐‑‒]/g, '-')
    .replace(/./gu, (c) => (WINANSI.has(c.codePointAt(0)) ? c : '?'));
}

const euro = (centesimi) =>
  `${(centesimi / 100).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true })} €`;
const dataBreve = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

// Divide un testo in righe che stanno nella larghezza indicata.
function aCapo(testo, font, corpo, larghezza) {
  const righe = [];
  let riga = '';
  for (const parola of testo.split(' ').filter(Boolean)) {
    const prova = riga ? `${riga} ${parola}` : parola;
    if (font.widthOfTextAtSize(prova, corpo) <= larghezza) {
      riga = prova;
      continue;
    }
    if (riga) righe.push(riga);
    // Parola più lunga della colonna: spezzata a caratteri.
    riga = '';
    for (const c of parola) {
      if (font.widthOfTextAtSize(riga + c, corpo) > larghezza) {
        righe.push(riga);
        riga = '';
      }
      riga += c;
    }
  }
  if (riga) righe.push(riga);
  return righe.length ? righe : [''];
}

// Colonne del riepilogo: x e larghezza (pt).
const COLONNE = [
  { chiave: 'n', titolo: 'N.', larghezza: 24 },
  { chiave: 'data', titolo: 'Data', larghezza: 62 },
  { chiave: 'tipo', titolo: 'Tipo', larghezza: 78 },
  { chiave: 'motivo', titolo: 'Motivo della trasferta', larghezza: 214 },
  { chiave: 'importo', titolo: 'Importo', larghezza: 66, destra: true },
  { chiave: 'pagine', titolo: 'Pagine', larghezza: 55, destra: true },
];
{
  let x = MARGINE;
  for (const c of COLONNE) {
    c.x = x;
    x += c.larghezza;
  }
}
const CORPO = 9.5;
const INTERLINEA = 12;

// dati: { organizzazione, nome, cognome, titolo, sottotitolo,
//         spese: [{ data, tipo, importo_centesimi, motivo,
//                   allegati: [{ content_type, file, pagine }] }] }
// Restituisce un Buffer.
async function generaPdfSpese(dati) {
  const doc = await PDFDocument.create();
  const chi = `${dati.nome} ${dati.cognome}`;
  doc.setTitle(testoPdf(`${dati.titolo} – ${chi}`));
  doc.setAuthor(testoPdf(chi));
  doc.setCreator(NOME_APP);
  doc.setProducer(NOME_APP);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const grassetto = await doc.embedFont(StandardFonts.HelveticaBold);

  // Righe della tabella, già divise a capo.
  const righe = dati.spese.map((s, i) => {
    const celle = {
      n: [String(i + 1)],
      data: [dataBreve(s.data)],
      tipo: aCapo(testoPdf(s.tipo), font, CORPO, COLONNE[2].larghezza - 6),
      motivo: aCapo(testoPdf(s.motivo), font, CORPO, COLONNE[3].larghezza - 6),
      importo: [testoPdf(euro(s.importo_centesimi))],
    };
    return { celle, altezza: Math.max(celle.tipo.length, celle.motivo.length) * INTERLINEA + 6 };
  });

  // Impaginazione del riepilogo: quante pagine servono (la prima ha
  // l'intestazione, l'ultima anche il totale).
  const testataPrima = 128;
  const testataAltre = 40;
  const pagineRiepilogo = [];
  let corrente = [];
  let spazio = A4[1] - MARGINE * 2 - testataPrima - 20;
  for (const r of righe) {
    if (r.altezza > spazio && corrente.length) {
      pagineRiepilogo.push(corrente);
      corrente = [];
      spazio = A4[1] - MARGINE * 2 - testataAltre - 20;
    }
    corrente.push(r);
    spazio -= r.altezza;
  }
  if (spazio < 60 && corrente.length) {
    pagineRiepilogo.push(corrente);
    corrente = [];
  }
  pagineRiepilogo.push(corrente);

  // Pagine delle ricevute di ogni spesa.
  let pagina = pagineRiepilogo.length + 1;
  dati.spese.forEach((s, i) => {
    const n = s.allegati.reduce((t, a) => t + a.pagine, 0);
    righe[i].celle.pagine = [n === 1 ? String(pagina) : `${pagina}-${pagina + n - 1}`];
    pagina += n;
  });
  const totalePagine = pagina - 1;
  const totale = dati.spese.reduce((t, s) => t + s.importo_centesimi, 0);

  const scrivi = (p, testo, x, y, { f = font, corpo = CORPO, colore = NERO } = {}) =>
    p.drawText(testoPdf(testo), { x, y, size: corpo, font: f, color: colore });
  const piede = (p, numero) =>
    scrivi(p, `${chi} · ${dati.titolo} · pagina ${numero} di ${totalePagine}`, MARGINE, MARGINE / 2, { corpo: 8, colore: GRIGIO });

  pagineRiepilogo.forEach((gruppo, indice) => {
    const p = doc.addPage(A4);
    let y = A4[1] - MARGINE;
    if (indice === 0) {
      scrivi(p, dati.titolo, MARGINE, y - 18, { f: grassetto, corpo: 18 });
      y -= 42;
      scrivi(p, chi, MARGINE, y, { f: grassetto, corpo: 12 });
      y -= 16;
      scrivi(p, dati.organizzazione, MARGINE, y, { corpo: 11 });
      y -= 16;
      scrivi(p, dati.sottotitolo, MARGINE, y, { corpo: 9, colore: GRIGIO });
      y -= 30;
    } else {
      scrivi(p, `${dati.titolo} – ${chi} (segue)`, MARGINE, y - 12, { f: grassetto, corpo: 11 });
      y -= testataAltre;
    }
    // Intestazione della tabella.
    for (const c of COLONNE) {
      const larghezza = grassetto.widthOfTextAtSize(c.titolo, 8.5);
      scrivi(p, c.titolo, c.destra ? c.x + c.larghezza - 3 - larghezza : c.x + 3, y, { f: grassetto, corpo: 8.5 });
    }
    y -= 6;
    p.drawLine({ start: { x: MARGINE, y }, end: { x: A4[0] - MARGINE, y }, thickness: 1, color: NERO });
    for (const r of gruppo) {
      y -= INTERLINEA;
      for (const c of COLONNE) {
        r.celle[c.chiave].forEach((testo, k) => {
          const x = c.destra ? c.x + c.larghezza - 3 - font.widthOfTextAtSize(testo, CORPO) : c.x + 3;
          scrivi(p, testo, x, y - k * INTERLINEA);
        });
      }
      y -= r.altezza - INTERLINEA;
      p.drawLine({ start: { x: MARGINE, y: y + 2 }, end: { x: A4[0] - MARGINE, y: y + 2 }, thickness: 0.5, color: RIGA });
    }
    if (indice === pagineRiepilogo.length - 1) {
      y -= 18;
      const etichetta = `Totale (${dati.spese.length} ${dati.spese.length === 1 ? 'spesa' : 'spese'})`;
      scrivi(p, etichetta, COLONNE[3].x + 3, y, { f: grassetto, corpo: 11 });
      const t = testoPdf(euro(totale));
      const c = COLONNE[4];
      scrivi(p, t, c.x + c.larghezza - 3 - grassetto.widthOfTextAtSize(t, 11), y, { f: grassetto, corpo: 11 });
      y -= 26;
      scrivi(p, 'Seguono le ricevute, nell\'ordine della tabella (colonna "Pagine": dove si trovano in questo file).', MARGINE, y, {
        corpo: 8.5,
        colore: GRIGIO,
      });
    }
    piede(p, indice + 1);
  });

  // Ricevute. pdf-lib legge i byte dall'inizio del buffer sottostante: i
  // Buffer che arrivano dal database sono porzioni di un buffer più grande,
  // quindi si copiano.
  let numero = pagineRiepilogo.length;
  for (const [i, s] of dati.spese.entries()) {
    for (const [j, a] of s.allegati.entries()) {
      const byte = new Uint8Array(a.file);
      if (a.content_type === 'application/pdf') {
        const sorgente = await PDFDocument.load(byte, { updateMetadata: false });
        const copie = await doc.copyPages(sorgente, sorgente.getPageIndices());
        for (const c of copie) doc.addPage(c);
        numero += copie.length;
        continue;
      }
      const img = await doc.embedJpg(byte);
      // Foto orizzontale = pagina orizzontale.
      const formato = img.width > img.height ? [A4[1], A4[0]] : A4;
      const p = doc.addPage(formato);
      numero += 1;
      const intestazione =
        `Spesa n. ${i + 1} · ${dataBreve(s.data)} · ${s.tipo} · ${euro(s.importo_centesimi)}` +
        (s.allegati.length > 1 ? ` · ricevuta ${j + 1} di ${s.allegati.length}` : '');
      scrivi(p, intestazione, MARGINE, formato[1] - MARGINE + 10, { f: grassetto, corpo: 10 });
      const largh = formato[0] - MARGINE * 2;
      const alt = formato[1] - MARGINE * 2 - 16;
      const scala = Math.min(largh / img.width, alt / img.height, 1.5);
      const w = img.width * scala;
      const h = img.height * scala;
      p.drawImage(img, { x: (formato[0] - w) / 2, y: MARGINE + (alt - h) / 2, width: w, height: h });
      piede(p, numero);
    }
  }
  return Buffer.from(await doc.save());
}

module.exports = { generaPdfSpese, euro, dataBreve, testoPdf };
