-- Fase 5: quadro degli invii, esonero, promemoria automatici.

-- Utenti che non devono inviare il mese (per esempio un gestore che non
-- lavora a ore): esclusi dal quadro degli invii e dai promemoria.
ALTER TABLE users ADD COLUMN submission_exempt boolean NOT NULL DEFAULT false;

-- Promemoria a chi non ha ancora inviato il mese: nei giorni indicati (un
-- giorno oltre la fine di un mese corto vale come ultimo giorno) e, se
-- reminder_last_day, l'ultimo giorno del mese; dall'ora indicata, ora italiana.
ALTER TABLE organizations
    ADD COLUMN reminder_days smallint[] NOT NULL DEFAULT '{25,28}'
        CHECK (1 <= ALL (reminder_days) AND 31 >= ALL (reminder_days) AND cardinality(reminder_days) <= 31),
    ADD COLUMN reminder_last_day boolean NOT NULL DEFAULT true,
    ADD COLUMN reminder_hour smallint NOT NULL DEFAULT 9 CHECK (reminder_hour BETWEEN 0 AND 23);

-- Giri di promemoria già eseguiti: uno per organizzazione e giorno. La riga
-- si scrive nella stessa transazione delle notifiche, quindi un promemoria
-- non parte mai due volte, anche se l'API si riavvia. simulated = giro
-- lanciato con il comando simula-promemoria: non impedisce quello vero.
CREATE TABLE reminder_runs (
    organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    run_date        date NOT NULL,
    simulated       boolean NOT NULL DEFAULT false,
    year            smallint NOT NULL,
    month           smallint NOT NULL,
    recipients      integer NOT NULL DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, run_date, simulated)
);
