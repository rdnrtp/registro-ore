-- Password dimenticata: chi ha creato un link per scegliere la password.
--   amministratore = Gestione → Utenti (creazione o nuovo link)
--   richiesta      = l'utente stesso, da "Password dimenticata?" nella pagina di accesso
--   terminale      = comando d'emergenza link-password sul server
-- I link esistenti sono tutti dell'amministratore.
ALTER TABLE user_invites
    ADD COLUMN origin text NOT NULL DEFAULT 'amministratore'
        CHECK (origin IN ('amministratore', 'richiesta', 'terminale'));
