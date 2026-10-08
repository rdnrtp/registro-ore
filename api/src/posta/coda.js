// Coda delle email in uscita (tabella email_outbox).
//
// accodaEmail() scrive l'email nella coda, dentro la transazione della
// modifica che la causa: se la modifica viene annullata, l'email non esiste.
// elaboraCoda() le invia, chiamata dall'API a intervalli regolari (avvio.js).
//
// Garanzie:
// - una riga viene presa da un solo elaboratore alla volta (FOR UPDATE SKIP
//   LOCKED) e segnata "in_invio" prima di contattare il server di posta;
// - un errore temporaneo (server irraggiungibile, risposta 4xx) rimette
//   l'email in attesa con un ritardo crescente, fino a POSTA_MAX_TENTATIVI;
//   un rifiuto definitivo (5xx) la mette subito in errore;
// - se l'API si ferma mentre invia, la riga resta "in_invio": scaduto il
//   tempo massimo passa a "errore" senza nuovo tentativo, perché l'email
//   potrebbe essere già partita. Si può ritentare a mano (Gestione → Email).
// - il Message-ID è fisso (deriva dall'id della riga): anche un eventuale
//   doppione sarebbe riconoscibile come la stessa email dai programmi di posta.
// Durata massima di un invio: oltre, la riga "in_invio" è considerata interrotta.
const DURATA_INVIO_MINUTI = 10;
const TESTO_RISERVATO = '[Testo cancellato dopo l\'invio: conteneva un link personale.]';

// Ritardo prima del tentativo n+1: 1, 2, 4, 8 … minuti, al massimo un'ora.
const ritardoSecondi = (tentativi) => Math.min(60 * 2 ** Math.max(tentativi - 1, 0), 3600);

// email: { organizzazioneId, tipo, utenteId?, notificaId?, nomeMittente,
//          rispondiA?, a: [indirizzi], cc?: [indirizzi], oggetto, testo,
//          allegatoInvioId?, riferimentoId?, riservata? }
// Restituisce l'id della riga.
async function accodaEmail(db, e) {
  if (!e.a?.length) throw new Error('Email senza destinatari');
  const { rows } = await db.query(
    `INSERT INTO email_outbox
       (organization_id, kind, user_id, notification_id, from_name, reply_to, to_addresses, cc_addresses,
        subject, body_text, attachment_submission_id, references_id, sensitive)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id`,
    [
      e.organizzazioneId,
      e.tipo,
      e.utenteId ?? null,
      e.notificaId ?? null,
      e.nomeMittente,
      e.rispondiA ?? null,
      e.a,
      e.cc ?? [],
      e.oggetto,
      e.testo,
      e.allegatoInvioId ?? null,
      e.riferimentoId ?? null,
      e.riservata ?? false,
    ],
  );
  return rows[0].id;
}

// Message-ID stabile: lo stesso a ogni tentativo.
const messageId = (id, mittente) => `<${id}@${mittente.split('@')[1] || 'registro-ore'}>`;

// Righe rimaste "in_invio" oltre il tempo massimo: l'API si è fermata durante
// l'invio. Non si sa se l'email è partita, quindi non si ritenta da soli.
async function chiudiInterrotte(pool) {
  await pool.query(
    `UPDATE email_outbox
        SET status = 'errore', locked_until = NULL,
            last_error = 'Invio interrotto (API fermata durante l''invio): l''email potrebbe essere partita o no. ' ||
                         'Non viene ritentata da sola per non mandarla due volte.'
      WHERE status = 'in_invio' AND locked_until < now()`,
  );
}

