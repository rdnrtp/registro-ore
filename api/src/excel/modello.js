// Caricamento di un modello Excel nel database, usato sia dal comando
// carica-organizzazione sia dall'amministratore dall'app (POST /api/modello).
//
// Le attività sono legate alle righe del modello: template_row = riga,
// template_label = testo della riga (il nome mostrato nell'app, name, può
// essere diverso). Un nuovo modello si confronta con le attività esistenti:
//  - stesso testo = stessa attività (anche se ha cambiato riga);
//  - testo nuovo su una riga che era di un'attività il cui testo non c'è più
//    = la stessa attività rinominata nel modello (conserva id e ore);
//  - testo nuovo su una riga libera = attività nuova;
//  - attività il cui testo non c'è più e la cui riga è ora di un'altra o vuota
//    = mancante: il modello viene rifiutato (le sue ore non avrebbero una riga).
const crypto = require('node:crypto');
const ExcelJS = require('exceljs');
const { testoCella, sedutePtPerTipo } = require('./layout');
const { generaFoglioMensile, ErroreModello } = require('./foglio-mensile');

// Il file non va bene per questa mappa: messaggio per l'utente.
class ErroreFileModello extends Error {}

// Righe delle attività scritte nel modello: [{ etichetta, riga }].
async function leggiRigheAttivita(buffer, layout) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw new ErroreFileModello('il file non è un Excel valido (.xlsx)');
  }
  const ws = wb.getWorksheet(layout.foglio);
  if (!ws) throw new ErroreFileModello(`nel file manca il foglio "${layout.foglio}"`);
  const { colonnaNome, primaRiga, ultimaRiga } = layout.attivita;
  const righe = [];
  const visti = new Set();
  for (let riga = primaRiga; riga <= ultimaRiga; riga++) {
    const etichetta = testoCella(ws.getCell(`${colonnaNome}${riga}`).value);
    if (!etichetta) continue;
    if (visti.has(etichetta)) throw new ErroreFileModello(`l'attività "${etichetta}" compare due volte (riga ${riga})`);
    visti.add(etichetta);
    righe.push({ etichetta, riga });
  }
  if (!righe.length) {
    throw new ErroreFileModello(`nessuna attività nella colonna ${colonnaNome}, righe ${primaRiga}-${ultimaRiga}`);
  }
  return righe;
}

// esistenti: [{ id, nome, etichetta, riga }] dal database; righe: dal modello.
function confrontaAttivita(esistenti, righe) {
  const perEtichetta = new Map(righe.map((r) => [r.etichetta, r]));
  const righeUsate = new Set();
  const abbinate = [];
  const restanti = [];
  for (const a of esistenti) {
    const r = perEtichetta.get(a.etichetta);
    if (r) {
      abbinate.push({ ...a, nuova: r });
      righeUsate.add(r.riga);
    } else {
      restanti.push(a);
    }
  }
  const mancanti = [];
  for (const a of restanti) {
    const r = righe.find((x) => x.riga === a.riga && !righeUsate.has(x.riga) && !esistenti.some((e) => e.etichetta === x.etichetta));
    if (r) {
      abbinate.push({ ...a, nuova: r });
      righeUsate.add(r.riga);
    } else {
      mancanti.push(a);
    }
  }
  const nuove = righe.filter((r) => !righeUsate.has(r.riga));
  return {
    abbinate,
    nuove,
    mancanti,
    rinominate: abbinate.filter((a) => a.etichetta !== a.nuova.etichetta),
    spostate: abbinate.filter((a) => a.etichetta === a.nuova.etichetta && a.riga !== a.nuova.riga),
  };
}

// Prova di generazione di un mese con tutte le attività: se il modello non si
// compila con questa mappa è meglio saperlo ora che quando un utente scarica il file.
async function provaGenerazione(buffer, layout, righe) {
  try {
    await generaFoglioMensile(buffer, layout, {
      anno: 2026,
      mese: 2,
      nome: 'Prova',
      cognome: 'Prova',
      attivita: righe.map((r) => ({ id: r.etichetta, nome: r.etichetta, riga: r.riga })),
      registrazioni: righe.map((r) => ({ giorno: 1, attivita_id: r.etichetta, quantita: 1 })),
      sedutePt: [
        { giorno: 1, tipo: 'palestra', cliente: 'Prova' },
        { giorno: 1, tipo: 'acqua', cliente: 'Prova' },
      ],
    });
  } catch (err) {
    if (err instanceof ErroreModello) throw new ErroreFileModello(`la prova di generazione non riesce: ${err.message}`);
    throw new ErroreFileModello(`la prova di generazione non riesce (${err.message})`);
  }
}

const descriviMancanti = (mancanti) =>
  mancanti.map((a) => `"${a.etichetta}" (era alla riga ${a.riga})`).join(', ');

