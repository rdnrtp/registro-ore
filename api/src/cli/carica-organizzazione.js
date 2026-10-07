// Crea un'organizzazione a partire da una cartella di configurazione.
// Uso: npm run carica-organizzazione -- bv
// (bv = sottocartella di seed/, montata in Docker su /dati/seed)
//
// Dalla Fase 4 la configurazione si modifica dall'app: su un'organizzazione
// già esistente il comando si rifiuta, per non cancellare le modifiche fatte
// dall'amministratore. Con --sovrascrivi riporta settori, email, abbinamenti,
// nomi/unità/ordine delle attività e modello a quelli dei file (utenti, ore,
// responsabili dei settori rimasti e attività attive o no restano come sono).
//
// La cartella contiene:
//   organizzazione.json  slug, nome, modello Excel ("modello": percorso del file
//                        e mappa delle celle, vedi src/excel/layout.js), righe a
//                        "sedute", elenco dei settori (tracciato)
//   contatti.json        email di invio e dei responsabili (NON tracciato)
//   abbinamenti.json     attività -> settori; se manca gli abbinamenti non
//                        vengono toccati (tracciato, solo dopo conferma)
// Le attività si leggono dal modello Excel. Il modello (file + mappa) viene
// salvato nel database: è quello che l'API usa per generare i file mensili.
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { creaPool } = require('../db');
const { validaLayout, sedutePtPerTipo } = require('../excel/layout');
const {
  leggiRigheAttivita,
  confrontaAttivita,
  provaGenerazione,
  applicaAttivita,
  salvaVersione,
  attivitaEsistenti,
} = require('../excel/modello');
const { traccia } = require('../traccia');

function leggiJson(file, obbligatorio = true) {
  if (!fs.existsSync(file)) {
    if (obbligatorio) throw new Error(`File mancante: ${file}`);
    return null;
  }
  const dati = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete dati._nota;
  return dati;
}

function verificaNomi(nomi, ammessi, descrizione) {
  const sconosciuti = nomi.filter((n) => !ammessi.has(n));
  if (sconosciuti.length) throw new Error(`${descrizione} sconosciuti: ${sconosciuti.join(', ')}`);
}

// L'organizzazione esiste già: senza richiesta esplicita non si tocca.
class ErroreGiaConfigurata extends Error {}

// conf, contatti, abbinamenti: contenuto dei file JSON (abbinamenti può essere null).
// modello: { buffer, nomeFile } = il file Excel del modello.
// sovrascrivi: true per riportare ai file un'organizzazione già esistente.
async function caricaOrganizzazione(pool, { conf, contatti, abbinamenti, modello, sovrascrivi = false }) {
  // eslint-disable-next-line no-unused-vars
  const { file: _file, ...mappa } = conf.modello ?? {};
  const layout = validaLayout(mappa);
  const righe = await leggiRigheAttivita(modello.buffer, layout);
  await provaGenerazione(modello.buffer, layout, righe);
  const sedute = new Set(conf.righeASedute ?? []);
  const unitaPerRiga = (riga) => (sedute.has(riga) ? 'sedute' : 'ore');
  const ordine = new Map(righe.map((r, i) => [r.riga, i + 1]));
  const ptPerTipo = sedutePtPerTipo(layout);

  const settori = new Set(conf.settori);
  verificaNomi(Object.keys(contatti.responsabili ?? {}), settori, 'Settori in contatti.json');
  if (abbinamenti) {
    verificaNomi(Object.keys(abbinamenti), new Set(righe.map((a) => a.etichetta)), 'Attività in abbinamenti.json');
    verificaNomi(Object.values(abbinamenti).flat(), settori, 'Settori in abbinamenti.json');
    const senzaSettore = righe.filter((a) => !abbinamenti[a.etichetta]?.length).map((a) => a.etichetta);
    if (senzaSettore.length) throw new Error(`Attività senza settore in abbinamenti.json: ${senzaSettore.join(', ')}`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const esistente = await client.query('SELECT id FROM organizations WHERE slug = $1 FOR UPDATE', [conf.slug]);
    if (esistente.rows[0] && !sovrascrivi) {
      throw new ErroreGiaConfigurata(
        `L'organizzazione "${conf.slug}" esiste già: la sua configurazione si modifica dall'app ` +
          "(pagine di gestione dell'amministratore) e questo comando cancellerebbe quelle modifiche.\n" +
          'Se vuoi davvero riportarla ai file di seed/ (settori, email, abbinamenti, nomi e unità delle attività, ' +
          'indirizzo di invio e modello), riesegui il comando aggiungendo --sovrascrivi.',
      );
    }
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

    // Attività: stesso confronto del caricamento di un modello dall'app
    // (src/excel/modello.js); nomi, unità e ordine tornano quelli dei file.
    const confronto = confrontaAttivita(await attivitaEsistenti(client, orgId), righe);
    await applicaAttivita(client, orgId, confronto, {
      sovrascrivi: true,
      unitaPerRiga,
      ordinePerRiga: (riga) => ordine.get(riga),
    });
    const idAttivita = new Map((await attivitaEsistenti(client, orgId)).map((a) => [a.etichetta, a.id]));

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

    const versione = await salvaVersione(client, orgId, { buffer: modello.buffer, nomeFile: modello.nomeFile, layout });
    await traccia(client, {
      organizzazioneId: orgId,
      utente: null,
      azione: esistente.rows[0] ? 'organizzazione.sovrascritta_da_terminale' : 'organizzazione.creata_da_terminale',
      dettagli: { slug: conf.slug, versione_modello: versione.versione, file_modello: modello.nomeFile },
    });
    await client.query('COMMIT');

    return {
      orgId,
      settori: idSettore.size,
      settoriRimossi: rimossi.rows.map((r) => r.name),
      attivita: righe.map((r) => ({ nome: r.etichetta, riga: r.riga, unita: unitaPerRiga(r.riga) })),
      rinominate: confronto.rinominate.map((a) => ({ nome: a.nuova.etichetta, riga: a.nuova.riga })),
      ptPerTipo,
      abbinamenti: abbinamenti ? Object.values(abbinamenti).flat().length : null,
      versioneModello: versione.versione,
      modelloNuovo: versione.nuova,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { sovrascrivi: { type: 'boolean', default: false } },
  });
  const argomento = positionals[0];
  if (!argomento || positionals.length > 1) {
    throw new Error('Uso: npm run carica-organizzazione -- <nome cartella in seed> [--sovrascrivi]   (es. bv)');
  }
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
    const r = await caricaOrganizzazione(pool, { conf, contatti, abbinamenti, modello, sovrascrivi: values.sovrascrivi });
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

module.exports = { caricaOrganizzazione, leggiJson, ErroreGiaConfigurata };
