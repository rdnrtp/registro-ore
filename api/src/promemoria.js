// Promemoria automatici a chi non ha ancora inviato il mese.
//
// L'API chiama eseguiPromemoria() ogni minuto (avvio.js). Per ogni
// organizzazione: se oggi (ora italiana) è un giorno di promemoria ed è già
// passata l'ora indicata, e il giro di oggi non è ancora stato fatto, manda
// la notifica a chi deve inviare il mese corrente e non l'ha ancora fatto.
// - Mai due volte: il giro è segnato in reminder_runs nella stessa
//   transazione delle notifiche, e ogni notifica ha una chiave unica per
//   utente e giorno.
// - Server spento alle 9: il giro parte appena l'API riparte, se è ancora
//   lo stesso giorno. I giorni passati non vengono recuperati.
const { transazione } = require('./db');
const { notifica } = require('./notifiche');
const { inItalia } = require('./tempo');
const { giorniNelMese, NOMI_MESI } = require('./validazione');

// Giorni del mese in cui partono i promemoria, secondo la configurazione.
function giorniPromemoria(conf, anno, mese) {
  const ultimo = giorniNelMese(anno, mese);
  const giorni = new Set(conf.giorni.map((g) => Math.min(g, ultimo)));
  if (conf.ultimoGiorno) giorni.add(ultimo);
  return [...giorni].sort((a, b) => a - b);
}

function testo(anno, mese, giorno) {
  const quale = `${NOMI_MESI[mese - 1]} ${anno}`;
  const ultimo = giorniNelMese(anno, mese);
  const scadenza =
    giorno === ultimo
      ? `Oggi è l'ultimo giorno per inviarlo.`
      : `La scadenza è il ${ultimo} ${NOMI_MESI[mese - 1]}.`;
  return {
    titolo: giorno === ultimo ? `Ultimo giorno: invia le ore di ${quale}` : `Ricordati di inviare le ore di ${quale}`,
    testo:
      `non hai ancora inviato il file delle ore di ${quale}. ${scadenza} ` +
      'Se un file arriva in ritardo, slittano gli stipendi di tutti.\n\n' +
      'Controlla le registrazioni e usa il pulsante "Invia il mese" nell\'app.',
  };
}

// Esegue i promemoria dovuti nell'istante `adesso`.
// simulazione = true (comando simula-promemoria): considera passata l'ora
// del promemoria e tiene i giri separati da quelli veri.
// slug: solo quell'organizzazione.
// Restituisce un esito per organizzazione:
// { organizzazione, data, esito: 'inviati' | 'gia_eseguito' | 'non_previsto' | 'prima_dell_ora', destinatari: [id] }
async function eseguiPromemoria(pool, config, { adesso = new Date(), simulazione = false, slug = null } = {}) {
  const oggi = inItalia(adesso);
  const { rows: organizzazioni } = await pool.query(
    `SELECT id, slug, reminder_days, reminder_last_day, reminder_hour FROM organizations
      WHERE $1::text IS NULL OR slug = $1 ORDER BY slug`,
    [slug],
  );
  const esiti = [];
  for (const org of organizzazioni) {
    const esito = { organizzazione: org.slug, data: oggi.data, destinatari: [] };
    esiti.push(esito);
    const giorni = giorniPromemoria({ giorni: org.reminder_days, ultimoGiorno: org.reminder_last_day }, oggi.anno, oggi.mese);
    if (!giorni.includes(oggi.giorno)) {
      esito.esito = 'non_previsto';
      esito.giorni = giorni;
      continue;
    }
    if (!simulazione && oggi.ora < org.reminder_hour) {
      esito.esito = 'prima_dell_ora';
      continue;
    }
    await transazione(pool, async (client) => {
      const giro = await client.query(
        `INSERT INTO reminder_runs (organization_id, run_date, simulated, year, month)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING RETURNING 1`,
        [org.id, oggi.data, simulazione, oggi.anno, oggi.mese],
      );
      if (!giro.rows[0]) {
        esito.esito = 'gia_eseguito';
        return;
      }
      // Chi deve inviare e non l'ha ancora fatto. Chi non ha ancora scelto la
      // password non può entrare: il promemoria non gli servirebbe.
      const { rows } = await client.query(
        `SELECT u.id FROM users u
          WHERE u.organization_id = $1 AND u.active AND NOT u.submission_exempt AND u.password_hash IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM month_submissions s
                             WHERE s.user_id = u.id AND s.organization_id = u.organization_id
                               AND s.year = $2 AND s.month = $3 AND s.status = 'inviato')`,
        [org.id, oggi.anno, oggi.mese],
      );
      const { titolo, testo: corpo } = testo(oggi.anno, oggi.mese, oggi.giorno);
      esito.destinatari = await notifica(client, config, {
        organizzazioneId: org.id,
        utenti: rows.map((r) => r.id),
        tipo: 'promemoria',
        titolo,
        testo: corpo,
        link: '#/',
        chiave: `promemoria:${oggi.data}${simulazione ? ':simulazione' : ''}`,
      });
      await client.query(
        'UPDATE reminder_runs SET recipients = $4 WHERE organization_id = $1 AND run_date = $2 AND simulated = $3',
        [org.id, oggi.data, simulazione, esito.destinatari.length],
      );
      esito.esito = 'inviati';
    });
  }
  return esiti;
}

module.exports = { eseguiPromemoria, giorniPromemoria };