// Applica il confronto alle attività dell'organizzazione.
// opzioni.sovrascrivi (solo dal comando): nome nell'app, unità e ordine
//   tornano quelli dei file di configurazione (unitaPerRiga, ordinePerRiga).
// Senza sovrascrivi il nome nell'app segue il modello solo se non era stato
// cambiato (era uguale al testo della riga).
async function applicaAttivita(client, orgId, confronto, { sovrascrivi = false, unitaPerRiga = () => 'ore', ordinePerRiga } = {}) {
  if (confronto.mancanti.length) {
    throw new ErroreFileModello(
      `nel nuovo modello mancano attività che esistono nell'app: ${descriviMancanti(confronto.mancanti)}`,
    );
  }
  // Libera temporaneamente righe ed etichette, così le attività possono
  // scambiarsi riga o testo senza violare i vincoli di unicità.
  await client.query(
    `UPDATE activities SET template_row = template_row + 100000, template_label = id::text
      ${sovrascrivi ? ', name = id::text' : ''}
      WHERE organization_id = $1`,
    [orgId],
  );
  for (const a of confronto.abbinate) {
    const seguiModello = sovrascrivi || a.nome === a.etichetta;
    const params = [a.id, orgId, a.nuova.riga, a.nuova.etichetta];
    if (sovrascrivi) {
      await client.query(
        `UPDATE activities SET template_row = $3, template_label = $4, name = $4, unit = $5, sort_order = $6
          WHERE id = $1 AND organization_id = $2`,
        [...params, unitaPerRiga(a.nuova.riga), ordinePerRiga(a.nuova.riga)],
      );
    } else {
      await client.query('UPDATE activities SET template_row = $3, template_label = $4 WHERE id = $1 AND organization_id = $2', params);
      // Il nome nell'app segue il modello, se nessun'altra attività lo usa già.
      if (seguiModello && a.nome !== a.nuova.etichetta) {
        await client.query(
          `UPDATE activities SET name = $3 WHERE id = $1 AND organization_id = $2
              AND NOT EXISTS (SELECT 1 FROM activities WHERE organization_id = $2 AND name = $3)`,
          [a.id, orgId, a.nuova.etichetta],
        );
      }
    }
  }
  for (const r of confronto.nuove) {
    const doppio = await client.query('SELECT 1 FROM activities WHERE organization_id = $1 AND name = $2', [orgId, r.etichetta]);
    if (doppio.rows[0]) {
      throw new ErroreFileModello(
        `la riga ${r.riga} del modello ("${r.etichetta}") è nuova, ma nell'app un'altra attività ha già questo nome: rinominala prima`,
      );
    }
    await client.query(
      `INSERT INTO activities (organization_id, name, template_label, unit, template_row, sort_order)
       VALUES ($1, $2, $2, $3, $4, COALESCE($5, (SELECT COALESCE(max(sort_order), 0) + 1 FROM activities WHERE organization_id = $1)))`,
      [orgId, r.etichetta, unitaPerRiga(r.riga), r.riga, ordinePerRiga ? ordinePerRiga(r.riga) : null],
    );
  }
}

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

// Salva il modello come nuova versione, solo se file o mappa sono cambiati.
// Aggiorna anche il numero di sedute PT per tipo, che dipende dalla mappa.
async function salvaVersione(client, orgId, { buffer, nomeFile, layout }) {
  const impronta = sha256(buffer);
  const ultimo = await client.query(
    `SELECT version, sha256 = $2 AND layout = $3::jsonb AS uguale
       FROM excel_templates WHERE organization_id = $1 ORDER BY version DESC LIMIT 1`,
    [orgId, impronta, JSON.stringify(layout)],
  );
  let versione = ultimo.rows[0]?.version ?? 0;
  const nuova = !ultimo.rows[0]?.uguale;
  if (nuova) {
    versione += 1;
    await client.query(
      `INSERT INTO excel_templates (organization_id, version, file, file_name, sha256, layout)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [orgId, versione, buffer, nomeFile, impronta, JSON.stringify(layout)],
    );
  }
  await client.query('UPDATE organizations SET pt_sessions_per_kind = $2 WHERE id = $1', [orgId, sedutePtPerTipo(layout)]);
  return { versione, nuova, sha256: impronta };
}

async function attivitaEsistenti(db, orgId) {
  const { rows } = await db.query(
    `SELECT id, name AS nome, template_label AS etichetta, template_row AS riga
       FROM activities WHERE organization_id = $1 ORDER BY template_row`,
    [orgId],
  );
  return rows;
}

// Riassunto del confronto per l'utente.
function riassunto(confronto) {
  return {
    rinominate: confronto.rinominate.map((a) => ({ riga: a.nuova.riga, prima: a.etichetta, dopo: a.nuova.etichetta, nome_app: a.nome })),
    spostate: confronto.spostate.map((a) => ({ nome: a.etichetta, prima: a.riga, dopo: a.nuova.riga })),
    nuove: confronto.nuove.map((r) => ({ riga: r.riga, nome: r.etichetta })),
    mancanti: confronto.mancanti.map((a) => ({ riga: a.riga, nome: a.etichetta })),
  };
}

module.exports = {
  ErroreFileModello,
  leggiRigheAttivita,
  confrontaAttivita,
  provaGenerazione,
  applicaAttivita,
  salvaVersione,
  attivitaEsistenti,
  riassunto,
  descriviMancanti,
  sha256,
};
