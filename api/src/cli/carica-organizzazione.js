// Crea o aggiorna un'organizzazione a partire da una cartella di configurazione.
// Uso: npm run carica-organizzazione -- bv
// (bv = sottocartella di seed/, montata in Docker su /dati/seed)
//
// La cartella contiene:
//   organizzazione.json  slug, nome, posizione delle attività nel modello Excel,
//                        righe a "sedute", elenco dei settori (tracciato)
//   contatti.json        email di invio e dei responsabili (NON tracciato)
//   abbinamenti.json     attività -> settori; se manca gli abbinamenti non
//                        vengono toccati (tracciato, solo dopo conferma)
// Le attività si leggono dal modello Excel indicato in organizzazione.json.
// Il comando si può rieseguire: aggiorna i dati senza duplicarli.
const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('exceljs');
const { creaPool } = require('../db');

function leggiJson(file, obbligatorio = true) {
  if (!fs.existsSync(file)) {
    if (obbligatorio) throw new Error(`File mancante: ${file}`);
    return null;
  }
  const dati = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete dati._nota;
  return dati;
}

function testoCella(valore) {
  if (valore == null) return '';
  if (typeof valore === 'object' && Array.isArray(valore.richText)) {
    return valore.richText.map((p) => p.text).join('').trim();
  }
  if (typeof valore === 'object' && 'result' in valore) return String(valore.result ?? '').trim();
  return String(valore).trim();
}

async function leggiAttivita(cartella, conf) {
  const m = conf.modello;
  const file = path.resolve(cartella, m.file);
  if (!fs.existsSync(file)) throw new Error(`Modello Excel non trovato: ${file}`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet(m.foglio);
  if (!ws) throw new Error(`Foglio "${m.foglio}" non trovato nel modello`);
  const sedute = new Set(conf.righeASedute ?? []);
  const attivita = [];
  for (let riga = m.primaRiga; riga <= m.ultimaRiga; riga++) {
    const nome = testoCella(ws.getCell(`${m.colonnaAttivita}${riga}`).value);
    if (!nome) continue;
    attivita.push({ nome, riga, unita: sedute.has(riga) ? 'sedute' : 'ore', ordine: attivita.length + 1 });
  }
  return attivita;
}

function verificaNomi(nomi, ammessi, descrizione) {
  const sconosciuti = nomi.filter((n) => !ammessi.has(n));
  if (sconosciuti.length) throw new Error(`${descrizione} sconosciuti: ${sconosciuti.join(', ')}`);
}

async function main() {
  const argomento = process.argv[2];
  if (!argomento) throw new Error('Uso: npm run carica-organizzazione -- <nome cartella in seed>   (es. bv)');
  // Un nome semplice indica una sottocartella di SEED_DIR (in Docker /dati/seed).
  const cartella = /[\\/]/.test(argomento) ? argomento : path.join(process.env.SEED_DIR ?? '/dati/seed', argomento);
  const conf = leggiJson(path.join(cartella, 'organizzazione.json'));
  const contatti = leggiJson(path.join(cartella, 'contatti.json'));
  const abbinamenti = leggiJson(path.join(cartella, 'abbinamenti.json'), false);
  const attivita = await leggiAttivita(cartella, conf);

  const settori = new Set(conf.settori);
  verificaNomi(Object.keys(contatti.responsabili ?? {}), settori, 'Settori in contatti.json');
  if (abbinamenti) {
    verificaNomi(Object.keys(abbinamenti), new Set(attivita.map((a) => a.nome)), 'Attività in abbinamenti.json');
    verificaNomi(Object.values(abbinamenti).flat(), settori, 'Settori in abbinamenti.json');
    const senzaSettore = attivita.filter((a) => !abbinamenti[a.nome]?.length).map((a) => a.nome);
    if (senzaSettore.length) throw new Error(`Attività senza settore in abbinamenti.json: ${senzaSettore.join(', ')}`);
  }

  const pool = creaPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const org = await client.query(
      `INSERT INTO organizations (slug, name, submission_email) VALUES ($1, $2, $3)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, submission_email = EXCLUDED.submission_email
       RETURNING id`,
      [conf.slug, conf.nome, contatti.emailInvio ?? null],
    );
    const orgId = org.rows[0].id;

    const idSettore = new Map();
    for (const [i, nome] of conf.settori.entries()) {
      const r = await client.query(
        `INSERT INTO sectors (organization_id, name, manager_emails, sort_order) VALUES ($1, $2, $3, $4)
         ON CONFLICT (organization_id, name)
         DO UPDATE SET manager_emails = EXCLUDED.manager_emails, sort_order = EXCLUDED.sort_order
         RETURNING id`,
        [orgId, nome, contatti.responsabili?.[nome] ?? [], i + 1],
      );
      idSettore.set(nome, r.rows[0].id);
    }

    // Libera temporaneamente le righe del modello, così un'attività può
    // spostarsi su una riga occupata da un'altra senza violare l'unicità.
    await client.query('UPDATE activities SET template_row = template_row + 100000 WHERE organization_id = $1', [orgId]);
    const idAttivita = new Map();
    for (const a of attivita) {
      const r = await client.query(
        `INSERT INTO activities (organization_id, name, unit, template_row, sort_order) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (organization_id, name)
         DO UPDATE SET unit = EXCLUDED.unit, template_row = EXCLUDED.template_row, sort_order = EXCLUDED.sort_order
         RETURNING id`,
        [orgId, a.nome, a.unita, a.riga, a.ordine],
      );
      idAttivita.set(a.nome, r.rows[0].id);
    }
    const orfane = await client.query(
      'SELECT name FROM activities WHERE organization_id = $1 AND template_row > 100000',
      [orgId],
    );
    if (orfane.rows.length) {
      throw new Error(`Attività presenti nel database ma non più nel modello: ${orfane.rows.map((r) => r.name).join(', ')}`);
    }

    if (abbinamenti) {
      await client.query('DELETE FROM activity_sectors WHERE organization_id = $1', [orgId]);
      for (const [nomeAttivita, nomiSettori] of Object.entries(abbinamenti)) {
        for (const nomeSettore of nomiSettori) {
          await client.query(
            'INSERT INTO activity_sectors (organization_id, activity_id, sector_id) VALUES ($1, $2, $3)',
            [orgId, idAttivita.get(nomeAttivita), idSettore.get(nomeSettore)],
          );
        }
      }
    }
    await client.query('COMMIT');

    const nSedute = attivita.filter((a) => a.unita === 'sedute').length;
    console.log(`Organizzazione "${conf.nome}" (${conf.slug}) caricata.`);
    console.log(`  Settori: ${idSettore.size}`);
    console.log(`  Attività: ${attivita.length} (${attivita.length - nSedute} a ore, ${nSedute} a sedute)`);
    console.log(
      abbinamenti
        ? `  Abbinamenti attività-settori: ${Object.values(abbinamenti).flat().length}`
        : '  Abbinamenti attività-settori NON caricati: manca abbinamenti.json (in attesa di conferma).',
    );
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
