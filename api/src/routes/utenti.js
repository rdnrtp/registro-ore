const express = require('express');
const { RUOLI, richiediRuolo } = require('../auth');
const { transazione } = require('../db');
const { ErroreHttp } = require('../errori');
const { creaInvito, accodaEmailInvito } = require('../inviti');
const { traccia, differenze } = require('../traccia');
const { isUuid, leggiTesto, leggiEmail } = require('../validazione');

// Gestione degli utenti dell'organizzazione, solo per l'amministratore.
// Nessuna rotta imposta o mostra una password: l'utente la sceglie dal link
// di invito, che si vede una volta sola alla creazione.
function rotteUtenti({ pool, config }) {
  const router = express.Router();
  router.use('/utenti', richiediRuolo('amministratore'));

  const nonTrovato = () => new ErroreHttp(404, 'Non trovato');
  const nonValido = (messaggio) => new ErroreHttp(400, messaggio);

  const SELECT_UTENTE = `
    SELECT u.id, u.email, u.first_name AS nome, u.last_name AS cognome, u.role AS ruolo, u.active AS attivo,
           u.password_hash IS NOT NULL AS password_impostata, u.submission_exempt AS esonerato_invio,
           COALESCE((SELECT array_agg(m.sector_id ORDER BY s.sort_order, s.name)
                       FROM sector_managers m
                       JOIN sectors s ON s.id = m.sector_id AND s.organization_id = m.organization_id
                      WHERE m.user_id = u.id AND m.organization_id = u.organization_id), '{}') AS settori,
           (SELECT max(i.expires_at) FROM user_invites i
             WHERE i.user_id = u.id AND i.organization_id = u.organization_id
               AND i.used_at IS NULL AND i.expires_at > now()) AS invito_scadenza
      FROM users u WHERE u.organization_id = $1`;

  async function leggiUtente(db, orgId, id) {
    const { rows } = await db.query(`${SELECT_UTENTE} AND u.id = $2`, [orgId, id]);
    return rows[0];
  }

  // Le modifiche agli utenti di un'organizzazione vanno in fila (blocco sulla
  // riga dell'organizzazione): due amministratori che si tolgono il ruolo a
  // vicenda nello stesso istante non possono lasciarla senza amministratori.
  const bloccaOrganizzazione = (client, orgId) =>
    client.query('SELECT 1 FROM organizations WHERE id = $1 FOR UPDATE', [orgId]);

  // Settori indicati per id: tutti dell'organizzazione, altrimenti 400.
  // Restituisce i nomi, per la traccia.
  async function verificaSettori(db, orgId, ids) {
    if (!Array.isArray(ids) || ids.length > 100 || !ids.every(isUuid)) throw nonValido('Settori non validi');
    const unici = [...new Set(ids)];
    const { rows } = await db.query(
      'SELECT id, name FROM sectors WHERE organization_id = $1 AND id = ANY($2::uuid[]) ORDER BY sort_order, name',
      [orgId, unici],
    );
    if (rows.length !== unici.length) throw nonValido('Settore non trovato');
    return { ids: unici, nomi: rows.map((r) => r.name) };
  }

  async function impostaSettori(db, orgId, utenteId, ids) {
    await db.query('DELETE FROM sector_managers WHERE user_id = $1 AND organization_id = $2', [utenteId, orgId]);
    await db.query(
      'INSERT INTO sector_managers (organization_id, sector_id, user_id) SELECT $1, unnest($2::uuid[]), $3',
      [orgId, ids, utenteId],
    );
  }

  async function nomiSettori(db, orgId, ids) {
    const { rows } = await db.query(
      'SELECT name FROM sectors WHERE organization_id = $1 AND id = ANY($2::uuid[]) ORDER BY sort_order, name',
      [orgId, ids],
    );
    return rows.map((r) => r.name);
  }

  // Booleano facoltativo: undefined se assente, 400 se non è true o false.
  function leggiBooleano(valore, campo) {
    if (valore !== undefined && typeof valore !== 'boolean') throw nonValido(`Valore di "${campo}" non valido`);
    return valore;
  }

  function leggiRuolo(valore) {
    if (!RUOLI.includes(valore)) throw nonValido('Ruolo non valido: collaboratore, responsabile o amministratore');
    return valore;
  }

  async function emailLibera(db, email, tranneId = null) {
    const { rows } = await db.query('SELECT 1 FROM users WHERE email = $1 AND id IS DISTINCT FROM $2', [email, tranneId]);
    if (rows[0]) throw new ErroreHttp(409, `Esiste già un utente con l'email ${email}`);
  }

  router.get('/utenti', async (req, res) => {
    const { rows } = await pool.query(`${SELECT_UTENTE} ORDER BY u.last_name, u.first_name`, [req.utente.organizzazioneId]);
    res.json(rows);
  });

  router.get('/utenti/:id', async (req, res) => {
    if (!isUuid(req.params.id)) throw nonTrovato();
    const u = await leggiUtente(pool, req.utente.organizzazioneId, req.params.id);
    if (!u) throw nonTrovato();
    res.json(u);
  });

  // Crea l'utente senza password e restituisce il link di invito.
  // Corpo: { nome, cognome, email, ruolo, settori: [id], esonerato_invio? } (settori solo per il responsabile)
  // Il link viene anche mandato per email all'interessato.
  router.post('/utenti', async (req, res) => {
    const b = req.body ?? {};
    const nome = leggiTesto(b.nome, 'Nome', 100);
    const cognome = leggiTesto(b.cognome, 'Cognome', 100);
    const email = leggiEmail(b.email);
    const ruolo = leggiRuolo(b.ruolo);
    const esonerato = leggiBooleano(b.esonerato_invio, 'esonerato_invio') ?? false;
    const org = req.utente.organizzazioneId;

    const risultato = await transazione(pool, async (client) => {
      await bloccaOrganizzazione(client, org);
      await emailLibera(client, email);
      const settori = ruolo === 'responsabile' ? await verificaSettori(client, org, b.settori ?? []) : { ids: [], nomi: [] };
      const { rows } = await client.query(
        `INSERT INTO users (organization_id, email, first_name, last_name, role, submission_exempt)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [org, email, nome, cognome, ruolo, esonerato],
      );
      const id = rows[0].id;
      await impostaSettori(client, org, id, settori.ids);
      const invito = await creaInvito(client, {
        organizzazioneId: org,
        utenteId: id,
        creatoDa: req.utente.id,
        durataOre: config.invitoDurataOre,
      });
      invito.email = email;
      await accodaEmailInvito(client, config, { organizzazioneId: org, utente: { id, email, nome }, invito, reimposta: false });
      await traccia(client, {
        organizzazioneId: org,
        utente: req.utente,
        azione: 'utente.creato',
        tipo: 'utente',
        id,
        dettagli: { email, nome, cognome, ruolo, settori: settori.nomi, ...(esonerato && { esonerato_invio: true }) },
      });
      return { utente: await leggiUtente(client, org, id), invito };
    });
    res.status(201).json(risultato);
  });

  // Modifica anagrafica, ruolo, settori, stato attivo. Tutti i campi sono facoltativi.
  // Corpo: { nome?, cognome?, email?, ruolo?, settori?, attivo?, esonerato_invio? }
  // esonerato_invio = non deve inviare il mese (fuori dal quadro degli invii e dai promemoria).
  router.patch('/utenti/:id', async (req, res) => {
    if (!isUuid(req.params.id)) throw nonTrovato();
    const b = req.body ?? {};
    const org = req.utente.organizzazioneId;
    const id = req.params.id;
    leggiBooleano(b.attivo, 'attivo');
    leggiBooleano(b.esonerato_invio, 'esonerato_invio');

    const aggiornato = await transazione(pool, async (client) => {
      await bloccaOrganizzazione(client, org);
      const prima = await leggiUtente(client, org, id);
      if (!prima) throw nonTrovato();
      const dopo = {
        nome: b.nome === undefined ? prima.nome : leggiTesto(b.nome, 'Nome', 100),
        cognome: b.cognome === undefined ? prima.cognome : leggiTesto(b.cognome, 'Cognome', 100),
        email: b.email === undefined ? prima.email : leggiEmail(b.email),
        ruolo: b.ruolo === undefined ? prima.ruolo : leggiRuolo(b.ruolo),
        attivo: b.attivo ?? prima.attivo,
        esonerato_invio: b.esonerato_invio ?? prima.esonerato_invio,
      };
      if (dopo.email !== prima.email) await emailLibera(client, dopo.email, id);
      // I settori contano solo per il responsabile: con un altro ruolo si tolgono.
      let settori = prima.settori;
      if (dopo.ruolo !== 'responsabile') settori = [];
      else if (b.settori !== undefined) settori = (await verificaSettori(client, org, b.settori)).ids;

      if (id === req.utente.id && !dopo.attivo) throw new ErroreHttp(409, 'Non puoi disattivare il tuo account.');
      const eraAdmin = prima.ruolo === 'amministratore' && prima.attivo;
      const restaAdmin = dopo.ruolo === 'amministratore' && dopo.attivo;
      if (eraAdmin && !restaAdmin) {
        const { rows } = await client.query(
          `SELECT count(*)::int AS n FROM users
            WHERE organization_id = $1 AND role = 'amministratore' AND active AND id <> $2`,
          [org, id],
        );
        if (rows[0].n === 0) {
          throw new ErroreHttp(409, "Deve restare almeno un amministratore attivo: nomina prima un altro amministratore.");
        }
      }

      await client.query(
        `UPDATE users SET first_name = $3, last_name = $4, email = $5, role = $6, active = $7, submission_exempt = $8,
                          token_version = token_version + CASE WHEN $7 THEN 0 ELSE 1 END
          WHERE id = $1 AND organization_id = $2`,
        [id, org, dopo.nome, dopo.cognome, dopo.email, dopo.ruolo, dopo.attivo, dopo.esonerato_invio],
      );
      if (!dopo.attivo) {
        // Un utente disattivato non deve poter usare un link già creato.
        await client.query('DELETE FROM user_invites WHERE user_id = $1 AND organization_id = $2 AND used_at IS NULL', [id, org]);
      }
      await impostaSettori(client, org, id, settori);

      const base = { organizzazioneId: org, utente: req.utente, tipo: 'utente', id };
      const chi = { email: dopo.email, nome: dopo.nome, cognome: dopo.cognome };
      if (prima.attivo !== dopo.attivo) {
        await traccia(client, { ...base, azione: dopo.attivo ? 'utente.riattivato' : 'utente.disattivato', dettagli: chi });
      }
      if (prima.ruolo !== dopo.ruolo) {
        await traccia(client, {
          ...base,
          azione: 'utente.ruolo_cambiato',
          dettagli: { ...chi, ruolo: { prima: prima.ruolo, dopo: dopo.ruolo } },
        });
      }
      const diff = differenze(
        {
          nome: prima.nome,
          cognome: prima.cognome,
          email: prima.email,
          settori: await nomiSettori(client, org, prima.settori),
          esonerato_invio: prima.esonerato_invio,
        },
        {
          nome: dopo.nome,
          cognome: dopo.cognome,
          email: dopo.email,
          settori: await nomiSettori(client, org, settori),
          esonerato_invio: dopo.esonerato_invio,
        },
      );
      if (Object.keys(diff).length) await traccia(client, { ...base, azione: 'utente.modificato', dettagli: { ...chi, ...diff } });
      return leggiUtente(client, org, id);
    });
    res.json(aggiornato);
  });

  // Nuovo link per scegliere la password (primo accesso o password dimenticata).
  // I link precedenti non ancora usati smettono di funzionare. La password
  // attuale resta valida finché il link non viene usato.
  router.post('/utenti/:id/invito', async (req, res) => {
    if (!isUuid(req.params.id)) throw nonTrovato();
    const org = req.utente.organizzazioneId;
    const invito = await transazione(pool, async (client) => {
      await bloccaOrganizzazione(client, org);
      const u = await leggiUtente(client, org, req.params.id);
      if (!u) throw nonTrovato();
      if (!u.attivo) throw new ErroreHttp(409, "L'utente è disattivato: riattivalo prima di creare un nuovo link.");
      const nuovo = await creaInvito(client, {
        organizzazioneId: org,
        utenteId: u.id,
        creatoDa: req.utente.id,
        durataOre: config.invitoDurataOre,
      });
      nuovo.email = u.email;
      await accodaEmailInvito(client, config, { organizzazioneId: org, utente: u, invito: nuovo, reimposta: u.password_impostata });
      await traccia(client, {
        organizzazioneId: org,
        utente: req.utente,
        azione: 'utente.link_creato',
        tipo: 'utente',
        id: u.id,
        dettagli: { email: u.email, nome: u.nome, cognome: u.cognome, scopo: u.password_impostata ? 'reimposta' : 'nuovo' },
      });
      return nuovo;
    });
    res.status(201).json(invito);
  });

  return router;
}

module.exports = { rotteUtenti };
