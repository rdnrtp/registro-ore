// Notifiche agli utenti: promemoria, solleciti, avvisi in bacheca, riaperture.
//
// Chi notifica descrive cosa dire (titolo, testo, pagina dell'app) e a chi;
// la notifica viene salvata (tabella notifications) e poi consegnata da ogni
// canale in CANALI. Oggi c'è solo l'email; nella Fase 6 le notifiche push
// saranno un secondo canale con lo stesso metodo consegna(), senza toccare
// bacheca, promemoria e solleciti.
const { accodaEmail } = require('./posta/coda');

const NOME_APP = 'Registro ore';

const canaleEmail = {
  nome: 'email',
  async consegna(db, config, { notifiche, organizzazione, nomeMittente, rispondiA }) {
    for (const n of notifiche) {
      const righe = [`Ciao ${n.nome},`, '', n.testo, ''];
      if (n.link) righe.push(`Apri ${NOME_APP}: ${config.appUrl}/${n.link}`, '');
      righe.push('—', `${organizzazione} · ${NOME_APP}`);
      if (!rispondiA) righe.push('Email automatica: per favore non rispondere.');
      await accodaEmail(db, {
        organizzazioneId: n.organizzazioneId,
        tipo: n.tipo,
        utenteId: n.utenteId,
        notificaId: n.id,
        nomeMittente: nomeMittente ?? `${organizzazione} · ${NOME_APP}`,
        rispondiA,
        a: [n.email],
        oggetto: n.titolo,
        testo: righe.join('\n'),
      });
    }
  },
};

const CANALI = [canaleEmail];

// Crea e consegna una notifica a ciascuno degli utenti indicati (attivi e
// dell'organizzazione; gli altri vengono ignorati). Da chiamare dentro la
// transazione della modifica che la causa.
// chiave: se indicata, un utente non riceve mai due notifiche con la stessa
// chiave (per esempio lo stesso promemoria due volte).
// Restituisce gli id degli utenti effettivamente notificati.
async function notifica(db, config, { organizzazioneId, utenti, tipo, titolo, testo, link = null, chiave = null, nomeMittente, rispondiA }) {
  if (!utenti.length) return [];
  const { rows } = await db.query(
    `WITH nuove AS (
       INSERT INTO notifications (organization_id, user_id, kind, title, body, link, dedup_key)
       SELECT $1, u.id, $3, $4, $5, $6, $7
         FROM users u WHERE u.organization_id = $1 AND u.id = ANY($2::uuid[]) AND u.active
       ON CONFLICT (user_id, dedup_key) DO NOTHING
       RETURNING id, user_id)
     SELECT n.id, n.user_id, u.email, u.first_name
       FROM nuove n JOIN users u ON u.id = n.user_id
      ORDER BY u.last_name, u.first_name`,
    [organizzazioneId, utenti, tipo, titolo, testo, link, chiave],
  );
  if (!rows.length) return [];
  const org = await db.query('SELECT name FROM organizations WHERE id = $1', [organizzazioneId]);
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
  }));
  for (const canale of CANALI) {
    await canale.consegna(db, config, { notifiche, organizzazione: org.rows[0].name, nomeMittente, rispondiA });
  }
  return rows.map((r) => r.user_id);
}

module.exports = { notifica, NOME_APP };
