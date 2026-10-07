// Crea o aggiorna un'organizzazione a partire da una cartella di configurazione.
// Uso: npm run carica-organizzazione -- bv
// (bv = sottocartella di seed/, montata in Docker su /dati/seed)
//
// La cartella contiene:
//   organizzazione.json  slug, nome, modello Excel ("modello": percorso del file
//                        e mappa delle celle, vedi src/excel/layout.js), righe a
//                        "sedute", elenco dei settori (tracciato);
//                        i settori del database assenti dall'elenco vengono eliminati
//   contatti.json        email di invio e dei responsabili (NON tracciato)
//   abbinamenti.json     attività -> settori; se manca gli abbinamenti non
//                        vengono toccati (tracciato, solo dopo conferma)
// Le attività si leggono dal modello Excel. Il modello (file + mappa) viene
// salvato nel database: è quello che l'API usa per generare i file mensili.
// Una nuova versione viene creata solo se il file o la mappa sono cambiati.
// Il comando si può rieseguire: aggiorna i dati senza duplicarli.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('exceljs');
const { creaPool } = require('../db');
const { validaLayout, sedutePtPerTipo, testoCella } = require('../excel/layout');
const { generaFoglioMensile } = require('../excel/foglio-mensile');

function leggiJson(file, obbligatorio = true) {
  if (!fs.existsSync(file)) {
    if (obbligatorio) throw new Error(`File mancante: ${file}`);
    return null;
  }
  const dati = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete dati._nota;
  return dati;
}

async function leggiAttivita(buffer, layout, righeASedute) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.getWorksheet(layout.foglio);
  if (!ws) throw new Error(`Foglio "${layout.foglio}" non trovato nel modello`);
  const sedute = new Set(righeASedute ?? []);
  const { colonnaNome, primaRiga, ultimaRiga } = layout.attivita;
  const attivita = [];
  for (let riga = primaRiga; riga <= ultimaRiga; riga++) {
    const nome = testoCella(ws.getCell(`${colonnaNome}${riga}`).value);
    if (!nome) continue;
    attivita.push({ nome, riga, unita: sedute.has(riga) ? 'sedute' : 'ore', ordine: attivita.length + 1 });
  }
  return attivita;
}

function verificaNomi(nomi, ammessi, descrizione) {
  const sconosciuti = nomi.filter((n) => !ammessi.has(n));
  if (sconosciuti.length) throw new Error(`${descrizione} sconosciuti: ${sconosciuti.join(', ')}`);
}

