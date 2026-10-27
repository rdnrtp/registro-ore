-- Rimborsi spese di trasferta: tipi configurabili, spese con le ricevute
-- (foto o PDF), invio alla segreteria come PDF unico.

-- Quando partono le spese: 'mese' = con l'invio del mese (seconda email),
-- 'subito' = ogni spesa appena confermata.
ALTER TABLE organizations
    ADD COLUMN expense_send_mode text NOT NULL DEFAULT 'mese' CHECK (expense_send_mode IN ('mese', 'subito'));

-- Tipi di spesa dell'organizzazione (Pedaggio, Carburante, …). Non si
-- eliminano: un tipo non più usato si disattiva.
CREATE TABLE expense_types (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    name            text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
    sort_order      integer NOT NULL,
    active          boolean NOT NULL DEFAULT true,
    UNIQUE (organization_id, name),
    UNIQUE (id, organization_id)
);

-- Valori iniziali, per gli impianti esistenti e per quelli nuovi.
CREATE FUNCTION expense_types_iniziali() RETURNS trigger AS $$
BEGIN
    INSERT INTO expense_types (organization_id, name, sort_order)
    SELECT NEW.id, t.name, t.ord
      FROM unnest(ARRAY['Pedaggio', 'Carburante', 'Parcheggio', 'Pasto', 'Altro']) WITH ORDINALITY AS t(name, ord);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER expense_types_iniziali
    AFTER INSERT ON organizations
    FOR EACH ROW EXECUTE FUNCTION expense_types_iniziali();

INSERT INTO expense_types (organization_id, name, sort_order)
SELECT o.id, t.name, t.ord
  FROM organizations o
 CROSS JOIN unnest(ARRAY['Pedaggio', 'Carburante', 'Parcheggio', 'Pasto', 'Altro']) WITH ORDINALITY AS t(name, ord);

-- Invio di spese alla segreteria: il PDF esattamente come è partito.
-- - mode 'mese': insieme all'invio del mese (month_submission_id); file null
--   = nessuna spesa in questo invio, mentre il precedente ne aveva (l'email
--   dice che le spese inviate prima non valgono più);
-- - mode 'subito': una sola spesa, appena confermata.
CREATE TABLE expense_submissions (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL,
    user_id             uuid NOT NULL,
    year                smallint NOT NULL CHECK (year BETWEEN 2000 AND 2100),
    month               smallint NOT NULL CHECK (month BETWEEN 1 AND 12),
    mode                text NOT NULL CHECK (mode IN ('mese', 'subito')),
    month_submission_id uuid,
    file                bytea,
    file_name           text,
    file_sha256         text CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
    expense_count       integer NOT NULL CHECK (expense_count >= 0),
    total_cents         bigint NOT NULL CHECK (total_cents >= 0),
    to_address          text NOT NULL,
    cc_addresses        text[] NOT NULL,
    submitted_at        timestamptz NOT NULL DEFAULT now(),
    CHECK ((mode = 'mese') = (month_submission_id IS NOT NULL)),
    CHECK ((file IS NULL) = (file_name IS NULL) AND (file IS NULL) = (file_sha256 IS NULL)),
    CHECK ((file IS NULL) = (expense_count = 0)),
    CHECK (mode = 'mese' OR file IS NOT NULL),
    UNIQUE (month_submission_id),
    UNIQUE (id, organization_id),
    FOREIGN KEY (user_id, organization_id) REFERENCES users (id, organization_id) ON DELETE CASCADE,
    FOREIGN KEY (month_submission_id, organization_id)
        REFERENCES month_submission_versions (id, organization_id) ON DELETE CASCADE
);

CREATE INDEX expense_submissions_mese ON expense_submissions (user_id, year, month);

-- Un invio non si modifica.
CREATE FUNCTION expense_submissions_immutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'un invio delle spese non si modifica' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER expense_submissions_immutable
    BEFORE UPDATE ON expense_submissions
    FOR EACH ROW EXECUTE FUNCTION expense_submissions_immutable();

-- Spese. Importo in centesimi di euro. submission_id = inviata da sola
-- (modalità "subito"): da allora è in sola lettura.
CREATE TABLE expenses (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    user_id         uuid NOT NULL,
    expense_date    date NOT NULL,
    type_id         uuid NOT NULL,
    amount_cents    integer NOT NULL CHECK (amount_cents BETWEEN 1 AND 1000000),
    reason          text NOT NULL CHECK (length(reason) BETWEEN 1 AND 300),
    submission_id   uuid,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, organization_id),
    FOREIGN KEY (user_id, organization_id) REFERENCES users (id, organization_id) ON DELETE CASCADE,
    FOREIGN KEY (type_id, organization_id) REFERENCES expense_types (id, organization_id),
    FOREIGN KEY (submission_id, organization_id) REFERENCES expense_submissions (id, organization_id)
);

CREATE INDEX expenses_utente_data ON expenses (user_id, expense_date);

-- Ricevute: foto già ridotte e ripulite dai metadati (sempre JPEG) oppure
-- PDF così come sono stati caricati. expense_id null = caricata ma la spesa
-- non è ancora stata salvata (bozza: si cancella dopo un giorno).
CREATE TABLE expense_attachments (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    user_id         uuid NOT NULL,
    expense_id      uuid,
    position        smallint NOT NULL DEFAULT 0 CHECK (position BETWEEN 0 AND 4),
    content_type    text NOT NULL CHECK (content_type IN ('image/jpeg', 'application/pdf')),
    original_name   text NOT NULL CHECK (length(original_name) BETWEEN 1 AND 200),
    file            bytea NOT NULL,
    size            integer NOT NULL CHECK (size > 0),
    sha256          text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    pages           smallint NOT NULL CHECK (pages > 0),
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, organization_id),
    FOREIGN KEY (user_id, organization_id) REFERENCES users (id, organization_id) ON DELETE CASCADE,
    FOREIGN KEY (expense_id, organization_id) REFERENCES expenses (id, organization_id) ON DELETE CASCADE
);

CREATE INDEX expense_attachments_spesa ON expense_attachments (expense_id);
CREATE INDEX expense_attachments_bozze ON expense_attachments (created_at) WHERE expense_id IS NULL;

-- Email con il PDF delle spese allegato (il file non viene copiato).
ALTER TABLE email_outbox ADD COLUMN attachment_expense_submission_id uuid;
ALTER TABLE email_outbox
    ADD FOREIGN KEY (attachment_expense_submission_id, organization_id)
        REFERENCES expense_submissions (id, organization_id) ON DELETE CASCADE;
CREATE INDEX email_outbox_allegato_spese ON email_outbox (attachment_expense_submission_id)
    WHERE attachment_expense_submission_id IS NOT NULL;
