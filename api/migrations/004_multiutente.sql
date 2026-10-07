-- Fase 4: multiutente, ruoli, inviti, configurazione dall'app.

-- Un utente creato dall'amministratore non ha ancora una password: la sceglie
-- lui aprendo il link di invito.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- Versione delle sessioni: è scritta nel token di accesso e aumenta quando la
-- password viene reimpostata o l'utente disattivato. I token con una versione
-- diversa non valgono più.
ALTER TABLE users ADD COLUMN token_version integer NOT NULL DEFAULT 0;

-- Nome della riga nel modello Excel, separato dal nome mostrato nell'app.
-- L'amministratore può rinominare un'attività (name) senza toccare il modello:
-- l'esportazione confronta template_label con il testo della riga, e il file
-- mostra sempre il nome scritto nel modello.
ALTER TABLE activities ADD COLUMN template_label text;
UPDATE activities SET template_label = name;
ALTER TABLE activities ALTER COLUMN template_label SET NOT NULL;
ALTER TABLE activities ADD CONSTRAINT activities_template_label_key UNIQUE (organization_id, template_label);

-- Link di invito (anche per reimpostare la password): monouso e con scadenza.
-- Si salva solo l'hash SHA-256 del codice: chi legge il database non può usarlo.
CREATE TABLE user_invites (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    user_id         uuid NOT NULL,
    token_hash      text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    created_by      uuid,
    created_at      timestamptz NOT NULL DEFAULT now(),
    expires_at      timestamptz NOT NULL,
    used_at         timestamptz,
    FOREIGN KEY (user_id, organization_id) REFERENCES users (id, organization_id) ON DELETE CASCADE
);

CREATE INDEX user_invites_user ON user_invites (user_id);

-- Traccia delle azioni amministrative: chi ha fatto cosa e quando.
-- actor_id è null per i comandi da terminale.
CREATE TABLE audit_log (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    actor_id        uuid,
    action          text NOT NULL,
    target_type     text,
    target_id       uuid,
    details         jsonb NOT NULL DEFAULT '{}',
    created_at      timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (actor_id, organization_id) REFERENCES users (id, organization_id)
);

CREATE INDEX audit_log_org_data ON audit_log (organization_id, created_at DESC);
