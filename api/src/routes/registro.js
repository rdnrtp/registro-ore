const express = require('express');
const { transazione } = require('../db');
const { ErroreHttp } = require('../errori');
const { NOMI_MESI, isUuid, giorniNelMese, leggiAnnoMese, leggiData, numeroIt } = require('../validazione');

const MAX_ORE_GIORNO = 24;
const TIPI_PT = ['acqua', 'palestra'];
const MAX_LUNGHEZZA_CLIENTE = 100;

// Registrazioni personali: ore, orario tipo, "le mie attività" e sedute di
// personal training. Ogni utente legge e modifica solo i propri dati, anche se
// è amministratore: l'utente è sempre req.utente.id, mai un valore della
// richiesta. Le viste in sola lettura sui dati degli altri sono in collaboratori.js.
function rotteRegistro({ pool, config }) {
  const router = express.Router();

  const nonValido = (messaggio) => new ErroreHttp(400, messaggio);
  const attivitaNonTrovata = () => new ErroreHttp(404, 'Attività non trovata');

  function annoMeseDaParametri(params) {
    const am = leggiAnnoMese(params.anno, params.mese);
    if (!am) throw nonValido('Mese non valido');
    return am;
  }

  function dataDa(valore) {
    const data = leggiData(valore);
    if (!data) throw nonValido('Data non valida');
    return data;
  }

  // Blocca la riga dell'utente fino alla fine della transazione: le modifiche
  // dello stesso utente vengono eseguite una alla volta, così i controlli sul
  // totale del giorno, sul limite delle sedute e sul mese inviato non possono
  // essere aggirati da richieste contemporanee.
  async function bloccaUtente(client, utente) {
    const { rows } = await client.query(
      'SELECT 1 FROM users WHERE id = $1 AND organization_id = $2 AND active FOR NO KEY UPDATE',
      [utente.id, utente.organizzazioneId],
    );
    if (!rows[0]) throw new ErroreHttp(401, 'Utente non più attivo');
  }

  async function statoMese(db, utente, anno, mese) {
    const { rows } = await db.query(
      `SELECT status FROM month_submissions
        WHERE user_id = $1 AND organization_id = $2 AND year = $3 AND month = $4`,
      [utente.id, utente.organizzazioneId, anno, mese],
    );
    return rows[0]?.status ?? 'aperto';
  }

  async function verificaMeseAperto(client, utente, anno, mese) {
    if ((await statoMese(client, utente, anno, mese)) === 'inviato') {
      throw new ErroreHttp(
        409,
        `Il mese di ${NOMI_MESI[mese - 1]} ${anno} è già stato inviato: registrazioni e sedute sono in sola lettura.`,
      );
    }
  }

  // Attività dell'organizzazione indicate per id: Map id -> { nome, unita, attiva }.
  // Un id inesistente o di un'altra organizzazione risponde 404.
  async function caricaAttivita(db, utente, ids) {
    if (!ids.every(isUuid)) throw attivitaNonTrovata();
    const { rows } = await db.query(
      `SELECT id, name AS nome, unit AS unita, active AS attiva
         FROM activities WHERE organization_id = $1 AND id = ANY($2::uuid[])`,
      [utente.organizzazioneId, ids],
    );
    const mappa = new Map(rows.map((r) => [r.id, r]));
    if (ids.some((id) => !mappa.has(id))) throw attivitaNonTrovata();
    return mappa;
  }

  // Quantità ammessa: da 0 a 24, a passi di 0,5 per le ore e intera per le sedute.
  function verificaQuantita(quantita, attivita) {
    if (typeof quantita !== 'number' || !Number.isFinite(quantita) || quantita < 0 || quantita > MAX_ORE_GIORNO) {
      throw nonValido(`Quantità non valida per "${attivita.nome}"`);
    }
    if (attivita.unita === 'ore' && !Number.isInteger(quantita * 2)) {
      throw nonValido(`Le ore vanno indicate a passi di mezz'ora ("${attivita.nome}")`);
    }
    if (attivita.unita === 'sedute' && !Number.isInteger(quantita)) {
      throw nonValido(`Le sedute devono essere un numero intero ("${attivita.nome}")`);
    }
  }

  function verificaTotaleOre(totale, dove) {
    if (totale > MAX_ORE_GIORNO) {
      throw nonValido(`Non si possono registrare più di ${MAX_ORE_GIORNO} ore in un giorno (${dove}: ${numeroIt(totale)} ore)`);
    }
  }

  function leggiElenco(valore, massimo) {
    if (!Array.isArray(valore) || valore.length > massimo) throw nonValido('Richiesta non valida');
    if (!valore.every((v) => v && typeof v === 'object')) throw nonValido('Richiesta non valida');
    return valore;
  }

  const SELECT_REGISTRAZIONI = `
    SELECT entry_date AS data, activity_id AS attivita_id, quantity AS quantita
      FROM time_entries WHERE user_id = $1 AND organization_id = $2`;

  // ---------------------------------------------------------------- Mese

  router.get('/mese/:anno/:mese', async (req, res) => {
    const { anno, mese } = annoMeseDaParametri(req.params);
    const u = req.utente;
    const periodo = `AND $3::date <= %s AND %s < ($3::date + interval '1 month')`;
    const inizio = `${anno}-${String(mese).padStart(2, '0')}-01`;
    const [registrazioni, sedute, stato, org] = await Promise.all([
      pool.query(`${SELECT_REGISTRAZIONI} ${periodo.replaceAll('%s', 'entry_date')} ORDER BY entry_date`, [
        u.id,
        u.organizzazioneId,
        inizio,
      ]),
      pool.query(
        `SELECT id, session_date AS data, kind AS tipo, client_name AS cliente
           FROM pt_sessions WHERE user_id = $1 AND organization_id = $2
           ${periodo.replaceAll('%s', 'session_date')}
          ORDER BY session_date, created_at`,
        [u.id, u.organizzazioneId, inizio],
      ),
      statoMese(pool, u, anno, mese),
      pool.query('SELECT pt_sessions_per_kind FROM organizations WHERE id = $1', [u.organizzazioneId]),
    ]);
    res.json({
      anno,
      mese,
      stato,
      max_sedute_pt_per_tipo: org.rows[0]?.pt_sessions_per_kind,
      registrazioni: registrazioni.rows,
      sedute_pt: sedute.rows,
    });
  });

  // Imposta le quantità di un giorno per le attività indicate; le altre
  // attività del giorno restano come sono. Quantità 0 = elimina la riga.
  // Corpo: { voci: [{ attivita_id, quantita }] }
  router.put('/giorni/:data', async (req, res) => {
    const data = dataDa(req.params.data);
    const voci = leggiElenco(req.body?.voci, 100);
    if (!voci.length) throw nonValido('Nessuna quantità da salvare');
    const ids = voci.map((v) => v.attivita_id);
    if (new Set(ids).size !== ids.length) throw nonValido('Un\'attività compare più volte');
    const u = req.utente;

    const righe = await transazione(pool, async (client) => {
      await bloccaUtente(client, u);
      await verificaMeseAperto(client, u, data.anno, data.mese);
      const attivita = await caricaAttivita(client, u, ids);
      for (const v of voci) verificaQuantita(v.quantita, attivita.get(v.attivita_id));

      for (const v of voci) {
        const a = attivita.get(v.attivita_id);
        if (v.quantita === 0) {
          await client.query(
            `DELETE FROM time_entries
              WHERE user_id = $1 AND organization_id = $2 AND entry_date = $3 AND activity_id = $4`,
            [u.id, u.organizzazioneId, data.testo, v.attivita_id],
          );
          continue;
        }
        // Un'attività disattivata non accetta nuove righe; quelle già presenti
        // si possono ancora correggere o togliere.
        const r = await client.query(
          `UPDATE time_entries SET quantity = $5, updated_at = now()
            WHERE user_id = $1 AND organization_id = $2 AND entry_date = $3 AND activity_id = $4`,
          [u.id, u.organizzazioneId, data.testo, v.attivita_id, v.quantita],
        );
        if (r.rowCount) continue;
        if (!a.attiva) throw nonValido(`L'attività "${a.nome}" non è più in uso`);
        await client.query(
          `INSERT INTO time_entries (organization_id, user_id, activity_id, entry_date, quantity)
           VALUES ($1, $2, $3, $4, $5)`,
          [u.organizzazioneId, u.id, v.attivita_id, data.testo, v.quantita],
        );
      }

      const totale = await client.query(
        `SELECT COALESCE(sum(t.quantity), 0) AS ore
           FROM time_entries t JOIN activities a ON a.id = t.activity_id AND a.organization_id = t.organization_id
          WHERE t.user_id = $1 AND t.organization_id = $2 AND t.entry_date = $3 AND a.unit = 'ore'`,
        [u.id, u.organizzazioneId, data.testo],
      );
      verificaTotaleOre(totale.rows[0].ore, 'in questo giorno');

      const giorno = await client.query(`${SELECT_REGISTRAZIONI} AND entry_date = $3`, [
        u.id,
        u.organizzazioneId,
        data.testo,
      ]);
      return giorno.rows;
    });
    res.json({ data: data.testo, registrazioni: righe });
  });

  // ------------------------------------------------------ Precompilazione

  // Giorni del mese senza alcuna registrazione per i quali l'orario tipo
  // prevede almeno un'attività (in uso). Sono gli unici che la
  // precompilazione riempie: i giorni già compilati non vengono mai toccati.
  const GIORNI_DA_RIEMPIRE = `
    WITH giorni AS (
      SELECT make_date($3::int, $4::int, 1) + g AS giorno FROM generate_series(0, $5::int - 1) AS g
    )
    SELECT g.giorno, s.activity_id, s.quantity
      FROM giorni g
      JOIN schedule_templates s
        ON s.user_id = $1 AND s.organization_id = $2 AND s.weekday = EXTRACT(ISODOW FROM g.giorno)
      JOIN activities a ON a.id = s.activity_id AND a.organization_id = s.organization_id AND a.active
     WHERE NOT EXISTS (
       SELECT 1 FROM time_entries t WHERE t.user_id = $1 AND t.organization_id = $2 AND t.entry_date = g.giorno
     )`;

  const parametriPrecompilazione = (u, anno, mese) => [u.id, u.organizzazioneId, anno, mese, giorniNelMese(anno, mese)];
  const dateDistinte = (righe) => [...new Set(righe.map((r) => r.giorno))].sort();

  router.get('/mese/:anno/:mese/precompilazione', async (req, res) => {
    const { anno, mese } = annoMeseDaParametri(req.params);
    const { rows } = await pool.query(GIORNI_DA_RIEMPIRE, parametriPrecompilazione(req.utente, anno, mese));
    res.json({ giorni: dateDistinte(rows) });
  });

  router.post('/mese/:anno/:mese/precompilazione', async (req, res) => {
    const { anno, mese } = annoMeseDaParametri(req.params);
    const u = req.utente;
    const giorni = await transazione(pool, async (client) => {
      await bloccaUtente(client, u);
      await verificaMeseAperto(client, u, anno, mese);
      const { rows } = await client.query(
        `INSERT INTO time_entries (organization_id, user_id, activity_id, entry_date, quantity)
         SELECT $2, $1, activity_id, giorno, quantity FROM (${GIORNI_DA_RIEMPIRE}) da_riempire
         RETURNING entry_date AS giorno`,
        parametriPrecompilazione(u, anno, mese),
      );
      return dateDistinte(rows);
    });
    res.json({ giorni_riempiti: giorni });
  });

  // ------------------------------------------------------- Orario tipo

  router.get('/orario-tipo', async (req, res) => {
    const { rows } = await pool.query(
      `SELECT weekday AS giorno_settimana, activity_id AS attivita_id, quantity AS quantita
         FROM schedule_templates WHERE user_id = $1 AND organization_id = $2
        ORDER BY weekday`,
      [req.utente.id, req.utente.organizzazioneId],
    );
    res.json({ voci: rows });
  });

  // Sostituisce l'intero orario tipo dell'utente.
  // Corpo: { voci: [{ giorno_settimana: 1..7, attivita_id, quantita }] }
  router.put('/orario-tipo', async (req, res) => {
    const voci = leggiElenco(req.body?.voci, 7 * 50).filter((v) => v.quantita !== 0);
    const chiavi = new Set();
    for (const v of voci) {
      if (!Number.isInteger(v.giorno_settimana) || v.giorno_settimana < 1 || v.giorno_settimana > 7) {
        throw nonValido('Giorno della settimana non valido');
      }
      const chiave = `${v.giorno_settimana}|${v.attivita_id}`;
      if (chiavi.has(chiave)) throw nonValido('Un\'attività compare più volte nello stesso giorno');
      chiavi.add(chiave);
    }
    const u = req.utente;
    await transazione(pool, async (client) => {
      await bloccaUtente(client, u);
      const attivita = await caricaAttivita(client, u, [...new Set(voci.map((v) => v.attivita_id))]);
      const orePerGiorno = new Map();
      for (const v of voci) {
        const a = attivita.get(v.attivita_id);
        verificaQuantita(v.quantita, a);
        if (!a.attiva) throw nonValido(`L'attività "${a.nome}" non è più in uso`);
        if (a.unita === 'ore') orePerGiorno.set(v.giorno_settimana, (orePerGiorno.get(v.giorno_settimana) ?? 0) + v.quantita);
      }
      for (const [giorno, ore] of orePerGiorno) verificaTotaleOre(ore, `giorno ${giorno} della settimana`);

      await client.query('DELETE FROM schedule_templates WHERE user_id = $1 AND organization_id = $2', [
        u.id,
        u.organizzazioneId,
      ]);
      for (const v of voci) {
        await client.query(
          `INSERT INTO schedule_templates (organization_id, user_id, weekday, activity_id, quantity)
           VALUES ($1, $2, $3, $4, $5)`,
          [u.organizzazioneId, u.id, v.giorno_settimana, v.attivita_id, v.quantita],
        );
      }
    });
    res.json({ ok: true });
  });

  // ---------------------------------------------------- Le mie attività

  router.get('/mie-attivita', async (req, res) => {
    const { rows } = await pool.query(
      `SELECT x.activity_id FROM user_activities x
         JOIN activities a ON a.id = x.activity_id AND a.organization_id = x.organization_id
        WHERE x.user_id = $1 AND x.organization_id = $2
        ORDER BY a.sort_order`,
      [req.utente.id, req.utente.organizzazioneId],
    );
    res.json({ attivita: rows.map((r) => r.activity_id) });
  });

  // Sostituisce l'elenco. Corpo: { attivita: [id, ...] }
  router.put('/mie-attivita', async (req, res) => {
    const ids = req.body?.attivita;
    if (!Array.isArray(ids) || ids.length > 200) throw nonValido('Richiesta non valida');
    const unici = [...new Set(ids)];
    const u = req.utente;
    await transazione(pool, async (client) => {
      await bloccaUtente(client, u);
      await caricaAttivita(client, u, unici);
      await client.query('DELETE FROM user_activities WHERE user_id = $1 AND organization_id = $2', [
        u.id,
        u.organizzazioneId,
      ]);
      await client.query(
        `INSERT INTO user_activities (organization_id, user_id, activity_id)
         SELECT $1, $2, unnest($3::uuid[])`,
        [u.organizzazioneId, u.id, unici],
      );
    });
    res.json({ attivita: unici });
  });

  // ------------------------------------------- Sedute di personal training

  // Indipendenti dalle quantità delle righe "PT …" della griglia: per ora non
  // sono collegate (da chiarire con l'impianto come vanno conteggiate).

  // Corpo { data, tipo: 'acqua' | 'palestra', cliente } controllato.
  function leggiSeduta(corpo) {
    const data = dataDa(corpo?.data);
    const tipo = corpo?.tipo;
    if (!TIPI_PT.includes(tipo)) throw nonValido('Tipo di seduta non valido: acqua o palestra');
    const cliente = typeof corpo?.cliente === 'string' ? corpo.cliente.trim().replace(/\s+/g, ' ') : '';
    if (!cliente) throw nonValido('Indica il nome del cliente');
    if (cliente.length > MAX_LUNGHEZZA_CLIENTE) throw nonValido(`Nome del cliente troppo lungo (al massimo ${MAX_LUNGHEZZA_CLIENTE} caratteri)`);
    return { data, tipo, cliente };
  }

  // Il modello Excel ha un numero fisso di righe per tipo: oltre non si va.
  // tranneId = seduta da non contare (quella che si sta modificando).
  async function verificaPostoSedute(client, u, { data, tipo }, tranneId = null) {
    const { rows } = await client.query(
      `SELECT o.pt_sessions_per_kind AS massimo,
              (SELECT count(*)::int FROM pt_sessions p
                WHERE p.user_id = $1 AND p.organization_id = o.id AND p.kind = $3
                  AND p.session_date >= make_date($4, $5, 1)
                  AND p.session_date < make_date($4, $5, 1) + interval '1 month'
                  AND p.id IS DISTINCT FROM $6) AS presenti
         FROM organizations o WHERE o.id = $2`,
      [u.id, u.organizzazioneId, tipo, data.anno, data.mese, tranneId],
    );
    const { massimo, presenti } = rows[0];
    if (presenti >= massimo) {
      throw nonValido(
        `Hai già ${presenti} sedute di personal training in ${tipo} a ${NOMI_MESI[data.mese - 1]} ${data.anno}: ` +
          `il modello Excel ha spazio per ${massimo} sedute per tipo in un mese, quindi non se ne possono aggiungere altre.`,
      );
    }
  }

  const COLONNE_SEDUTA = 'id, session_date AS data, kind AS tipo, client_name AS cliente';

  router.post('/sedute-pt', async (req, res) => {
    const nuova = leggiSeduta(req.body);
    const u = req.utente;
    const seduta = await transazione(pool, async (client) => {
      await bloccaUtente(client, u);
      await verificaMeseAperto(client, u, nuova.data.anno, nuova.data.mese);
      await verificaPostoSedute(client, u, nuova);
      const { rows } = await client.query(
        `INSERT INTO pt_sessions (organization_id, user_id, session_date, kind, client_name)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${COLONNE_SEDUTA}`,
        [u.organizzazioneId, u.id, nuova.data.testo, nuova.tipo, nuova.cliente],
      );
      return rows[0];
    });
    res.status(201).json(seduta);
  });

  const sedutaNonTrovata = () => new ErroreHttp(404, 'Non trovato');

  // Seduta dell'utente con anno e mese, oppure 404.
  async function leggiSedutaPropria(client, u, id) {
    if (!isUuid(id)) throw sedutaNonTrovata();
    const { rows } = await client.query(
      `SELECT EXTRACT(YEAR FROM session_date)::int AS anno, EXTRACT(MONTH FROM session_date)::int AS mese
         FROM pt_sessions WHERE id = $1 AND user_id = $2 AND organization_id = $3`,
      [id, u.id, u.organizzazioneId],
    );
    if (!rows[0]) throw sedutaNonTrovata();
    return rows[0];
  }

  // Modifica data, tipo o cliente. Corpo: { data, tipo, cliente }.
  // Sia il mese di partenza sia quello di arrivo devono essere aperti.
  router.put('/sedute-pt/:id', async (req, res) => {
    const u = req.utente;
    if (!isUuid(req.params.id)) throw sedutaNonTrovata();
    const nuova = leggiSeduta(req.body);
    const seduta = await transazione(pool, async (client) => {
      await bloccaUtente(client, u);
      const prima = await leggiSedutaPropria(client, u, req.params.id);
      await verificaMeseAperto(client, u, prima.anno, prima.mese);
      await verificaMeseAperto(client, u, nuova.data.anno, nuova.data.mese);
      await verificaPostoSedute(client, u, nuova, req.params.id);
      const { rows } = await client.query(
        `UPDATE pt_sessions SET session_date = $4, kind = $5, client_name = $6
          WHERE id = $1 AND user_id = $2 AND organization_id = $3
          RETURNING ${COLONNE_SEDUTA}`,
        [req.params.id, u.id, u.organizzazioneId, nuova.data.testo, nuova.tipo, nuova.cliente],
      );
      return rows[0];
    });
    res.json(seduta);
  });

  router.delete('/sedute-pt/:id', async (req, res) => {
    const u = req.utente;
    await transazione(pool, async (client) => {
      await bloccaUtente(client, u);
      const s = await leggiSedutaPropria(client, u, req.params.id);
      await verificaMeseAperto(client, u, s.anno, s.mese);
      await client.query('DELETE FROM pt_sessions WHERE id = $1 AND user_id = $2 AND organization_id = $3', [
        req.params.id,
        u.id,
        u.organizzazioneId,
      ]);
    });
    res.json({ ok: true });
  });

  return router;
}

module.exports = { rotteRegistro };
