// Icone provvisorie dell'app installabile: un orologio bianco su fondo blu.
// Disegnate qui senza librerie (PNG scritti a mano), in public/icone/.
// Uso: node scripts/genera-icone.mjs (dalla cartella frontend).
// Per le icone definitive basta sostituire i file con gli stessi nomi.
import { writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';

const BLU = [0x0b, 0x6e, 0x99];
const BIANCO = [0xff, 0xff, 0xff];
const CAMPIONI = 4; // 4×4 campioni per pixel: bordi morbidi

// PNG RGBA 8 bit.
function png(lato, pixel) {
  const blocco = (tipo, dati) => {
    const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dati]);
    const lunghezza = Buffer.alloc(4);
    lunghezza.writeUInt32BE(dati.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(corpo));
    return Buffer.concat([lunghezza, corpo, crc]);
  };
  const testa = Buffer.alloc(13);
  testa.writeUInt32BE(lato, 0);
  testa.writeUInt32BE(lato, 4);
  testa[8] = 8; // bit per canale
  testa[9] = 6; // RGBA
  const righe = Buffer.alloc(lato * (lato * 4 + 1));
  for (let y = 0; y < lato; y++) pixel.copy(righe, y * (lato * 4 + 1) + 1, y * lato * 4, (y + 1) * lato * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    blocco('IHDR', testa),
    blocco('IDAT', deflateSync(righe, { level: 9 })),
    blocco('IEND', Buffer.alloc(0)),
  ]);
}

// Distanza del punto (px, py) dal segmento (ax, ay)–(bx, by).
function distanzaSegmento(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

// Coordinate in [0, 1]. scala = grandezza dell'orologio rispetto all'icona;
// angoli = raggio degli angoli arrotondati (0 = quadrato pieno).
function disegna(lato, { scala, angoli }) {
  const pixel = Buffer.alloc(lato * lato * 4);
  const R = 0.34 * scala; // raggio dell'orologio
  const spessore = 0.075 * scala;
  const lancetta = 0.06 * scala;
  // Dentro il quadrato con gli angoli arrotondati?
  const nelFondo = (x, y) => {
    if (!angoli) return true;
    const cx = Math.min(Math.max(x, angoli), 1 - angoli);
    const cy = Math.min(Math.max(y, angoli), 1 - angoli);
    return Math.hypot(x - cx, y - cy) <= angoli;
  };
  const bianco = (x, y) => {
    const d = Math.hypot(x - 0.5, y - 0.5);
    if (Math.abs(d - R) <= spessore / 2) return true; // cerchio
    if (distanzaSegmento(x, y, 0.5, 0.5, 0.5, 0.5 - R * 0.62) <= lancetta / 2) return true; // minuti, verso le 12
    if (distanzaSegmento(x, y, 0.5, 0.5, 0.5 + R * 0.45, 0.5) <= lancetta / 2) return true; // ore, verso le 3
    return false;
  };
  for (let py = 0; py < lato; py++) {
    for (let px = 0; px < lato; px++) {
      let fondo = 0;
      let chiari = 0;
      for (let sy = 0; sy < CAMPIONI; sy++) {
        for (let sx = 0; sx < CAMPIONI; sx++) {
          const x = (px + (sx + 0.5) / CAMPIONI) / lato;
          const y = (py + (sy + 0.5) / CAMPIONI) / lato;
          if (!nelFondo(x, y)) continue;
          fondo++;
          if (bianco(x, y)) chiari++;
        }
      }
      const i = (py * lato + px) * 4;
      const t = fondo ? chiari / fondo : 0;
      for (let c = 0; c < 3; c++) pixel[i + c] = Math.round(BLU[c] + (BIANCO[c] - BLU[c]) * t);
      pixel[i + 3] = Math.round((255 * fondo) / CAMPIONI ** 2);
    }
  }
  return png(lato, pixel);
}

const cartella = new URL('../public/icone/', import.meta.url);
const icone = {
  // "any": angoli arrotondati, orologio grande.
  'icona-192.png': disegna(192, { scala: 1.15, angoli: 0.18 }),
  'icona-512.png': disegna(512, { scala: 1.15, angoli: 0.18 }),
  // "maskable": quadrato pieno, disegno dentro l'80% centrale (Android lo ritaglia).
  'icona-maskable-192.png': disegna(192, { scala: 0.95, angoli: 0 }),
  'icona-maskable-512.png': disegna(512, { scala: 0.95, angoli: 0 }),
  // iPhone: quadrato pieno, gli angoli li arrotonda iOS.
  'apple-touch-icon.png': disegna(180, { scala: 1.1, angoli: 0 }),
};
for (const [nome, dati] of Object.entries(icone)) {
  writeFileSync(new URL(nome, cartella), dati);
  console.log(`public/icone/${nome}: ${dati.length} byte`);
}
