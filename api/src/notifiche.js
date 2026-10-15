// Notifiche agli utenti: promemoria, solleciti, avvisi in bacheca, riaperture.
//
// Chi notifica descrive cosa dire (titolo, testo, pagina dell'app) e a chi;
// la notifica viene salvata (tabella notifications) e poi consegnata dai
// canali: push (sui dispositivi in cui l'utente le ha attivate) ed email.
// Quali canali usare lo decide REGOLE in base al tipo, qui e solo qui:
// bacheca, promemoria e riaperture non sanno niente dei canali.
//
// Né push né email partono dentro la richiesta: si scrivono nelle code
// (push_outbox, email_outbox) nella stessa transazione della modifica, e
// l'API le invia in sottofondo (src/push/coda.js, src/posta/coda.js).
const { accodaEmail } = require('./posta/coda');
const { fuoriDalSilenzio } = require('./tempo');

const NOME_APP = 'Registro ore';

// Pagina dell'app con il proprio mese indicato (Mese.jsx).
const linkMese = (anno, mese) => `#/mese/${anno}/${mese}`;

// Canali per tipo di notifica.
// push: true = anche push, sui dispositivi dell'utente.
// email: 'sempre' | 'senza_push' (solo se l'utente non ha nessun
//        dispositivo con le push attive) | 'mai'.
// subito: true = ignora la fascia di silenzio (22–7) delle push.
const REGOLE = {
  avviso: { push: true, email: 'senza_push' },
  promemoria: { push: true, email: 'senza_push' },
  // Contiene la motivazione: arriva sempre anche per email.
  riapertura: { push: true, email: 'sempre' },
  // "Invia una notifica di prova", chiesta dall'utente in quel momento.
  prova: { push: true, email: 'mai', subito: true },
};
// Gli altri tipi (sollecito: scritto a nome dell'amministratore, con
// risposta a lui) vanno solo per email.
const SOLO_EMAIL = { push: false, email: 'sempre' };
const regola = (tipo) => REGOLE[tipo] ?? SOLO_EMAIL;

// Testo breve della push quando chi notifica non lo indica.
const breveDa = (testo) => {
  const riga = testo.split('\n').find((r) => r.trim()) ?? '';
  return riga.length > 200 ? `${riga.slice(0, 199)}…` : riga;
};

const canaleEmail = {
  nome: 'email',
  async consegna(db, config, { notifiche, organizzazione }) {
    for (const n of notifiche) {
      const righe = [`Ciao ${n.nome},`, '', n.testo, ''];
      if (n.link) righe.push(`Apri ${NOME_APP}: ${config.appUrl}/${n.link}`, '');
      righe.push('—', `${organizzazione} · ${NOME_APP}`);
      if (!n.rispondiA) righe.push('Email automatica: per favore non rispondere.');
      await accodaEmail(db, {
        organizzazioneId: n.organizzazioneId,
        tipo: n.tipo,
        utenteId: n.utenteId,
        notificaId: n.id,
        nomeMittente: n.nomeMittente ?? `${organizzazione} · ${NOME_APP}`,
        rispondiA: n.rispondiA,
        a: [n.email],
        oggetto: n.titolo,
        testo: righe.join('\n'),
      });
    }
  },
};

// Mette in coda una push per ogni dispositivo dell'utente. Restituisce gli
// id degli utenti che hanno almeno un dispositivo (raggiunti con la push).
const canalePush = {
  nome: 'push',
  async consegna(db, config, { notifiche, adesso, subito }) {
    if (!config.push || !notifiche.length) return new Set();
    const quando = subito ? adesso : fuoriDalSilenzio(adesso);
    const { rows } = await db.query(
      `INSERT INTO push_outbox (organization_id, notification_id, subscription_id, next_attempt_at)
       SELECT s.organization_id, n.id, s.id, $3
         FROM unnest($1::uuid[], $2::uuid[]) AS n (id, user_id)
         JOIN push_subscriptions s ON s.user_id = n.user_id AND s.organization_id = $4
       RETURNING (SELECT user_id FROM push_subscriptions WHERE id = subscription_id) AS user_id`,
      [notifiche.map((n) => n.id), notifiche.map((n) => n.utenteId), quando, notifiche[0].organizzazioneId],
    );
    return new Set(rows.map((r) => r.user_id));
  },
};

const nomeOrganizzazione = async (db, id) => (await db.query('SELECT name FROM organizations WHERE id = $1', [id])).rows[0].name;

