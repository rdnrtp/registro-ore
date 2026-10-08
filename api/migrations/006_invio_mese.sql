-- Fase 5: invio del mese alla segreteria, riapertura e reinvio.

-- Ogni invio di un mese: il file Excel esattamente come è stato spedito,
-- con destinatari, data e ora. Dopo una riapertura il collaboratore reinvia e
-- nasce una nuova versione; le precedenti restano. Lo stato corrente del mese
-- (aperto / inviato) resta in month_submissions.
CREATE TABLE month_submission_versions (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid NOT NULL,
    user_id          uuid NOT NULL,
    year             smallint NOT NULL CHECK (year BETWEEN 2000 AND 2100),
    month            smallint NOT NULL CHECK (month BETWEEN 1 AND 12),
    version          integer NOT NULL CHECK (version > 0),
    file             bytea NOT NULL,
    file_name        text NOT NULL,
    file_sha256      text NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
    -- Versione del modello Excel usata (excel_templates.version).
    template_version integer NOT NULL,
    to_address       text NOT NULL,
    cc_addresses     text[] NOT NULL,
    -- Totali al momento dell'invio, per i riepiloghi (il dato vero è nel file).
    total_hours      numeric(6, 1) NOT NULL,
    total_sessions   numeric(6, 1) NOT NULL,
    pt_sessions      integer NOT NULL,
    submitted_at     timestamptz NOT NULL DEFAULT now(),
    -- Riapertura da parte dell'amministratore, con motivazione.
    reopened_at      timestamptz,
    reopened_by      uuid,
    reopen_reason    text,
    CHECK ((reopened_at IS NULL) = (reopen_reason IS NULL)),
    UNIQUE (user_id, year, month, version),
    UNIQUE (id, organization_id),
    FOREIGN KEY (user_id, organization_id) REFERENCES users (id, organization_id) ON DELETE CASCADE,
    FOREIGN KEY (reopened_by, organization_id) REFERENCES users (id, organization_id)
);

-- Il file inviato e i suoi destinatari non cambiano più: si può solo
-- registrare la riapertura.
CREATE FUNCTION month_submission_versions_immutable() RETURNS trigger AS $$
BEGIN
    IF NEW.file IS DISTINCT FROM OLD.file OR NEW.file_name IS DISTINCT FROM OLD.file_name
       OR NEW.file_sha256 IS DISTINCT FROM OLD.file_sha256 OR NEW.to_address IS DISTINCT FROM OLD.to_address
       OR NEW.cc_addresses IS DISTINCT FROM OLD.cc_addresses OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
       OR NEW.version IS DISTINCT FROM OLD.version OR NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.year IS DISTINCT FROM OLD.year OR NEW.month IS DISTINCT FROM OLD.month THEN
        RAISE EXCEPTION 'un invio del mese non si modifica' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER month_submission_versions_immutable
    BEFORE UPDATE ON month_submission_versions
    FOR EACH ROW EXECUTE FUNCTION month_submission_versions_immutable();

ALTER TABLE email_outbox
    ADD FOREIGN KEY (attachment_submission_id, organization_id)
        REFERENCES month_submission_versions (id, organization_id) ON DELETE CASCADE;

CREATE INDEX email_outbox_allegato ON email_outbox (attachment_submission_id) WHERE attachment_submission_id IS NOT NULL;
