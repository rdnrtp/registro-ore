-- Fase 5: bacheca degli avvisi (comunicazione a senso unico, nessuna risposta).

-- Avviso pubblicato dall'amministratore, per tutti o per alcuni settori.
-- Appartengono a un settore gli utenti che hanno tra "Le mie attività"
-- un'attività di quel settore, più i responsabili del settore: i destinatari
-- si calcolano al momento, quindi chi entra in un settore vede anche gli
-- avvisi già pubblicati per quel settore.
CREATE TABLE announcements (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    title           text NOT NULL CHECK (btrim(title) <> ''),
    body            text NOT NULL CHECK (btrim(body) <> ''),
    important       boolean NOT NULL DEFAULT false,
    for_everyone    boolean NOT NULL,
    created_by      uuid NOT NULL,
    published_at    timestamptz NOT NULL DEFAULT now(),
    -- Ultima modifica dopo la pubblicazione (null = mai modificato).
    updated_at      timestamptz,
    updated_by      uuid,
    -- Ritirato: non più visibile ai destinatari.
    withdrawn_at    timestamptz,
    withdrawn_by    uuid,
    UNIQUE (id, organization_id),
    FOREIGN KEY (created_by, organization_id) REFERENCES users (id, organization_id),
    FOREIGN KEY (updated_by, organization_id) REFERENCES users (id, organization_id),
    FOREIGN KEY (withdrawn_by, organization_id) REFERENCES users (id, organization_id)
);

CREATE INDEX announcements_org_data ON announcements (organization_id, published_at DESC);

CREATE TABLE announcement_sectors (
    organization_id uuid NOT NULL,
    announcement_id uuid NOT NULL,
    sector_id       uuid NOT NULL,
    PRIMARY KEY (announcement_id, sector_id),
    FOREIGN KEY (announcement_id, organization_id) REFERENCES announcements (id, organization_id) ON DELETE CASCADE,
    FOREIGN KEY (sector_id, organization_id) REFERENCES sectors (id, organization_id) ON DELETE CASCADE
);

-- Testo di un avviso prima di ogni modifica: le modifiche restano visibili.
CREATE TABLE announcement_revisions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    announcement_id uuid NOT NULL,
    title           text NOT NULL,
    body            text NOT NULL,
    important       boolean NOT NULL,
    -- Destinatari in quel momento: 'tutti' oppure i nomi dei settori.
    audience        text[] NOT NULL,
    -- Quando era stato scritto questo testo (pubblicazione o modifica precedente).
    written_at      timestamptz NOT NULL,
    replaced_at     timestamptz NOT NULL DEFAULT now(),
    replaced_by     uuid NOT NULL,
    FOREIGN KEY (announcement_id, organization_id) REFERENCES announcements (id, organization_id) ON DELETE CASCADE,
    FOREIGN KEY (replaced_by, organization_id) REFERENCES users (id, organization_id)
);

CREATE INDEX announcement_revisions_avviso ON announcement_revisions (announcement_id, replaced_at);

-- Lettura di un avviso da parte di un utente (l'ultima volta che l'ha aperto).
CREATE TABLE announcement_reads (
    organization_id uuid NOT NULL,
    announcement_id uuid NOT NULL,
    user_id         uuid NOT NULL,
    read_at         timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (announcement_id, user_id),
    FOREIGN KEY (announcement_id, organization_id) REFERENCES announcements (id, organization_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id, organization_id) REFERENCES users (id, organization_id) ON DELETE CASCADE
);
