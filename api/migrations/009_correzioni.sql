-- Correzioni rapide delle ore: annullare una precompilazione.

-- Ogni precompilazione applicata a un mese. Le righe che crea portano il suo
-- id (time_entries.prefill_run_id) finché nessuno le modifica a mano: così
-- si possono togliere tutte insieme senza toccare le correzioni fatte dopo.
CREATE TABLE prefill_runs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    user_id         uuid NOT NULL,
    year            smallint NOT NULL CHECK (year BETWEEN 2000 AND 2100),
    month           smallint NOT NULL CHECK (month BETWEEN 1 AND 12),
    created_at      timestamptz NOT NULL DEFAULT now(),
    -- Annullata: le sue righe ancora intatte sono state cancellate.
    undone_at       timestamptz,
    UNIQUE (id, organization_id),
    FOREIGN KEY (user_id, organization_id) REFERENCES users (id, organization_id) ON DELETE CASCADE
);

CREATE INDEX prefill_runs_utente_mese ON prefill_runs (user_id, year, month, created_at DESC);

-- Precompilazione che ha creato la riga; null = inserita o modificata a mano.
ALTER TABLE time_entries
    ADD COLUMN prefill_run_id uuid,
    ADD FOREIGN KEY (prefill_run_id, organization_id)
        REFERENCES prefill_runs (id, organization_id) ON DELETE SET NULL (prefill_run_id);

CREATE INDEX time_entries_precompilazione ON time_entries (prefill_run_id) WHERE prefill_run_id IS NOT NULL;
