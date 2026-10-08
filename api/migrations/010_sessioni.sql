-- Sessioni di accesso registrate sul server. Ogni login (o uso di un link di
-- invito) crea una riga; il token nel cookie contiene il suo id ("sid").
-- Un token vale solo finché la sua riga esiste: "Esci" cancella la riga di
-- quel dispositivo, "Esci da tutti i dispositivi" tutte quelle dell'utente.
-- users.token_version resta: password reimpostata e disattivazione chiudono
-- comunque tutte le sessioni.
-- I token emessi prima di questa migrazione non hanno "sid": chi era già
-- collegato deve rifare l'accesso una volta.
CREATE TABLE user_sessions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    user_id         uuid NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    -- Stessa scadenza del token (JWT_DURATA_ORE): oltre, la riga è solo da pulire.
    expires_at      timestamptz NOT NULL,
    FOREIGN KEY (user_id, organization_id) REFERENCES users (id, organization_id) ON DELETE CASCADE
);

CREATE INDEX user_sessions_user ON user_sessions (user_id);
