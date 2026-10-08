// Simula i promemoria automatici di un giorno a scelta, senza aspettarlo.
// Uso: npm run simula-promemoria -- --org bv --data 2026-10-25
// (--data facoltativa: oggi). Si comporta come il giro vero di quel giorno,
// a ora già passata: se il giorno non è un giorno di promemoria non succede
// nulla; altrimenti mette in coda la notifica a chi non ha ancora inviato
// il mese di quella data. Le email le invia poi l'API (in sviluppo arrivano
// alla casella finta Mailpit).
// I giri simulati sono tenuti separati da quelli veri: simulare il 25 non
// impedisce il promemoria vero del 25. Simulare due volte lo stesso giorno
// invece non manda nulla la seconda volta, come succederebbe davvero.
const { parseArgs } = require('node:util');
const { caricaConfig } = require('../config');
const { creaPool } = require('../db');
const { eseguiPromemoria } = require('../promemoria');
const { leggiData } = require('../validazione');
const { inItalia } = require('../tempo');

const DESCRIZIONI = {
  inviati: 'promemoria messi in coda',
  gia_eseguito: 'già eseguito per questo giorno: non parte nulla (un promemoria non parte mai due volte)',
  non_previsto: 'non è un giorno di promemoria',
};

async function main() {
  const { values } = parseArgs({ options: { org: { type: 'string' }, data: { type: 'string' } } });
  const data = values.data ?? inItalia().data;
  if (!leggiData(data)) throw new Error(`Data non valida: ${data} (formato AAAA-MM-GG)\nUso: npm run simula-promemoria -- --org bv --data 2026-10-25`);
  const config = caricaConfig();
  const pool = creaPool();
  try {
    if (values.org) {
      const { rows } = await pool.query('SELECT 1 FROM organizations WHERE slug = $1', [values.org]);
      if (!rows[0]) throw new Error(`Organizzazione "${values.org}" inesistente.`);
    }
    // Mezzogiorno UTC: in Italia è sempre lo stesso giorno.
    const esiti = await eseguiPromemoria(pool, config, { adesso: new Date(`${data}T12:00:00Z`), simulazione: true, slug: values.org ?? null });
    for (const e of esiti) {
      console.log(`${e.organizzazione}, ${e.data}: ${DESCRIZIONI[e.esito] ?? e.esito}`);
      if (e.esito === 'non_previsto') console.log(`  Giorni di promemoria di quel mese: ${e.giorni.join(', ') || 'nessuno'}`);
      if (e.esito === 'inviati') {
        const { rows } = await pool.query(
          'SELECT first_name, last_name, email FROM users WHERE id = ANY($1::uuid[]) ORDER BY last_name, first_name',
          [e.destinatari],
        );
        if (!rows.length) console.log('  Nessun destinatario: hanno già inviato tutti (o sono esonerati).');
        for (const r of rows) console.log(`  - ${r.first_name} ${r.last_name} <${r.email}>`);
        if (rows.length) console.log("  Le email partono dall'API entro pochi secondi.");
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