// conf, contatti, abbinamenti: contenuto dei file JSON (abbinamenti può essere null).
// modello: { buffer, nomeFile } = il file Excel del modello.
async function caricaOrganizzazione(pool, { conf, contatti, abbinamenti, modello }) {
  // eslint-disable-next-line no-unused-vars
  const { file: _file, ...mappa } = conf.modello ?? {};
  const layout = validaLayout(mappa);
  const attivita = await leggiAttivita(modello.buffer, layout, conf.righeASedute);
  // Prova di generazione di un mese vuoto: se il modello non si compila con
  // questa mappa è meglio saperlo ora che quando un utente scarica il file.
  await generaFoglioMensile(modello.buffer, layout, {
    anno: 2026,
    mese: 2,
    nome: 'Prova',
    cognome: 'Prova',
    attivita: attivita.map((a) => ({ id: a.nome, nome: a.nome, riga: a.riga })),
    registrazioni: [],
    sedutePt: [],
  });
  const ptPerTipo = sedutePtPerTipo(layout);
  const sha256 = crypto.createHash('sha256').update(modello.buffer).digest('hex');

  const settori = new Set(conf.settori);
  verificaNomi(Object.keys(contatti.responsabili ?? {}), settori, 'Settori in contatti.json');
  if (abbinamenti) {
    verificaNomi(Object.keys(abbinamenti), new Set(attivita.map((a) => a.nome)), 'Attività in abbinamenti.json');
    verificaNomi(Object.values(abbinamenti).flat(), settori, 'Settori in abbinamenti.json');
    const senzaSettore = attivita.filter((a) => !abbinamenti[a.nome]?.length).map((a) => a.nome);
    if (senzaSettore.length) throw new Error(`Attività senza settore in abbinamenti.json: ${senzaSettore.join(', ')}`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const org = await client.query(
      `INSERT INTO organizations (slug, name, submission_email, pt_sessions_per_kind) VALUES ($1, $2, $3, $4)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, submission_email = EXCLUDED.submission_email,
                                        pt_sessions_per_kind = EXCLUDED.pt_sessions_per_kind
       RETURNING id`,
      [conf.slug, conf.nome, contatti.emailInvio ?? null, ptPerTipo],
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
    // I settori non più elencati vanno eliminati, con i loro collegamenti ad
    // attività e responsabili (ON DELETE CASCADE).
    const rimossi = await client.query(
      'DELETE FROM sectors WHERE organization_id = $1 AND name <> ALL($2::text[]) RETURNING name',
      [orgId, conf.settori],
    );

    // Libera temporaneamente le righe del modello, così un'attività può
    // spostarsi su una riga occupata da un'altra senza violare l'unicità.
    await client.query('UPDATE activities SET template_row = template_row + 100000 WHERE organization_id = $1', [orgId]);
    // Rinomina: se nel database la riga è occupata da un nome che non compare
    // più nel modello, è la stessa attività con un nome nuovo. Si aggiorna il
    // nome e l'attività conserva il suo id (e le ore già registrate).
    const nomiModello = attivita.map((a) => a.nome);
    const rinominate = [];
    for (const a of attivita) {
      const r = await client.query(
        `UPDATE activities SET name = $3
          WHERE organization_id = $1 AND template_row = $2 + 100000
            AND name <> ALL($4::text[])
            AND NOT EXISTS (SELECT 1 FROM activities WHERE organization_id = $1 AND name = $3)
          RETURNING name`,
        [orgId, a.riga, a.nome, nomiModello],
      );
      if (r.rows[0]) rinominate.push(a);
    }
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

    // Modello Excel: nuova versione solo se il file o la mappa sono cambiati.
    const ultimo = await client.query(
      `SELECT version, sha256 = $2 AND layout = $3::jsonb AS uguale
         FROM excel_templates WHERE organization_id = $1 ORDER BY version DESC LIMIT 1`,
      [orgId, sha256, JSON.stringify(layout)],
    );
    let versioneModello = ultimo.rows[0]?.version ?? 0;
    const modelloNuovo = !ultimo.rows[0]?.uguale;
    if (modelloNuovo) {
      versioneModello += 1;
      await client.query(
        `INSERT INTO excel_templates (organization_id, version, file, file_name, sha256, layout)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [orgId, versioneModello, modello.buffer, modello.nomeFile, sha256, JSON.stringify(layout)],
      );
    }
    await client.query('COMMIT');

    return {
      orgId,
      settori: idSettore.size,
      settoriRimossi: rimossi.rows.map((r) => r.name),
      attivita,
      rinominate,
      ptPerTipo,
      abbinamenti: abbinamenti ? Object.values(abbinamenti).flat().length : null,
      versioneModello,
      modelloNuovo,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  const argomento = process.argv[2];
  if (!argomento) throw new Error('Uso: npm run carica-organizzazione -- <nome cartella in seed>   (es. bv)');
  // Un nome semplice indica una sottocartella di SEED_DIR (in Docker /dati/seed).
  const cartella = /[\\/]/.test(argomento) ? argomento : path.join(process.env.SEED_DIR ?? '/dati/seed', argomento);
  const conf = leggiJson(path.join(cartella, 'organizzazione.json'));
  const contatti = leggiJson(path.join(cartella, 'contatti.json'));
  const abbinamenti = leggiJson(path.join(cartella, 'abbinamenti.json'), false);
  if (!conf.modello?.file) throw new Error('modello.file mancante in organizzazione.json');
  const fileModello = path.resolve(cartella, conf.modello.file);
  if (!fs.existsSync(fileModello)) throw new Error(`Modello Excel non trovato: ${fileModello}`);
  const modello = { buffer: fs.readFileSync(fileModello), nomeFile: path.basename(fileModello) };

  const pool = creaPool();
  try {
    const r = await caricaOrganizzazione(pool, { conf, contatti, abbinamenti, modello });
    const nSedute = r.attivita.filter((a) => a.unita === 'sedute').length;
    console.log(`Organizzazione "${conf.nome}" (${conf.slug}) caricata.`);
    for (const a of r.rinominate) console.log(`  Rinominata la riga ${a.riga} in "${a.nome}"`);
    console.log(`  Settori: ${r.settori}`);
    for (const nome of r.settoriRimossi) console.log(`  Settore eliminato: "${nome}"`);
    console.log(`  Attività: ${r.attivita.length} (${r.attivita.length - nSedute} a ore, ${nSedute} a sedute)`);
    console.log(`  Sedute di personal training per tipo in un mese: al massimo ${r.ptPerTipo}`);
    console.log(
      r.abbinamenti !== null
        ? `  Abbinamenti attività-settori: ${r.abbinamenti}`
        : '  Abbinamenti attività-settori NON caricati: manca abbinamenti.json (in attesa di conferma).',
    );
    console.log(
      r.modelloNuovo
        ? `  Modello Excel salvato nel database: versione ${r.versioneModello} (${modello.nomeFile})`
        : `  Modello Excel invariato: resta la versione ${r.versioneModello}`,
    );
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}

module.exports = { caricaOrganizzazione, leggiJson };
