-- Fase 2: inserimento delle ore.

-- Attività scelte da ciascun utente ("Le mie attività"): nella scheda di
-- inserimento compaiono per prime. Le altre restano comunque raggiungibili.
CREATE TABLE user_activities (
    organization_id uuid NOT NULL,
    user_id         uuid NOT NULL,
    activity_id     uuid NOT NULL,
    PRIMARY KEY (user_id, activity_id),
    FOREIGN KEY (user_id, organization_id) REFERENCES users (id, organization_id) ON DELETE CASCADE,
    FOREIGN KEY (activity_id, organization_id) REFERENCES activities (id, organization_id) ON DELETE CASCADE
);

-- Numero massimo di sedute di personal training per tipo (acqua, palestra) in
-- un mese: sono le righe disponibili nel modello Excel dell'organizzazione.
-- Lo imposta carica-organizzazione da organizzazione.json.
ALTER TABLE organizations
    ADD COLUMN pt_sessions_per_kind smallint NOT NULL DEFAULT 27 CHECK (pt_sessions_per_kind > 0);