// Crea e consegna una notifica a ciascuno degli utenti indicati (attivi e
// dell'organizzazione; gli altri vengono ignorati). Da chiamare dentro la
// transazione della modifica che la causa.
// autore: chi ha compiuto l'azione; non riceve la notifica della propria azione.
// chiave: se indicata, un utente non riceve mai due notifiche con la stessa
// chiave (per esempio lo stesso promemoria due volte).
// breve: testo della push (predefinito: la prima riga del testo).
// adesso: istante della notifica (per la fascia di silenzio delle push).
// Restituisce gli id degli utenti effettivamente notificati.
async function notifica(
  db,
  config,
  { organizzazioneId, utenti, autore = null, tipo, titolo, testo, breve, link = null, chiave = null, nomeMittente, rispondiA, adesso = new Date() },
) {
  if (!utenti.length) return [];
  const { rows } = await db.query(
    `WITH nuove AS (
       INSERT INTO notifications (organization_id, user_id, kind, title, body, link, dedup_key,
                                  short_body, email_from_name, email_reply_to)
       SELECT $1, u.id, $3, $4, $5, $6, $7, $9, $10, $11
         FROM users u
        WHERE u.organization_id = $1 AND u.id = ANY($2::uuid[]) AND u.active AND u.id IS DISTINCT FROM $8::uuid
       ON CONFLICT (user_id, dedup_key) DO NOTHING
       RETURNING id, user_id)
     SELECT n.id, n.user_id, u.email, u.first_name
       FROM nuove n JOIN users u ON u.id = n.user_id
      ORDER BY u.last_name, u.first_name`,
    [organizzazioneId, utenti, tipo, titolo, testo, link, chiave, autore, breve ?? breveDa(testo), nomeMittente ?? null, rispondiA ?? null],
  );
  if (!rows.length) return [];
  const notifiche = rows.map((r) => ({
    id: r.id,
    organizzazioneId,
    utenteId: r.user_id,
    email: r.email,
    nome: r.first_name,
    tipo,
    titolo,
    testo,
    link,
    nomeMittente,
    rispondiA,
  }));
  const r = regola(tipo);
  const conPush = r.push ? await canalePush.consegna(db, config, { notifiche, adesso, subito: r.subito }) : new Set();
  const perEmail = notifiche.filter((n) => r.email === 'sempre' || (r.email === 'senza_push' && !conPush.has(n.utenteId)));
  if (perEmail.length) {
    await canaleEmail.consegna(db, config, { notifiche: perEmail, organizzazione: await nomeOrganizzazione(db, organizzazioneId) });
  }
  return rows.map((x) => x.user_id);
}

// Una push di questa notifica non è arrivata (dispositivo non più valido o
// tolto, troppi errori). Se non è arrivata nemmeno su un altro dispositivo
// e non ne è in corso nessun'altra, la notifica ripiega sull'email (solo per
// i tipi che usano l'email al posto della push). Mai due email.
// Da chiamare nella transazione che segna la push in errore: il blocco sulla
// notifica mette in fila due dispositivi che falliscono insieme, così il
// secondo vede l'errore del primo e l'email parte una volta.
// Restituisce true se ha messo in coda l'email.
async function ripiegaSuEmail(db, config, notificaId) {
  await db.query('SELECT 1 FROM notifications WHERE id = $1 FOR UPDATE', [notificaId]);
  const { rows } = await db.query(
    `SELECT n.id, n.organization_id, n.user_id, n.kind, n.title, n.body, n.link, n.email_from_name, n.email_reply_to,
            u.email, u.first_name
       FROM notifications n JOIN users u ON u.id = n.user_id AND u.organization_id = n.organization_id
      WHERE n.id = $1 AND u.active
        AND NOT EXISTS (SELECT 1 FROM push_outbox p WHERE p.notification_id = n.id AND p.status <> 'errore')
        AND NOT EXISTS (SELECT 1 FROM email_outbox e WHERE e.notification_id = n.id)`,
    [notificaId],
  );
  const n = rows[0];
  if (!n || regola(n.kind).email !== 'senza_push') return false;
  await canaleEmail.consegna(db, config, {
    organizzazione: await nomeOrganizzazione(db, n.organization_id),
    notifiche: [
      {
        id: n.id,
        organizzazioneId: n.organization_id,
        utenteId: n.user_id,
        email: n.email,
        nome: n.first_name,
        tipo: n.kind,
        titolo: n.title,
        testo: n.body,
        link: n.link,
        nomeMittente: n.email_from_name ?? undefined,
        rispondiA: n.email_reply_to ?? undefined,
      },
    ],
  });
  return true;
}

module.exports = { notifica, ripiegaSuEmail, regola, linkMese, NOME_APP };