// Prende la prossima email da inviare e la segna "in_invio", in una
// transazione breve: dopo il COMMIT nessun altro elaboratore la vede più.
async function prenota(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id FROM email_outbox
        WHERE status = 'in_attesa' AND next_attempt_at <= now()
        ORDER BY next_attempt_at, created_at
        LIMIT 1
        FOR UPDATE SKIP LOCKED`,
    );
    if (!rows[0]) {
      await client.query('COMMIT');
      return null;
    }
    const { rows: righe } = await client.query(
      `UPDATE email_outbox
          SET status = 'in_invio', attempts = attempts + 1,
              locked_until = now() + make_interval(mins => $2)
        WHERE id = $1
        RETURNING id, from_name, reply_to, to_addresses, cc_addresses, subject, body_text,
                  attachment_submission_id, references_id, attempts`,
      [rows[0].id, DURATA_INVIO_MINUTI],
    );
    await client.query('COMMIT');
    return righe[0];
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function componiMessaggio(pool, riga, config) {
  const messaggio = {
    from: { name: riga.from_name, address: config.posta.mittente },
    to: riga.to_addresses,
    cc: riga.cc_addresses.length ? riga.cc_addresses : undefined,
    replyTo: riga.reply_to ?? undefined,
    subject: riga.subject,
    text: riga.body_text,
    messageId: messageId(riga.id, config.posta.mittente),
    // Niente lettura di file o indirizzi indicati nel messaggio.
    disableFileAccess: true,
    disableUrlAccess: true,
  };
  if (riga.references_id) {
    messaggio.inReplyTo = messageId(riga.references_id, config.posta.mittente);
    messaggio.references = [messaggio.inReplyTo];
  }
  if (riga.attachment_submission_id) {
    const { rows } = await pool.query('SELECT file, file_name FROM month_submission_versions WHERE id = $1', [
      riga.attachment_submission_id,
    ]);
    if (!rows[0]) throw new Error('Allegato non trovato');
    messaggio.attachments = [
      {
        filename: rows[0].file_name,
        content: rows[0].file,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    ];
  }
  return messaggio;
}

// Errore definitivo: il server ha rifiutato il messaggio (codice 5xx).
// Tutto il resto (connessione, timeout, 4xx) è temporaneo.
const definitivo = (err) => Number.isInteger(err?.responseCode) && err.responseCode >= 500;

function descriviErrore(err) {
  const testo = err?.response || err?.message || String(err);
  return String(testo).slice(0, 500);
}

async function esito(pool, riga, config, err) {
  if (!err) {
    await pool.query(
      `UPDATE email_outbox
          SET status = 'inviata', sent_at = now(), locked_until = NULL, last_error = NULL,
              body_text = CASE WHEN sensitive THEN $2 ELSE body_text END
        WHERE id = $1`,
      [riga.id, TESTO_RISERVATO],
    );
    return 'inviata';
  }
  const ancora = !definitivo(err) && riga.attempts < config.posta.maxTentativi;
  await pool.query(
    `UPDATE email_outbox
        SET status = $2, locked_until = NULL, last_error = $3,
            next_attempt_at = now() + make_interval(secs => $4),
            body_text = CASE WHEN sensitive AND $2 = 'errore' THEN $5 ELSE body_text END
      WHERE id = $1`,
    [riga.id, ancora ? 'in_attesa' : 'errore', descriviErrore(err), ritardoSecondi(riga.attempts), TESTO_RISERVATO],
  );
  return ancora ? 'in_attesa' : 'errore';
}

// Invia le email in attesa, al massimo `limite`. trasporto = oggetto con
// sendMail(messaggio) (nodemailer, o uno finto nei test).
// Restituisce { inviate, rinviate, errori }.
async function elaboraCoda(pool, { trasporto, config, limite = 50, log = () => {} }) {
  await chiudiInterrotte(pool);
  const conteggio = { inviate: 0, rinviate: 0, errori: 0 };
  for (let i = 0; i < limite; i++) {
    const riga = await prenota(pool);
    if (!riga) break;
    let errore = null;
    try {
      await trasporto.sendMail(await componiMessaggio(pool, riga, config));
    } catch (err) {
      errore = err;
      log(`Email ${riga.id} (tentativo ${riga.attempts}): ${descriviErrore(err)}`);
    }
    const stato = await esito(pool, riga, config, errore);
    if (stato === 'inviata') conteggio.inviate++;
    else if (stato === 'in_attesa') conteggio.rinviate++;
    else conteggio.errori++;
  }
  return conteggio;
}

// Rimette in coda un'email in errore (azione dell'amministratore).
async function riprovaEmail(db, orgId, id) {
  const { rows } = await db.query(
    `UPDATE email_outbox
        SET status = 'in_attesa', attempts = 0, next_attempt_at = now(), last_error = NULL
      WHERE id = $1 AND organization_id = $2 AND status = 'errore' AND NOT sensitive
      RETURNING id`,
    [id, orgId],
  );
  return Boolean(rows[0]);
}

// Stato pubblico di un'email: in_invio si mostra come in_attesa.
const statoPubblico = (stato) => (stato === 'in_invio' ? 'in_attesa' : stato);

module.exports = { accodaEmail, elaboraCoda, riprovaEmail, statoPubblico, messageId, TESTO_RISERVATO };
