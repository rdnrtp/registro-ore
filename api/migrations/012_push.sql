-- Fase 6b: notifiche push, secondo canale delle notifiche (src/notifiche.js).

-- Dispositivi (browser o app installata) su cui un utente ha attivato le
-- notifiche push. Ognuno è legato alla sessione con cui è stato attivato:
-- "Esci" (o "Esci da tutti i dispositivi", password reimpostata, utente
-- disattivato) cancella la sessione e con lei l'iscrizione, così un PC
-- condiviso non riceve più le notifiche di chi è uscito.
-- endpoint = indirizzo del servizio push del browser (Google, Mozilla,
-- Apple, Microsoft), unico: lo stesso browser non è mai iscritto due volte.
CREATE TABLE push_subscriptions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    user_id         uuid NOT NULL,
    session_id      uuid NOT NULL REFERENCES user_sessions (id) ON DELETE CASCADE,
    endpoint        text NOT NULL UNIQUE,
    -- Chiavi del browser per cifrare il contenuto (base64url).
    p256dh          text NOT NULL,
    auth            text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    last_success_at timestamptz,
    UNIQUE (id, organization_id),
    FOREIGN KEY (user_id, organization_id) REFERENCES users (id, organization_id) ON DELETE CASCADE
);

CREATE INDEX push_subscriptions_user ON push_subscriptions (user_id);

-- Testo breve per la push e mittente dell'email: servono anche dopo, se la
-- push non arriva e la notifica ripiega sull'email.
ALTER TABLE notifications
    ADD COLUMN short_body      text,
    ADD COLUMN email_from_name text,
    ADD COLUMN email_reply_to  text;

-- Coda delle push: una riga per notifica e dispositivo, inviata dall'API in
-- sottofondo (mai dentro la richiesta), come email_outbox.
-- next_attempt_at tiene conto della fascia di silenzio (22–7 ora italiana).
-- Dispositivo cancellato (non più valido, uscita, disattivato) =
-- subscription_id null: la riga va in errore e, se la notifica non è
-- arrivata su nessun altro dispositivo, ripiega sull'email.
CREATE TABLE push_outbox (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    notification_id uuid NOT NULL,
    subscription_id uuid,
    status          text NOT NULL DEFAULT 'in_attesa'
                    CHECK (status IN ('in_attesa', 'in_invio', 'inviata', 'errore')),
    attempts        integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL,
    locked_until    timestamptz,
    last_error      text,
    sent_at         timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CHECK ((status = 'inviata') = (sent_at IS NOT NULL)),
    FOREIGN KEY (notification_id, organization_id) REFERENCES notifications (id, organization_id) ON DELETE CASCADE,
    FOREIGN KEY (subscription_id, organization_id) REFERENCES push_subscriptions (id, organization_id)
        ON DELETE SET NULL (subscription_id)
);

CREATE INDEX push_outbox_da_inviare ON push_outbox (next_attempt_at) WHERE status = 'in_attesa';
CREATE INDEX push_outbox_notifica ON push_outbox (notification_id);
CREATE INDEX push_outbox_dispositivo ON push_outbox (subscription_id);
