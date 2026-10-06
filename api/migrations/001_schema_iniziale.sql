-- Schema iniziale.
--
-- Ogni tabella con dati di un impianto porta organization_id. Le chiavi esterne
-- verso altre tabelle dell'organizzazione sono composte (id, organization_id):
-- così il database stesso impedisce di collegare righe di organizzazioni diverse.

CREATE TABLE organizations (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug             text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]+$'),
    name             text NOT NULL,
    -- Indirizzo a cui va inviato il file mensile (la segreteria).
    submission_email text,
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sectors (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    name            text NOT NULL,
    -- Email dei responsabili da mettere in copia; un settore può averne più d'uno.
    manager_emails  text[] NOT NULL DEFAULT '{}',
    sort_order      integer NOT NULL DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, name),
    UNIQUE (id, organization_id)
);

CREATE TABLE activities (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    -- Nome come compare nel modello Excel: è quello usato per la corrispondenza.
    name            text NOT NULL,
    unit            text NOT NULL CHECK (unit IN ('ore', 'sedute')),
    -- Riga occupata nel modello Excel dell'organizzazione.
    template_row    integer NOT NULL CHECK (template_row > 0),
    sort_order      integer NOT NULL DEFAULT 0,
    active          boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, name),
    UNIQUE (organization_id, template_row),
    UNIQUE (id, organization_id)
);

-- Un'attività può appartenere a più settori (es. "Pulizie/Manutenzione").
CREATE TABLE activity_sectors (
    organization_id uuid NOT NULL,
    activity_id     uuid NOT NULL,
    sector_id       uuid NOT NULL,
    PRIMARY KEY (activity_id, sector_id),
    FOREIGN KEY (activity_id, organization_id) REFERENCES activities (id, organization_id) ON DELETE CASCADE,
    FOREIGN KEY (sector_id, organization_id) REFERENCES sectors (id, organization_id) ON DELETE CASCADE
);

CREATE TABLE users (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    -- Salvata sempre in minuscolo; unica in tutto il sistema perché il login
    -- avviene con la sola email.
    email           text NOT NULL UNIQUE CHECK (email = lower(email)),
    first_name      text NOT NULL,
    last_name       text NOT NULL,
    role            text NOT NULL CHECK (role IN ('collaboratore', 'responsabile', 'amministratore')),
    password_hash   text NOT NULL,
    active          boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, organization_id)
);

-- Settori di cui un utente con ruolo "responsabile" è responsabile (Fase 4).
CREATE TABLE sector_managers (
    organization_id uuid NOT NULL,
    sector_id       uuid NOT NULL,
    user_id         uuid NOT NULL,
    PRIMARY KEY (sector_id, user_id),
    FOREIGN KEY (sector_id, organization_id) REFERENCES sectors (id, organization_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id, organization_id) REFERENCES users (id, organization_id) ON DELETE CASCADE
);

-- Una sola riga per utente + data + attività. La quantità è nell'unità
-- dell'attività: ore a passi di 0,5 oppure sedute intere.
CREATE TABLE time_entries (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    user_id         uuid NOT NULL,
    activity_id     uuid NOT NULL,
    entry_date      date NOT NULL,
    quantity        numeric(5, 1) NOT NULL CHECK (quantity > 0),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, entry_date, activity_id),
    FOREIGN KEY (user_id, organization_id) REFERENCES users (id, organization_id) ON DELETE CASCADE,
    FOREIGN KEY (activity_id, organization_id) REFERENCES activities (id, organization_id)
);

CREATE INDEX time_entries_org_date ON time_entries (organization_id, entry_date);

CREATE TABLE pt_sessions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    user_id         uuid NOT NULL,
    session_date    date NOT NULL,
    kind            text NOT NULL CHECK (kind IN ('acqua', 'palestra')),
    client_name     text NOT NULL CHECK (btrim(client_name) <> ''),
    created_at      timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (user_id, organization_id) REFERENCES users (id, organization_id) ON DELETE CASCADE
);

CREATE INDEX pt_sessions_user_date ON pt_sessions (user_id, session_date);

-- Orario tipo settimanale. weekday: 1 = lunedì … 7 = domenica (ISO 8601).
CREATE TABLE schedule_templates (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    user_id         uuid NOT NULL,
    weekday         smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
    activity_id     uuid NOT NULL,
    quantity        numeric(5, 1) NOT NULL CHECK (quantity > 0),
    UNIQUE (user_id, weekday, activity_id),
    FOREIGN KEY (user_id, organization_id) REFERENCES users (id, organization_id) ON DELETE CASCADE,
    FOREIGN KEY (activity_id, organization_id) REFERENCES activities (id, organization_id)
);

CREATE TABLE month_submissions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    user_id         uuid NOT NULL,
    year            smallint NOT NULL CHECK (year BETWEEN 2000 AND 2100),
    month           smallint NOT NULL CHECK (month BETWEEN 1 AND 12),
    status          text NOT NULL DEFAULT 'aperto' CHECK (status IN ('aperto', 'inviato')),
    submitted_at    timestamptz,
    UNIQUE (user_id, year, month),
    CHECK ((status = 'inviato') = (submitted_at IS NOT NULL)),
    FOREIGN KEY (user_id, organization_id) REFERENCES users (id, organization_id) ON DELETE CASCADE
);

-- La quantità deve rispettare l'unità dell'attività: multipli di 0,5 per le
-- ore, interi per le sedute. Il controllo dipende da un'altra tabella, quindi
-- serve un trigger e non basta un CHECK.
CREATE FUNCTION check_quantity_unit() RETURNS trigger AS $$
DECLARE
    activity_unit text;
BEGIN
    SELECT unit INTO activity_unit FROM activities WHERE id = NEW.activity_id;
    IF activity_unit = 'sedute' AND NEW.quantity <> trunc(NEW.quantity) THEN
        RAISE EXCEPTION 'quantità % non valida: le sedute devono essere un numero intero', NEW.quantity
            USING ERRCODE = 'check_violation';
    END IF;
    IF activity_unit = 'ore' AND NEW.quantity * 2 <> trunc(NEW.quantity * 2) THEN
        RAISE EXCEPTION 'quantità % non valida: le ore vanno a passi di mezz''ora', NEW.quantity
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER time_entries_quantity_unit
    BEFORE INSERT OR UPDATE OF quantity, activity_id ON time_entries
    FOR EACH ROW EXECUTE FUNCTION check_quantity_unit();

CREATE TRIGGER schedule_templates_quantity_unit
    BEFORE INSERT OR UPDATE OF quantity, activity_id ON schedule_templates
    FOR EACH ROW EXECUTE FUNCTION check_quantity_unit();
