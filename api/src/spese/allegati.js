// Ricevute delle spese: riconoscimento del tipo dal contenuto (mai dal nome
// o dal tipo dichiarato dal browser) e rielaborazione prima di salvarle.
// - Foto (JPEG, PNG, HEIC/HEIF degli iPhone): raddrizzate secondo
//   l'orientamento, ridotte a LATO_MASSIMO px sul lato lungo, salvate come
//   JPEG senza nessun metadato (EXIF, posizione GPS, profili, commenti):
//   il file nuovo è costruito dai soli pixel.
// - PDF: tenuti così come sono, se pdf-lib li apre (non protetti da
//   password) e non superano MAX_PAGINE.
const sharp = require('sharp');
const decodificaHeic = require('heic-decode');
const { PDFDocument } = require('pdf-lib');

const LATO_MASSIMO = 1600;
const QUALITA_JPEG = 80;
// Oltre questi pixel l'immagine non viene nemmeno decodificata (50 MP: le
// foto dei telefoni arrivano a 48 MP).
const MAX_PIXEL = 50_000_000;
const MAX_PAGINE = 20;
// Dimensione massima del file caricato: foto (prima della riduzione) e PDF.
const MAX_FOTO_BYTE = 20 * 1024 * 1024;

// Il server ha poca memoria: un'immagine alla volta.
sharp.cache(false);
sharp.concurrency(1);
let coda = Promise.resolve();
const unoAllaVolta = (fn) => {
  const giro = coda.then(fn, fn);
  coda = giro.catch(() => {});
  return giro;
};

class ErroreAllegato extends Error {}

const mb = (byte) => `${(byte / 1024 / 1024).toLocaleString('it-IT', { maximumFractionDigits: 1 })} MB`;

// Tipo del file dai primi byte: 'jpeg' | 'png' | 'heic' | 'pdf', oppure un
// nome da mostrare nell'errore per i formati noti ma non accettati, oppure null.
function riconosci(b) {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  // Il PDF può avere qualche byte prima di "%PDF-" (lo ammettono i lettori).
  if (b.subarray(0, 1024).includes('%PDF-')) return 'pdf';
  if (b.toString('latin1', 4, 8) === 'ftyp') {
    const marca = b.toString('latin1', 8, 12);
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(marca)) return 'heic';
    if (marca === 'avif' || marca === 'avis') return 'AVIF';
    return 'video o altro formato';
  }
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'WebP';
  if (b.toString('latin1', 0, 3) === 'GIF') return 'GIF';
  if (b.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) return 'documento Office o ZIP';
  return null;
}

async function pixelDaHeic(buffer) {
  let immagini;
  try {
    immagini = await decodificaHeic.all({ buffer });
  } catch {
    throw new ErroreAllegato('La foto HEIC non si riesce a leggere: è danneggiata o in un formato non supportato.');
  }
  try {
    // La prima immagine è quella principale (le miniature non sono tra queste).
    const img = immagini[0];
    if (img.width * img.height > MAX_PIXEL) throw new ErroreAllegato('La foto è troppo grande (oltre 50 megapixel).');
    const { width, height, data } = await img.decode();
    return sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), { raw: { width, height, channels: 4 } });
  } finally {
    immagini.dispose();
  }
}

async function riduciFoto(buffer, tipo) {
  return unoAllaVolta(async () => {
    let immagine;
    if (tipo === 'heic') {
      immagine = await pixelDaHeic(buffer);
    } else {
      immagine = sharp(buffer, { limitInputPixels: MAX_PIXEL, failOn: 'error' });
      // rotate() senza argomenti applica l'orientamento EXIF.
      immagine = immagine.rotate();
    }
    try {
      // Nessun withMetadata(): sharp non copia EXIF, GPS, XMP né commenti.
      const { data, info } = await immagine
        .resize({ width: LATO_MASSIMO, height: LATO_MASSIMO, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .toColourspace('srgb')
        .jpeg({ quality: QUALITA_JPEG, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
      return { buffer: data, larghezza: info.width, altezza: info.height };
    } catch (err) {
      if (/pixel limit/i.test(err.message)) throw new ErroreAllegato('La foto è troppo grande (oltre 50 megapixel).');
      throw new ErroreAllegato('La foto non si riesce a leggere: è danneggiata o incompleta.');
    }
  });
}

// Il PDF deve aprirsi e le sue pagine devono potersi copiare nel PDF delle
// spese: meglio scoprirlo ora che all'invio del mese.
async function verificaPdf(buffer) {
  let pagine;
  try {
    const doc = await PDFDocument.load(new Uint8Array(buffer), { updateMetadata: false });
    pagine = doc.getPageCount();
    if (pagine >= 1 && pagine <= MAX_PAGINE) await (await PDFDocument.create()).copyPages(doc, doc.getPageIndices());
  } catch (err) {
    if (/encrypt/i.test(err.message)) {
      throw new ErroreAllegato('Il PDF è protetto da password: salvalo senza protezione (o fotografa la ricevuta) e riprova.');
    }
    throw new ErroreAllegato('Il PDF non si riesce a leggere: è danneggiato o incompleto.');
  }
  if (pagine < 1) throw new ErroreAllegato('Il PDF non ha pagine.');
  if (pagine > MAX_PAGINE) throw new ErroreAllegato(`Il PDF ha ${pagine} pagine: al massimo ${MAX_PAGINE} per ricevuta.`);
  return pagine;
}

// Restituisce { buffer, tipo: 'image/jpeg' | 'application/pdf', pagine }.
// maxPdfByte = dimensione massima di un PDF caricato. Lancia ErroreAllegato
// con un messaggio per l'utente.
async function elaboraAllegato(buffer, { maxPdfByte }) {
  if (!buffer?.length) throw new ErroreAllegato('Il file è vuoto.');
  const tipo = riconosci(buffer);
  if (tipo === 'pdf') {
    if (buffer.length > maxPdfByte) {
      throw new ErroreAllegato(
        `Il PDF è di ${mb(buffer.length)}: al massimo ${mb(maxPdfByte)}, perché deve entrare nell'email alla segreteria. ` +
          'Prova a fotografare la ricevuta invece di allegare il PDF.',
      );
    }
    return { buffer, tipo: 'application/pdf', pagine: await verificaPdf(buffer) };
  }
  if (tipo === 'jpeg' || tipo === 'png' || tipo === 'heic') {
    if (buffer.length > MAX_FOTO_BYTE) throw new ErroreAllegato(`La foto è di ${mb(buffer.length)}: al massimo ${mb(MAX_FOTO_BYTE)}.`);
    const foto = await riduciFoto(buffer, tipo);
    return { buffer: foto.buffer, tipo: 'image/jpeg', pagine: 1 };
  }
  throw new ErroreAllegato(
    `${tipo ? `Formato non accettato (${tipo}).` : 'Il file non è una foto né un PDF.'} Si possono allegare foto (JPEG, PNG, HEIC) o PDF.`,
  );
}

module.exports = { elaboraAllegato, riconosci, ErroreAllegato, MAX_FOTO_BYTE, LATO_MASSIMO, mb };
