-- Fase 3: esportazione Excel.

-- Modello Excel di un'organizzazione: il file e la mappa delle sue celle
-- (layout) stanno nella stessa riga, perché un modello nuovo può avere celle
-- diverse. Ogni caricamento crea una nuova versione; quella in uso è la più
-- alta. Le versioni precedenti restano per consultazione.
CREATE TABLE excel_templates (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    version         integer NOT NULL CHECK (version > 0),
    file            bytea NOT NULL,
    -- Nome del file caricato, solo informativo.
    file_name       text NOT NULL,
    sha256          text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    layout          jsonb NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, version),
    UNIQUE (id, organization_id)
);
