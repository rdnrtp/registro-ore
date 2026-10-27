// Invio del mese alla segreteria: destinatari, versioni inviate.
const { statoPubblico } = require('./posta/coda');

const inizioMese = (anno, mese) => `${anno}-${String(mese).padStart(2, '0')}-01`;

// Destinatari dell'invio del mese di un utente:
// - a: l'indirizzo dell'organizzazione (la segreteria);
// - cc: le "email del settore" (sectors.manager_emails) di tutti i settori
//   delle attività su cui l'utente ha quantità in quel mese, più l'utente.
// Gli utenti "responsabili nell'app" (sector_managers) non contano.
// Restituisce { a: email | null, cc: [email] } in minuscolo, senza doppioni.
async function destinatariMese(db, { orgId, utenteId, anno, mese }) {
  const { rows } = await db.query(
    `SELECT o.submission_email AS a,
            u.email AS utente,
            ARRAY(SELECT DISTINCT lower(e)
                    FROM time_entries t
                    JOIN activity_sectors x ON x.activity_id = t.activity_id AND x.organization_id = t.organization_id
                    JOIN sectors s ON s.id = x.sector_id AND s.organization_id = x.organization_id
                    CROSS JOIN unnest(s.manager_emails) AS e
                   WHERE t.user_id = u.id AND t.organization_id = o.id
                     AND t.entry_date >= $3::date AND t.entry_date < $3::date + interval '1 month') AS settori
       FROM organizations o JOIN users u ON u.organization_id = o.id
      WHERE o.id = $1 AND u.id = $2`,
    [orgId, utenteId, inizioMese(anno, mese)],
  );
  const r = rows[0];
  const a = r.a ? r.a.toLowerCase() : null;
  const cc = [...new Set([...r.settori, r.utente.toLowerCase()])].filter((e) => e !== a).sort();
  return { a, cc };
}

// Versioni inviate del mese, dalla più recente, con lo stato della loro email
// e le spese partite con loro (spese = null se nessuna email delle spese;
// annullate = l'email diceva che le spese inviate prima non valgono più).
async function elencoInvii(db, { orgId, utenteId, anno, mese }) {
  const { rows } = await db.query(
    `SELECT v.version AS versione, v.submitted_at AS inviato_il, v.file_name AS nome_file,
            v.to_address AS destinatario, v.cc_addresses AS copia,
            v.total_hours AS ore, v.total_sessions AS sedute, v.pt_sessions AS sedute_pt,
            v.reopened_at AS riaperto_il, v.reopen_reason AS motivazione,
            CASE WHEN r.id IS NOT NULL THEN r.first_name || ' ' || r.last_name END AS riaperto_da,
            e.status AS email_stato, e.sent_at AS email_inviata_il, e.last_error AS email_errore,
            es.id AS spese_id, es.expense_count AS spese_numero, es.total_cents AS spese_totale,
            es.file_name AS spese_nome_file,
            se.status AS spese_email_stato, se.sent_at AS spese_email_inviata_il, se.last_error AS spese_email_errore
       FROM month_submission_versions v
       LEFT JOIN users r ON r.id = v.reopened_by AND r.organization_id = v.organization_id
       LEFT JOIN LATERAL (
         SELECT status, sent_at, last_error FROM email_outbox
          WHERE attachment_submission_id = v.id AND organization_id = v.organization_id
          ORDER BY created_at DESC LIMIT 1) e ON true
       LEFT JOIN expense_submissions es ON es.month_submission_id = v.id AND es.organization_id = v.organization_id
       LEFT JOIN LATERAL (
         SELECT status, sent_at, last_error FROM email_outbox
          WHERE attachment_expense_submission_id = es.id AND organization_id = v.organization_id
          ORDER BY created_at DESC LIMIT 1) se ON true
      WHERE v.user_id = $1 AND v.organization_id = $2 AND v.year = $3 AND v.month = $4
      ORDER BY v.version DESC`,
    [utenteId, orgId, anno, mese],
  );
  return rows.map(({ email_stato: stato, email_inviata_il: inviataIl, email_errore: errore, ...v }) => {
    const { spese_id: speseId, spese_numero: numero, spese_totale: totale, spese_nome_file: nomeFile } = v;
    const speseEmail = { stato: statoPubblico(v.spese_email_stato), inviata_il: v.spese_email_inviata_il, errore: v.spese_email_errore };
    for (const k of Object.keys(v)) if (k.startsWith('spese_')) delete v[k];
    return {
      ...v,
      email: { stato: statoPubblico(stato), inviata_il: inviataIl, errore },
      spese: speseId
        ? { numero, totale_centesimi: Number(totale), nome_file: nomeFile, annullate: numero === 0, email: speseEmail }
        : null,
    };
  });
}

module.exports = { destinatariMese, elencoInvii, inizioMese };
