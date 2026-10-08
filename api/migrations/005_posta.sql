-- Fase 5: posta in uscita e notifiche.

-- Notifiche agli utenti (promemoria, solleciti, avvisi in bacheca, …),
-- indipendenti dal canale con cui vengono consegnate: oggi l'email, nella
-- Fase 6 anche le notifiche push. dedup_key impedisce di creare due volte la
-- stessa notifica per lo stesso utente (per esempio lo stesso promemoria).
CREATE TABLE notifications (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    user_id         uuid NOT NULL,
    kind            text NOT NULL,
    title           text NOT NULL,
    body            text NOT NULL,
    -- Pagina dell'app a cui rimanda, come ancora: '#/bacheca/…'.
    link            text,
    dedup_key       text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, dedup_key),
    UNIQUE (id, organization_id),
    FOREIGN KEY (user_id, organization_id) REFERENCES users (id, organization_id) ON DELETE CASCADE
);

-- Coda delle email in uscita. Le email non partono dentro la richiesta
-- dell'utente: si scrivono qui (nella stessa transazione della modifica che le
-- causa) e le invia l'API in sottofondo, con ritentativi.
--
-- Stati: in_attesa -> in_invio -> inviata | in_attesa (nuovo tentativo) | errore.
-- Una riga rimasta in_invio oltre locked_until (API fermata durante l'invio)
-- passa a errore e non viene ritentata da sola: l'email potrebbe essere già
-- partita, e la stessa email non deve mai partire due volte.
CREATE TABLE email_outbox (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    -- invio_mese, invito, promemoria, sollecito, avviso, riapertura, …
    kind            text NOT NULL,
    -- Persona a cui si riferisce l'email (chi invia il mese, chi riceve l'invito, …).
    user_id         uuid,
    notification_id uuid,
    -- Nome del mittente ("Andrea Petris tramite Registro ore"); l'indirizzo
    -- è quello della configurazione (POSTA_MITTENTE).
    from_name       text NOT NULL,
    reply_to        text,
    to_addresses    text[] NOT NULL CHECK (cardinality(to_addresses) > 0),
    cc_addresses    text[] NOT NULL DEFAULT '{}',
    subject         text NOT NULL,
    body_text       text NOT NULL,
    -- Email precedente della stessa conversazione (Message-ID nei riferimenti).
    references_id   uuid REFERENCES email_outbox (id),
    -- File allegato: un invio del mese (month_submission_versions, migrazione
    -- 006, che aggiunge anche la chiave esterna). Il file non viene copiato qui.
    attachment_submission_id uuid,
    -- Il testo contiene un link personale: dopo l'invio viene cancellato.
    sensitive       boolean NOT NULL DEFAULT false,
    status          text NOT NULL DEFAULT 'in_attesa'
                    CHECK (status IN ('in_attesa', 'in_invio', 'inviata', 'errore')),
    attempts        integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    locked_until    timestamptz,
    last_error      text,
    sent_at         timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CHECK ((status = 'inviata') = (sent_at IS NOT NULL)),
    UNIQUE (id, organization_id),
    FOREIGN KEY (user_id, organization_id) REFERENCES users (id, organization_id) ON DELETE CASCADE,
    FOREIGN KEY (notification_id, organization_id) REFERENCES notifications (id, organization_id) ON DELETE CASCADE
);

CREATE INDEX email_outbox_da_inviare ON email_outbox (next_attempt_at) WHERE status = 'in_attesa';
CREATE INDEX email_outbox_org_data ON email_outbox (organization_id, created_at DESC);
