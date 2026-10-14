# Registro ore

Web app per registrare le ore di lavoro dei collaboratori di un impianto sportivo
e generare il file Excel mensile che l'impianto richiede. Primo impianto: una
piscina chiamata "BV". L'app deve poter essere adottata in futuro da altri impianti.

Rispondi all'utente in italiano.

## Contesto

Oggi ogni collaboratore compila a mano un Excel mensile: griglia con le attività
sulle righe e i giorni del mese sulle colonne, più due tabelline per le sedute di
personal training (palestra e acqua). Il file va inviato per email alla segreteria
entro l'ultimo giorno del mese, con in copia il responsabile del proprio settore.
Se uno ritarda, slittano gli stipendi di tutti. L'app deve rendere comodo
l'inserimento dal telefono e produrre un file identico nell'aspetto all'originale.

## Decisioni prese

- Stack: frontend React, API Node.js + Express, database PostgreSQL.
- Tutto in Docker Compose fin dall'inizio: la produzione sarà un singolo VPS Linux
  con lo stesso Compose. Sviluppo su un PC Windows.
- Multi-organizzazione dal primo giorno: attività, settori, email dei responsabili
  e modello Excel (file + mappa delle celle) sono configurazione di
  un'organizzazione, mai valori scritti nel codice.
- Autenticazione JWT + bcrypt. Utente e organizzazione si ricavano sempre dal
  token, mai dai dati inviati dal client; ruolo e stato attivo dal database a
  ogni richiesta. Nessuna registrazione pubblica: l'amministratore crea
  l'utente e gli manda un link di invito personale (monouso, con scadenza) con
  cui sceglie la password. Per la password dimenticata: "Password
  dimenticata?" nella pagina di accesso (link per email, monouso, 60
  minuti) oppure, in emergenza, il comando `link-password` sul server.
- Sessioni registrate sul server (`user_sessions`, durata 7 giorni): "Esci"
  invalida davvero il token di quel dispositivo (PC condivisi, es. reception);
  "Esci da tutti i dispositivi" chiude ogni sessione dell'utente.
- Ruoli, che si sommano (tutti registrano le proprie ore): collaboratore (solo
  le proprie), responsabile di settore (in più vede in sola lettura le righe
  dei suoi settori nei mesi degli altri), amministratore (in più vede tutto in
  sola lettura, scarica l'Excel di chiunque, gestisce la configurazione).
  Nessuno modifica le registrazioni di un altro, nemmeno l'amministratore.
  Deve restare sempre almeno un amministratore attivo.
- Dalla Fase 4 la configurazione di un impianto si modifica dall'app;
  `carica-organizzazione` serve solo a creare un impianto nuovo.
- Il nome di un'attività nell'app (`name`) è separato dal nome della sua riga
  nel modello (`template_label`): l'amministratore può rinominarla, ma nel file
  Excel resta il nome scritto nel modello. Per cambiare quello serve un nuovo
  modello.
- Excel generato sul server con ExcelJS partendo dal modello originale, per
  conservarne formattazione, celle unite e testo del regolamento.
- App installabile (PWA): manifest generato da `vite.config.js` (nome
  provvisorio "Presenze" in `NOME_APP`, solo lì), icone provvisorie in
  `frontend/public/icone/` (`scripts/genera-icone.mjs`), service worker
  `public/sw.js` che non mette in cache nulla (solo pagina "Nessuna
  connessione"). Aggiornamento dopo un rilascio: vedi "App installabile".
- Tasto Indietro: chiude la finestra aperta; da una sezione torna al Mese;
  dal Mese esce. Vedi `navigazione.js`.
- Ogni utente ha un "orario tipo" settimanale che precompila il mese; poi corregge
  solo le eccezioni.
- Ore a passi di mezz'ora.
- Il modello contiene indirizzi email reali: repository privato, e i dati reali di
  BV (modello, file generati) non vanno in file tracciati da git. Vedi `.gitignore`.
- Fase 5: l'app invia le email via SMTP (nodemailer), sempre attraverso una coda
  nel database (`email_outbox`) elaborata dall'API in sottofondo, mai dentro la
  richiesta dell'utente. In sviluppo la posta va alla casella finta Mailpit del
  Compose; in produzione a un servizio SMTP generico (porta 587 con STARTTLS
  obbligatorio, o 465): per BV Brevo (`smtp-relay.brevo.com:587`, mittente
  `notifiche@apetris.com`; Brevo accetta solo IP autorizzati).
- Notifiche agli utenti (promemoria, solleciti, avvisi, riaperture) solo
  attraverso `notifica()` (`src/notifiche.js`), che le salva e le consegna con
  ogni canale di `CANALI`: oggi l'email; dopo la messa online il push sarà un
  secondo canale, senza toccare chi notifica.
- Fase 6 (produzione): un solo VPS Ubuntu LTS nell'UE con `compose.prod.yml`
  (distinto da quello di sviluppo) e Caddy davanti per l'HTTPS automatico.
  Database di produzione che parte vuoto: nessun dato di sviluppo trasferito.
  Tutto ciò che si fa sul server è uno script in `deploy/`, documentato passo
  per passo in `RUNBOOK.md` (scritto per chi non è sistemista).
- Backup: `pg_dump` cifrato con age a chiave pubblica; la chiave privata non sta
  sul server (gestore di password + carta). Copia fuori dal server con rclone
  (S3 o SFTP; per BV Backblaze B2 via S3, bucket `registro-apetris`),
  configurata solo da variabili `RCLONE_CONFIG_REMOTO_*` (senza virgolette:
  le legge `docker --env-file`). Email ad `ALLARMI_EMAIL` se fallisce.
- Accesso del server al repository privato con una deploy key in sola lettura.
- Un mese inviato conserva il file esattamente come è partito
  (`month_submission_versions`); dopo una riapertura il reinvio è una nuova
  versione e l'email dice che sostituisce la precedente.

## Struttura

- `docker-compose.yml`: servizi `db` (PostgreSQL 17), `api` (Node/Express),
  `web` (React compilato, servito da nginx che inoltra `/api` all'API),
  `mailpit` (casella di posta finta, pagina web su http://localhost:8025, solo
  da questo PC), `api-test` e `e2e` (profilo `test`, avviati solo con
  `docker compose run`).
  Configurazione in `.env` (non tracciato), modello in `.env.example`.
- `compose.prod.yml` (produzione, progetto `registro-ore-prod`): `db` senza
  porte, `api` (`AMBIENTE=produzione`, `TRUST_PROXY=2`, `cap_drop: ALL`),
  `web`, `caddy` (porte 80/443, `deploy/Caddyfile`: HTTPS Let's Encrypt per
  `DOMINIO`, HSTS, Permissions-Policy, COOP/CORP, noindex, niente
  Server/Via; le altre intestazioni le mette `frontend/nginx.conf`). Controlli
  di salute in catena (db → api → web → caddy), `restart: unless-stopped`,
  log `local` 5×10 MB, `no-new-privileges`. Variabili in `.env.production`
  (non tracciato; modello commentato in `.env.production.example`, dove i
  valori da cambiare contengono `SOSTITUISCI`). Si usa sempre con
  `deploy/compose.sh` (passa file ed env; `ENV_FILE=` per un altro file).
- `deploy/`: script bash per il server (controllati con ShellCheck), con
  `comune.sh` (`dc`, `leggi_var`, `attendi_app`, `avviso_email`):
  `prepara-server.sh` (root, Ubuntu nuovo: utente, SSH solo chiave, ufw
  22/80/443, fail2ban, unattended-upgrades con riavvio 04:30, Docker,
  Europe/Rome, swap), `genera-segreti.sh`, `crea-chiave-backup.sh`,
  `installa-servizi.sh` (timer systemd `registro-ore-backup` alle 02:30),
  `backup.sh [giornaliero|rilascio|manuale]` (cartelle `giornalieri`,
  `settimanali`, `mensili` = 7/4/6, `rilasci` = 5, `manuali` = 10, in
  `BACKUP_DIR`; settimanali e mensili sono hard link; `rclone sync` con
  `--max-delete 10`), `ripristina.sh` (prova in `<db>_prova` con confronto
  dei conteggi, oppure `--sostituisci`), `scarica-backup.sh`, `rilascia.sh`
  (backup, `git checkout --detach` di `origin/HEAD` o del commit indicato,
  build, migra, up, controllo HTTPS; annotato in `.rilasci.log`),
  `torna-indietro.sh [--con-database]`.
- `api/`: `src/app.js` (Express; rotte pubbliche, poi `autenticato` per tutto
  il resto di `/api`), `src/config.js` (variabili d'ambiente; con
  `AMBIENTE=produzione` `controllaProduzione` rifiuta l'avvio se una
  variabile necessaria manca o contiene un valore di esempio), `src/stato.js`
  (`/api/stato`), `src/auth.js` (JWT, middleware `autenticato` e
  `richiediRuolo`), `src/routes/` (`auth`; `inviti` = link di invito,
  pubblici; `organizzazione` = elenco attività e settori; `registro` = ore,
  orario tipo, mie attività, sedute PT; `esportazione` = proprio file Excel e
  `fileExcelMese`; `collaboratori` = viste in sola lettura sui mesi degli
  altri, più riapertura e sollecito; `invio` = riepilogo e invio del proprio
  mese; `bacheca` = avvisi; `utenti`, `configurazione` (attività, settori,
  organizzazione e promemoria, registro delle modifiche), `modello` e `posta`
  (email in uscita) = gestione, solo amministratore),
  `src/excel/` (`layout.js` = mappa delle celle e sua validazione,
  `foglio-mensile.js` = generatore, `modello.js` = caricamento di un modello:
  righe, confronto con le attività, prova di generazione, nuova versione;
  usato dal comando e dall'app), `src/inviti.js` (creazione dei link e
  loro email), `src/posta/` (`coda.js` = `accodaEmail`, `elaboraCoda`;
  `trasporto.js` = nodemailer; `messaggi.js` = testi di invito e invio del
  mese), `src/notifiche.js` (`notifica`, canali), `src/invio-mese.js`
  (destinatari e versioni inviate), `src/promemoria.js`, `src/avvio.js`
  (lavori in sottofondo: coda email e promemoria, avviati da `server.js`),
  `src/tempo.js` (ora italiana),
  `src/traccia.js` (`audit_log`), `src/errori.js` (`ErroreHttp`),
  `src/validazione.js` (uuid, date, mesi, testi, email), `src/db.js`
  (`transazione`), `src/cli/` (comandi da terminale; `avviso-sistema` = email
  diretta via SMTP ad `ALLARMI_EMAIL`, senza coda, usata da `deploy/backup.sh`;
  `link-password` = link d'emergenza per scegliere la password, stampato),
  `migrations/NNN_nome.sql`, `test/` (node:test + supertest).
- `frontend/`: Vite + React, nessuna libreria oltre a React. `src/App.jsx`
  sceglie tra `Privacy` (`#/privacy`, informativa in bozza, con o senza
  accesso, collegata da accesso, invito, app ed email di invito), `Invito`
  (`#/invito/<codice>`, anche con un accesso già fatto), `PasswordDimenticata`
  (`#/password-dimenticata`, senza accesso), `Login` e `Home`, più
  `AvvisoAggiornamento` (sempre); `Home.jsx` = barra delle sezioni in basso (secondo il
  ruolo), "Esci" in alto (pannello: questo dispositivo / tutti i dispositivi;
  se la richiesta fallisce mostra l'errore invece di fingere l'uscita, perché
  il cookie httpOnly lo cancella solo il server) e pagine scelte con l'ancora dell'indirizzo, letta da
  `navigazione.js` (`usaRotta`; `usaGuardiaModifiche` chiede conferma prima
  di lasciare una pagina con modifiche non salvate, usata da `OrarioTipo`).
  Cronologia del browser (`navigazione.js`): tenuta sempre uguale alla
  "catena" della pagina (`catena()`: `#/` → sezione → pagina interna, es.
  `#/gestione/utenti` o il mese di un collega) più una voce per ogni
  finestra aperta (`usaChiusuraIndietro`, usata da `Foglio` e dalla
  selezione dei giorni; `conIndietro={false}` per un `Foglio` che è già una
  pagina, come `#/bacheca/<id>`). Ogni `<a href="#/…">` passa da `naviga()`
  (clic intercettati su `document`); mai `window.location.hash = …`. Le
  operazioni sulla cronologia vanno in fila (`history.go` è asincrono).
  All'apertura `avviaNavigazione()` (in `main.jsx`) costruisce la catena;
  le voci dell'app hanno `history.state.ro`, così dopo una ricarica non si
  ricostruisce. Pagine:
  `#/` = `Mese.jsx`, `#/attivita` = `MieAttivita.jsx`, `#/orario` =
  `OrarioTipo.jsx`, `#/collaboratori/AAAA/M` = `Collaboratori.jsx`,
  `#/collaboratori/<id>/AAAA/M` = `MeseCollaboratore.jsx` (sola lettura),
  `#/bacheca[/<id>]` = `Bacheca.jsx` (contatore dei non letti nella barra),
  `#/gestione[/utenti|attivita|settori|bacheca|impianto|email|registro]` =
  `Gestione.jsx` e `Gestione*.jsx`, `RegistroModifiche.jsx`. `VistaMese.jsx`
  = parti comuni alle viste del mese (elenco dei giorni, totali, `salvaFile`);
  `StatoInvio.jsx` = "Storico degli invii" (stato attuale, ogni versione con
  data e ora, sostituzione, motivazione della riapertura, file da scaricare),
  in cima alla vista del mese, sopra i giorni: nel proprio mese e, solo per
  l'amministratore, nel mese di un collega. Testata del mese (fissa in alto):
  titolo con le frecce e `.totale-mese` (ore in grande, sedute, stato,
  "Oggi"); sotto, `.comandi-mese` (pulsanti alti uguali, 48 px): "Invia il
  mese" (verde) + "Altro", che apre un `Foglio` con Scarica Excel, Precompila
  il mese, "Annulla precompilazione" (solo se c'è qualcosa da annullare) e
  "Seleziona giorni" (modalità di selezione di `ElencoGiorni` con
  `selezionati`, barra in basso con "Tutto il mese", "Svuota", "Fine"); mese
  inviato = solo "Scarica Excel". Stessa testata nel mese di un collega e
  nell'elenco dei collaboratori. Aree di tocco di almeno 44 px (controllate
  dagli screenshot di `e2e`; eccezioni: caselle di spunta dentro etichette
  alte, frecce ↑↓ di Gestione → Attività a 38 px). "Svuota giorno" nella
  scheda del giorno.
  CSS: le regole di `.elenco-persone a, button` rendono ogni elemento largo
  quanto la riga; per un pulsante dentro una riga (es. "Sollecita" nel quadro)
  vanno annullate esplicitamente.
  `SchedaGiorno.jsx`, la precompilazione e le schede di gestione usano
  `Foglio.jsx` (pannello dal basso, si chiude anche con Indietro); `EditorQuantita.jsx` (contatori − valore
  + ) serve sia alla scheda del giorno sia all'orario tipo; `SedutePt.jsx`
  (aggiunta, modifica, eliminazione); `date.js` (date come stringhe
  'AAAA-MM-GG', oggi = fuso Europe/Rome); `api.js` (un 401 riporta al login;
  `excelMese`/`excelDi` scaricano il file come blob; `caricaModello` manda il
  file come corpo della richiesta).
- `e2e/`: prove nel browser con Playwright (Chromium come Chrome su
  Android, immagine `mcr.microsoft.com/playwright`, stessa versione di
  `@playwright/test`) contro il frontend compilato servito da `web`, con
  l'API simulata (`test/api-finta.js`, impianto finto, oggi = 14/10/2026):
  `indietro.spec.js`, `installabile.spec.js`, `password.spec.js`,
  `schermate.spec.js` (screenshot a 360/390/412/1280 px in
  `e2e/risultati/schermate/`, non tracciata; niente scorrimento
  orizzontale né errori nella pagina; `piccoli-*.json` = elementi sotto i
  44 px). `inoltro.js` porta `localhost:8088` a `web:80` (il service worker
  vuole un'origine sicura). Il tasto Indietro "di sistema" di Android non si
  può simulare: `page.goBack()` equivale al pulsante del browser.
- `seed/<org>/`: configurazione di un'organizzazione per `carica-organizzazione`:
  `organizzazione.json` (tracciato), `contatti.json` (email reali, NON
  tracciato; formato in `contatti.example.json`), `abbinamenti.json`
  (attività → settori; se manca gli abbinamenti non vengono caricati).
  Montata nel container `api` in `/dati/seed`; `modello/` in `/dati/modello`
  (anche in `api-test`, per i test dell'esportazione).

## Comandi (da PowerShell, nella radice del progetto)

- Avvio: `docker compose up -d --build` → http://localhost:8088 (`HTTP_PORT`).
- Migrazioni: `docker compose exec api npm run migra` (subito dopo l'avvio: fino
  ad allora i lavori in sottofondo scrivono errori nel log, poi riprendono).
- Casella di posta finta: http://localhost:8025 (`MAILPIT_PORT`). Tutte le
  email dell'app arrivano lì; non ne esce nessuna. I link nelle email usano
  `APP_URL` (predefinito http://localhost:8088).
- Promemoria di un giorno a scelta: `docker compose exec api npm run
  simula-promemoria -- --org bv --data 2026-10-25` (senza `--data` = oggi). Fa
  il giro di quel giorno come se fosse passata l'ora; i giri simulati sono
  separati da quelli veri, e lo stesso giorno simulato due volte non riparte.
- Crea un impianto nuovo: `docker compose exec api npm run carica-organizzazione -- bv`
  (legge le attività dal modello Excel e salva modello + mappa nel database).
  Su un impianto già esistente si rifiuta, perché cancellerebbe le modifiche
  fatte dall'app; con `--sovrascrivi` in fondo riporta settori, email,
  abbinamenti, nomi/unità/ordine delle attività, indirizzo di invio e modello
  a quelli dei file (utenti, ore e attività attive o no restano).
- Primo amministratore: `docker compose exec api npm run crea-admin -- --org bv
  --email ... --nome ... --cognome ...` (password chiesta a terminale; serve il
  TTY, quindi niente `-T`). Gli altri utenti si creano dall'app (Gestione →
  Utenti), con il link di invito.
- Aprire l'app dal telefono (stessa rete): `http://<IP del PC>:8088`, con una
  regola del firewall di Windows in entrata per la porta TCP 8088 (profilo
  Privato).
- Prove nel browser: `docker compose up -d --build web` (se il frontend è
  cambiato), poi `docker compose run --rm --build e2e`.
- Link d'emergenza per la password (email non funzionanti, amministratore
  bloccato fuori): `docker compose exec api npm run link-password -- --email
  ... [--minuti 60]`. Stampa il link, non manda email, va nel registro.
- Icone provvisorie: `cd frontend && node scripts/genera-icone.mjs`.
- Test: `docker compose run --rm --build api-test` (usa il database
  `registro_ore_test`, creato e azzerato dai test; rifiutano nomi senza `_test`).
  I test dell'esportazione richiedono `modello/modello_bv.xlsx` sul PC.
- Sviluppo frontend senza Docker: `cd frontend && npm run dev` (inoltra `/api` a
  `API_URL`, predefinito http://localhost:3000).
- Produzione: tutto in `RUNBOOK.md`. Sul server si lavora in `/opt/registro-ore`
  con `./deploy/compose.sh …` (non `docker compose` da solo).
- Prova dello stack di produzione su questo PC: `.env.prova-locale` (non
  tracciato) con `DOMINIO=localhost` (Caddy usa un certificato locale), da Git
  Bash: `ENV_FILE=.env.prova-locale ./deploy/compose.sh up -d --build --wait`.
  Occupa le porte 80 e 443; spegnere con `… compose.sh down -v`. Gli script di
  `deploy/` sono per Linux: sul PC si provano in un container (age, docker CLI).

## Schema del database (`api/migrations/001_schema_iniziale.sql`)

- `organizations` (slug, nome, `submission_email` = indirizzo della segreteria)
- `sectors` (nome, `manager_emails` text[]: un settore può avere più responsabili)
- `activities` (nome come nel modello, `unit` 'ore' | 'sedute', `template_row`
  = riga nel modello Excel, `sort_order`, `active`)
- `activity_sectors`: un'attività può stare in più settori
- `users` (email unica globale e in minuscolo, ruolo, `active`)
- `sector_managers`: settori di cui un responsabile è responsabile (Fase 4)
- `time_entries`: una sola riga per utente + data + attività; `quantity`
  numeric > 0 nell'unità dell'attività. Un trigger impone passi di 0,5 per le
  ore e interi per le sedute (vale anche per `schedule_templates`).
- `pt_sessions`: utente, data, tipo (acqua | palestra), nome cliente
- `schedule_templates`: utente, `weekday` 1 = lunedì … 7 = domenica, attività, quantità
- `month_submissions`: utente, anno, mese, stato ('aperto' | 'inviato'), data di invio

Migrazione `002_inserimento_ore.sql`:

- `user_activities`: le attività scelte dall'utente ("Le mie attività").
- `organizations.pt_sessions_per_kind`: sedute PT per tipo in un mese = righe
  del modello (27 per BV); lo imposta `carica-organizzazione` dalla mappa
  (`modello.sedutePt.primaRiga..ultimaRiga` in `organizzazione.json`). Va
  tenuto allineato a ogni nuovo modello caricato (anche dall'app, Fase 4).

Migrazione `003_modello_excel.sql`:

- `excel_templates`: modello Excel dell'organizzazione = file (`bytea`) +
  mappa delle celle (`layout` jsonb) nella stessa riga, con `version`
  crescente per organizzazione; quello in uso è la versione più alta. Le
  versioni vecchie restano. `sha256` del file per riconoscere i duplicati.

Migrazione `004_multiutente.sql`:

- `users.password_hash` può essere null (utente creato, invito non ancora
  usato); `users.token_version` = versione delle sessioni, scritta nel token
  (`ver`): aumenta quando la password viene reimpostata o l'utente
  disattivato, e i token con una versione diversa non valgono più.
- `activities.template_label` = testo della riga nel modello (unico per
  organizzazione), separato da `name` = nome nell'app.
- `user_invites`: link di invito, solo l'hash SHA-256 del codice,
  `expires_at` (`INVITO_DURATA_ORE`, predefinito 72), `used_at`. Un nuovo link
  cancella quelli non usati dello stesso utente; la disattivazione anche.
- `audit_log`: azioni amministrative (`actor_id` null = comando da
  terminale), `action` (`utente.creato`, `utente.ruolo_cambiato`,
  `utente.disattivato`, `utente.link_creato`, `attivita.modificata`,
  `settore.*`, `organizzazione.modificata`, `modello.caricato`, …),
  `details` jsonb con i valori prima/dopo. Scritta nella stessa transazione
  della modifica (`src/traccia.js`).

Migrazione `005_posta.sql`:

- `notifications`: notifica a un utente (tipo, titolo, testo, link
  dell'app), `dedup_key` unica per utente (stesso promemoria mai due volte).
- `email_outbox`: coda delle email. Stati `in_attesa` → `in_invio` →
  `inviata` | `in_attesa` (nuovo tentativo) | `errore`. `attempts`,
  `next_attempt_at`, `locked_until`, `last_error`; `references_id` = email
  precedente (In-Reply-To); `attachment_submission_id` = file allegato (un
  invio del mese, non copiato); `sensitive` = contiene un link di invito, il
  testo viene cancellato dopo l'invio.

Migrazione `006_invio_mese.sql`:

- `month_submission_versions`: ogni invio di un mese = `version` 1, 2, …,
  `file` (bytea, esattamente quello spedito), `file_name`, `file_sha256`,
  `template_version`, `to_address`, `cc_addresses`, totali, `submitted_at`;
  `reopened_at/by`, `reopen_reason` sulla versione riaperta. Un trigger
  impedisce di cambiare file e destinatari. Lo stato corrente resta in
  `month_submissions` (riaperto = `aperto` con versioni).

Migrazione `007_promemoria.sql`:

- `users.submission_exempt` = non deve inviare il mese (fuori dal quadro e
  dai promemoria).
- `organizations.reminder_days` (predefinito {25,28}), `reminder_last_day`
  (true), `reminder_hour` (9, ora italiana).
- `reminder_runs`: giro di promemoria fatto (organizzazione, giorno,
  `simulated`), scritto nella stessa transazione delle notifiche.

Migrazione `008_bacheca.sql`:

- `announcements` (titolo, testo, `important`, `for_everyone`,
  `published_at`, `updated_at` = ultima modifica, `withdrawn_at` = ritirato),
  `announcement_sectors`, `announcement_revisions` (testo prima di ogni
  modifica, con i destinatari di allora), `announcement_reads` (ultima
  apertura; letto = aperto dopo l'ultima modifica).

Migrazione `009_correzioni.sql`:

- `prefill_runs`: ogni precompilazione che ha riempito almeno un giorno
  (utente, anno, mese, `undone_at` = annullata).
- `time_entries.prefill_run_id`: precompilazione che ha creato la riga; torna
  null quando la quantità viene cambiata a mano (un salvataggio con lo stesso
  valore non conta). Le righe inserite a mano non ce l'hanno.

Migrazione `010_sessioni.sql`:

- `user_sessions` (utente, `created_at`, `expires_at`): una riga per accesso;
  il token vale solo finché la riga esiste. I token emessi prima della 010
  (senza `sid`) non valgono più: chi era collegato rifà l'accesso una volta.

Migrazione `011_password_dimenticata.sql`:

- `user_invites.origin`: chi ha creato il link (`amministratore` |
  `richiesta` = "Password dimenticata?" | `terminale` = `link-password`).
  Finisce nei dettagli della traccia quando il link viene usato.

Chiavi primarie UUID. Ogni tabella con dati di un impianto ha `organization_id`;
le chiavi esterne tra tabelle dell'organizzazione sono composte
`(id, organization_id)`, così il database rifiuta collegamenti tra
organizzazioni diverse. Nuove modifiche allo schema: nuovo file di migrazione,
mai modificare uno già applicato.

## Regole per l'API

- `req.utente` = `{ id, organizzazioneId, ruolo }`: id e organizzazione dal JWT
  (cookie httpOnly `registro_ore_sessione`, SameSite=Lax; contiene `sub`,
  `org`, `ver`, `sid`), ruolo dal database. `autenticato` (in `app.js`, per tutto
  `/api` tranne `/api/auth` e `/api/inviti`) legge a ogni richiesta la riga
  dell'utente e quella della sessione: disattivato, organizzazione diversa,
  `token_version` diversa, sessione cancellata o scaduta = 401 subito.
- Sessioni (`src/auth.js`): un token si emette solo con `apriSessione` (login,
  link di invito), che crea la riga in `user_sessions` e pulisce le scadute
  dell'utente. `POST /api/auth/logout` (pubblica) cancella la sessione del
  cookie (`chiudiSessione`; token non valido = nessun effetto, sempre 200).
  `POST /api/auth/esci-ovunque` (autenticata) cancella tutte quelle
  dell'utente → `{ ok, sessioni_chiuse }`. Anche nuova password dal link e
  disattivazione cancellano le sessioni dell'utente (oltre a `token_version`). Mai leggere utente, ruolo od organizzazione da corpo, query o
  parametri.
- In produzione (`config.produzione`): cookie sempre `Secure`; le richieste
  che modificano (non GET/HEAD/OPTIONS) con un'intestazione `Origin` diversa da
  `APP_URL` = 403 (`stessaOrigine` in `app.js`).
- `GET /api/salute` (controllo di Docker: database) e `GET /api/stato`
  (monitoraggio esterno: database, email in attesa da oltre 30 minuti, lavori
  in sottofondo fermi da oltre 5 minuti; 200 o 503, mai dati) sono pubbliche.
- Ogni query filtra per `req.utente.organizzazioneId`. Un id di un'altra
  organizzazione (o non valido) risponde 404, come se non esistesse.
- Ogni nuova rotta che legge dati per id va coperta in `test/isolamento.test.js`.
- Login: bcrypt (bcryptjs, costo 12), stesso messaggio per email inesistente e
  password errata; limite ai tentativi falliti per IP+email e per IP
  (express-rate-limit in memoria: va bene con una sola istanza dell'API).
- `TRUST_PROXY` = numero di proxy davanti all'API (1 = nginx del frontend), serve
  a ricavare l'IP reale per il limite di login.
- Messaggi di errore in JSON `{ errore: "..." }`, in italiano. Nelle rotte si
  lancia `new ErroreHttp(stato, messaggio)` (Express 5 gestisce le rotte async).
- Dati personali (ore, orario tipo, mie attività, sedute PT): le modifiche
  sono sempre e solo su quelli di `req.utente.id`, anche per l'amministratore;
  nessuna rotta di modifica accetta un utente come parametro. Le uniche rotte
  con l'id di un altro utente sono le letture di `collaboratori.js` e la
  gestione degli utenti (`utenti.js`, che non tocca le registrazioni).
- Ogni azione dell'amministratore che cambia configurazione o utenti scrive
  in `audit_log` con `traccia()`, nella stessa transazione.
- Le modifiche ai dati personali avvengono in `transazione` dopo
  `SELECT ... FROM users ... FOR NO KEY UPDATE` sulla riga dell'utente: le
  richieste dello stesso utente vanno in fila, così i controlli (24 ore al
  giorno, limite sedute, mese inviato) non si aggirano con richieste parallele.
- Mese con `month_submissions.status = 'inviato'`: ogni modifica di ore e
  sedute di quel mese risponde 409. Il blocco è nell'API, non nel database.
- Email: solo con `accodaEmail` (o `notifica`), nella stessa transazione della
  modifica che le causa; mai `sendMail` dentro una richiesta. Nei testi il
  minimo di dati personali (nome, mese; niente ore giorno per giorno né
  clienti). I link usano `config.appUrl`, mai l'host della richiesta.
- Riapertura, invio e sollecito bloccano la riga dell'utente interessato
  (`FOR NO KEY UPDATE`) come le modifiche alle ore: non si incrociano.

## API della Fase 2 (`src/routes/registro.js`)

- `GET /api/mese/:anno/:mese` → `{ stato, max_sedute_pt_per_tipo,
  registrazioni: [{ data, attivita_id, quantita }], sedute_pt: [...] }`.
- `PUT /api/giorni/:data` `{ voci: [{ attivita_id, quantita }] }`: imposta le
  attività indicate, lascia le altre; 0 elimina la riga. Ore a passi di 0,5,
  sedute intere, 0–24 per voce, al massimo 24 ore (solo unità "ore") nel
  giorno. Un'attività non attiva non accetta righe nuove.
- `GET|POST /api/mese/:anno/:mese/precompilazione`: anteprima / applicazione
  dell'orario tipo ai giorni senza nessuna registrazione (le sedute PT non
  contano). Riempie anche i giorni futuri e i festivi, se l'orario li prevede.
  Le righe create portano l'id della precompilazione (`prefill_run_id`).
- `GET|POST /api/mese/:anno/:mese/annulla-precompilazione`: anteprima `{ giorni,
  righe, ore, sedute }` / cancellazione delle righe ancora intatte
  dell'ultima precompilazione non annullata del mese (409 se non ce ne sono).
  `GET /api/mese` ha `precompilazione_annullabile` = giorni che toccherebbe.
- `POST /api/mese/:anno/:mese/svuota` `{ giorni: ['AAAA-MM-GG', …] }` (1–31
  date di quel mese): cancella tutte le quantità di quei giorni, non le sedute
  PT con cliente; risponde `{ giorni, righe, ore, sedute }` effettivamente tolti.
  Usata sia da "Svuota giorno" sia dalla selezione di più giorni.
- `GET|PUT /api/orario-tipo` `{ voci: [{ giorno_settimana: 1..7, attivita_id,
  quantita }] }`: il PUT sostituisce tutto l'orario.
- `GET|PUT /api/mie-attivita` `{ attivita: [id] }`: il PUT sostituisce l'elenco.
- `POST /api/sedute-pt` `{ data, tipo: 'acqua'|'palestra', cliente }`,
  `DELETE /api/sedute-pt/:id`. Non collegate alle righe "PT …" della griglia.
- Errori: 400 dati non validi o limiti superati, 404 attività o seduta
  inesistente o di altri, 409 mese inviato.

## API della Fase 4

Pubbliche (`src/routes/inviti.js`, con limite ai tentativi falliti per IP):

- `GET /api/inviti/:codice` → `{ nome, cognome, email, organizzazione,
  scopo: 'nuovo'|'reimposta' }`; 404 codice inesistente o utente disattivato,
  410 già usato o scaduto.
- `POST /api/inviti/:codice` `{ password }` (10–72 byte): imposta la
  password, consuma il link, aumenta `token_version` (chiude le altre
  sessioni) ed effettua l'accesso. Due richieste contemporanee: ne riesce una.

- `POST /api/auth/password-dimenticata` `{ email }` (in `routes/auth.js`):
  risposta sempre `{ ok, durata_minuti }`, che l'email esista o no (400 solo
  per un'email non valida). Utente attivo: nuovo link (`origin = richiesta`,
  `RESET_DURATA_MINUTI`, predefinito 60; annulla i link non usati) per
  email, traccia `utente.reset_richiesto` (autore nullo, `origine:
  'richiesta'`, mostrato come "Pagina di accesso"). Disattivato: nessuna
  email, traccia `utente.reset_ignorato`. Limiti a tutte le richieste (non
  solo le fallite): `RESET_MAX_PER_EMAIL` (3) per email da qualsiasi IP e
  `RESET_MAX_PER_IP` (10) per IP, in `RESET_FINESTRA_MINUTI` (60); oltre =
  429. Usare il link (`POST /api/inviti/:codice`) chiude le sessioni come
  sempre; la traccia `utente.password_reimpostata`/`attivato` ha `origine`.

Responsabile e amministratore (`src/routes/collaboratori.js`, sola lettura):

- `GET /api/collaboratori/:anno/:mese` → `{ collaboratori: [{ id, nome,
  cognome, attivo, ore, sedute, stato }] }`. Amministratore: tutti gli utenti
  attivi più i disattivati con dati nel mese. Responsabile: chi ha
  registrazioni su attività dei suoi settori (`sector_managers` +
  `activity_sectors`), con i totali di quelle sole righe.
- `GET /api/collaboratori/:id/mese/:anno/:mese` → come `GET /api/mese` più
  `utente` e `solo_settori_propri`. Il responsabile riceve solo le righe dei
  suoi settori, `sedute_pt: null` (i nomi dei clienti non sono legati a un
  settore) e 404 se nel mese non ci sono righe dei suoi settori.
- `GET /api/collaboratori/:id/mese/:anno/:mese/excel`: solo amministratore.

Solo amministratore:

- `GET|POST /api/utenti`, `GET|PATCH /api/utenti/:id` (`nome`, `cognome`,
  `email`, `ruolo`, `settori` (solo per il responsabile; con un altro ruolo
  vengono tolti), `attivo`), `POST /api/utenti/:id/invito`. Il POST di
  creazione e quello dell'invito restituiscono `{ codice, scadenza }`: il
  link (`<origine>/#/invito/<codice>`) si vede solo lì. Non si può
  disattivare sé stessi; togliere ruolo o attività all'ultimo amministratore
  attivo = 409 (modifiche agli utenti in fila con `FOR UPDATE` sulla riga
  dell'organizzazione).
- `PATCH /api/attivita/:id` (`nome`, `unita`, `attiva`, `settori`): il cambio
  di unità è rifiutato (409) se renderebbe non valide quantità già salvate
  (mezze ore → sedute, oltre 24 ore al giorno → ore).
  `PUT /api/ordine-attivita` `{ attivita: [tutti gli id] }`. Le attività non
  si creano né si eliminano dall'app: sono le righe del modello.
- `POST /api/settori`, `PATCH|DELETE /api/settori/:id` (`nome`,
  `email_responsabili`, `responsabili` = id di utenti con ruolo responsabile).
- `GET|PATCH /api/organizzazione` (`email_invio`).
- `GET /api/registro-modifiche?salta=N` (100 voci, dalla più recente).
- `GET /api/modello` (versioni), `GET /api/modello/file` (file in uso),
  `POST /api/modello[?anteprima=1]`: corpo = file .xlsx (fino a 5 MB),
  intestazione `X-Nome-File`. Usa la mappa del modello in uso (dall'app non
  si cambia), legge le righe, confronta con le attività, fa la prova di
  generazione; rifiuta (400, modello invariato) file non Excel, foglio
  mancante, attività che non hanno più una riga. Stesso testo = stessa
  attività anche se cambia riga; testo nuovo sulla riga di un'attività il
  cui testo non c'è più = la stessa attività rinominata nel modello (il nome
  nell'app la segue solo se non era stato personalizzato); testo nuovo su una
  riga libera = attività nuova (a ore, senza settori). File identico = 409.
- `PUT /api/sedute-pt/:id` `{ data, tipo, cliente }` (per tutti, sulle proprie
  sedute): stessi controlli dell'inserimento, mese di partenza e di arrivo
  aperti.

## API della Fase 5

Invio del proprio mese (`src/routes/invio.js`, tutti):

- `GET /api/mese/:anno/:mese/invio` → riepilogo `{ stato, nome_file,
  destinatario, copia, totali: { ore, sedute, sedute_pt }, avvisi: {
  mese_futuro, mese_non_finito, giorni_mancanti, vuoto }, sostituisce }`.
- `POST /api/mese/:anno/:mese/invio`: genera il file, lo salva come nuova
  versione con destinatari e ora, mette in coda l'email, segna il mese
  inviato. 409 se già inviato o se manca l'indirizzo della segreteria.
  Destinatario = `organizations.submission_email`; copia = `manager_emails`
  dei settori delle attività con quantità nel mese (`time_entries`, non le
  sedute PT con cliente) + l'utente; i responsabili "nell'app"
  (`sector_managers`) non contano. Mittente "Nome Cognome tramite Registro
  ore", risposta all'utente. Il reinvio dopo una riapertura ha oggetto
  "SOSTITUISCE IL PRECEDENTE – …" e In-Reply-To dell'email precedente.
- `GET /api/mese/:anno/:mese` contiene `invii` (versioni, dalla più recente,
  con `email: { stato, inviata_il, errore }`).
- `GET /api/mese/:anno/:mese/invii/:versione/file`: una versione inviata.

Amministratore, in `collaboratori.js`:

- `GET /api/collaboratori/:anno/:mese`: in più `esonerato`, `inviato_il`,
  `versione`, `riaperto`, `manca` (attivo, non esonerato, non inviato),
  `password_impostata`, `ultimo_sollecito` (gli ultimi quattro solo
  all'amministratore). Gli esonerati compaiono solo se hanno dati nel mese.
- `GET /api/collaboratori/:id/mese/:anno/:mese`: in più `inviato_il` e
  `invii` (null per il responsabile).
- `GET …/invii/:versione/file`, `POST …/riapertura` `{ motivazione }`
  (traccia `mese.riaperto`, notifica all'utente), `POST …/sollecito`
  (notifica a nome dell'amministratore, risposta a lui; 409 se ha già
  inviato, esonerato, disattivato, senza password, o sollecitato da meno di
  10 minuti; traccia `mese.sollecitato`).

Bacheca (`src/routes/bacheca.js`):

- Destinatari di un avviso, calcolati al momento: tutti gli utenti attivi,
  oppure chi ha tra "Le mie attività" un'attività di uno dei settori, più i
  responsabili (`sector_managers`) di quei settori.
- Tutti: `GET /api/avvisi` (i propri, non ritirati), `GET
  /api/avvisi/non-letti` → `{ non_letti, importanti }`, `GET /api/avvisi/:id`
  (con `versioni_precedenti`), `POST /api/avvisi/:id/letto`. Un avviso non
  destinato all'utente o ritirato = 404 (l'amministratore li apre tutti).
- Amministratore: `GET /api/avvisi/gestione` (tutti, con `destinatari` e
  `letti`), `POST /api/avvisi` `{ titolo, testo, importante?, per_tutti,
  settori? }` (notifica ai destinatari tranne l'autore, solo titolo e link),
  `PATCH /api/avvisi/:id` (salva la versione precedente, torna "da leggere";
  nessuna nuova email), `POST /api/avvisi/:id/ritiro`, `GET
  /api/avvisi/:id/letture` → `{ letto, non_letto }`. Tracce `avviso.*`.

Altro (amministratore):

- `GET /api/email?salta=N&stato=in_attesa|inviata|errore` (100 alla volta),
  `POST /api/email/:id/riprova` (solo in errore e senza link di invito;
  traccia `email.riprovata`).
- `PATCH /api/organizzazione` accetta anche `promemoria: { giorni: [1..31],
  ultimo_giorno, ora }`; `PATCH /api/utenti/:id` (e il POST) accetta
  `esonerato_invio`. Creazione utente e nuovo link mandano il link per email
  (`invito.email` = indirizzo).

Coda e promemoria (`src/posta/coda.js`, `src/promemoria.js`):

- `elaboraCoda` ogni `POSTA_INTERVALLO_SECONDI` (5): prende una riga con
  `FOR UPDATE SKIP LOCKED`, la segna `in_invio` e fa COMMIT prima di
  contattare il server. Errore temporaneo (connessione, 4xx) = nuovo tentativo
  dopo 1, 2, 4… minuti (massimo un'ora), fino a `POSTA_MAX_TENTATIVI` (8);
  5xx = errore subito. Una riga `in_invio` oltre 10 minuti (API fermata
  durante l'invio) passa a errore senza nuovo tentativo, per non mandarla due
  volte. Message-ID = `<id della riga@dominio del mittente>`.
- `eseguiPromemoria` ogni minuto: per ogni organizzazione, se oggi (ora
  italiana) è un giorno di promemoria (un giorno oltre la fine del mese vale
  come ultimo) ed è passata l'ora, e il giro non è in `reminder_runs`,
  notifica chi è attivo, non esonerato, con password e senza il mese corrente
  inviato. Server spento all'ora prevista = recupero più tardi nello stesso
  giorno, mai nei giorni dopo.

## Esportazione Excel (Fase 3, `src/routes/esportazione.js`, `src/excel/`)

- `GET /api/mese/:anno/:mese/excel` → file `.xlsx` del mese dell'utente
  autenticato (`Content-Disposition: attachment`, `Cache-Control: no-store`),
  per mesi aperti e inviati: un mese inviato restituisce il file salvato
  all'invio, identico byte per byte; uno aperto (anche riaperto) è generato ora. Per l'amministratore anche quello di un altro
  (`collaboratori.js`); la generazione è `fileExcelMese`. Letture in una transazione REPEATABLE READ.
  Errori: 400 mese non valido, 503 organizzazione senza modello, 500 se il
  modello non corrisponde ai dati (`ErroreModello`, messaggio esplicito).
- Il modello Excel sta nel database (`excel_templates`), non su disco: l'API
  non legge mai `modello/`. Il primo lo carica `carica-organizzazione`, i
  successivi l'amministratore dall'app (Gestione → Impianto e modello Excel),
  con la stessa logica (`src/excel/modello.js`).
- Mappa delle celle: chiave `modello` di `organizzazione.json` (tutto tranne
  `file`), formato e controlli in `src/excel/layout.js`. Contiene anche i nomi
  dei mesi, le sigle dei giorni e lo schema del nome del file
  (`{MM}_{MESE}_{AAAA}_{COGNOME}.xlsx`; spazi e caratteri vietati → `_`).
- Corrispondenza attività → riga: `activities.template_row`; il generatore
  verifica che nel modello quella riga abbia esattamente `template_label`
  (non il nome nell'app), altrimenti si rifiuta di generare il file. Il
  nome nella colonna D del file è sempre quello del modello.
- Le attività a sedute scrivono il numero di sedute nella loro riga. Il totale
  generale del modello (`AJ34`) somma tutte le righe, quindi = ore + sedute
  delle righe "PT …": diverso dal "Totale ore" dell'app quando nel mese ci
  sono sedute registrate nella griglia. Le sedute PT con nome cliente (tabelle
  a destra) non entrano in nessun totale. Da chiarire con BV.
- Sedute PT nelle tabelle in ordine di data (a parità, di inserimento), data
  come data Excel con formato `dd/mm/yyyy`.
- Test: `test/password-dimenticata.test.js` (risposta uguale per tutti,
  email, limiti, registro, comando `link-password`), `test/sessioni.test.js` (esci, esci da tutti i dispositivi, token
  copiati, sessioni scadute o di altri), `test/produzione.test.js` (controlli della configurazione, `/api/stato`,
  origine delle richieste), `test/correzioni.test.js` (annulla precompilazione, svuota giorni),
  `test/invio.test.js` (invio del mese, sul modello reale di BV),
  `test/posta.test.js`, `test/promemoria.test.js`, `test/bacheca.test.js`.
  Le email nei test passano da `trasportoFinto()` (`test/helpers.js`).
- Test: `test/excel.test.js` genera e rilegge i file sul modello reale di BV
  e li confronta con il modello (celle unite, larghezze, altezze, stampa,
  stili cella per cella, regolamento, `fullCalcOnLoad`).

## App installabile e aggiornamenti

- `manifest.webmanifest` e `versione.json` li scrive il plugin
  `appInstallabile` di `vite.config.js` (anche in `npm run dev`); `index.html`
  ha `%NOME_APP%` e `%COLORE_TEMA%`. `display: standalone`, `id: '/'` (lo
  stesso anche cambiando nome), icone 192/512 `any` e `maskable`,
  `apple-touch-icon` 180 per Safari. Il nome nella pagina e nelle email
  resta "Registro ore".
- Dopo un rilascio l'app installata si aggiorna senza disinstallarla: il
  service worker non risponde mai con file in cache (solo le aperture di
  pagina passano da lui, e vanno in rete); `index.html`, `sw.js`,
  `versione.json` e il manifest sono `Cache-Control: no-cache`
  (`nginx.conf`; il manifest ha una `location` sua per il tipo); i file in
  `/assets/` hanno l'hash nel nome. L'app rimasta aperta in sottofondo
  confronta `__VERSIONE__` (data della compilazione) con `/versione.json`
  quando torna in primo piano e ogni 30 minuti (`AvvisoAggiornamento.jsx`):
  versione diversa = ricarica, oppure, con una finestra aperta o modifiche
  non salvate, avviso "Aggiorna". `sw.js` usa `skipWaiting` + `clients.claim`.
- Il service worker si registra solo nella versione compilata e in HTTPS
  (o localhost): dal telefono via `http://<IP del PC>:8088` non c'è.

## Fasi

0. Prova di fattibilità Excel — **completata** (vedi sotto)
1. Fondamenta (struttura, schema, login) — **completata**
2. Inserimento ore — **completata**
3. Esportazione Excel — **completata**
4. Multiutente e ruoli — **completata**
5. Chiusura mese, invio email, promemoria, bacheca — **completata**
6. Stabilità e deploy sul VPS — **online dal 12/10/2026, in fase di prova**:
   https://presenze.apetris.com, VPS OVHcloud `152.228.240.155` (utente
   `registro`, app in `/opt/registro-ore`), valori reali e differenze in
   `RUNBOOK.md` (in alto e 11.1–11.2), diario in `deploy/PROGRESSO.md`.
   Provati: HTTPS, invito, invio del mese con copie, riapertura e reinvio,
   backup notturno e manuale su B2, ripristino di prova. Durante la prova sul
   server c'è un `contatti.json` **di prova** (tutti gli indirizzi sono di
   rdnrtp@gmail.com, con `+settore`): nessuna email può arrivare a BV. Il
   passaggio agli indirizzi reali è RUNBOOK 11.2, solo dopo il via libera.
   Notifiche push: dopo la messa online.
7. Riepilogo per la direzione

Lavora una fase alla volta e fermati alla fine di ciascuna per il resoconto.

Punti aperti della Fase 6:

- Prima dei colleghi: indirizzi reali di BV (RUNBOOK 11.2), disattivare
  l'utente "Prova Uno", monitoraggio di `/api/stato` e Healthchecks per il
  backup (RUNBOOK 10), DMARC di `apetris.com` più severo (`p=quarantine`)
  se oggi è `p=none`, dopo qualche settimana senza problemi.

- Informativa sulla privacy (`frontend/src/Privacy.jsx`): bozza con le parti
  `<Dc>` da completare; titolare BV, da far verificare al loro consulente. Il
  testo è unico per installazione (non è configurazione di un'organizzazione).
- Conservazione: oggi nessun dato viene cancellato automaticamente (ore,
  sedute PT con i nomi dei clienti, file inviati, email in `email_outbox`,
  notifiche, `audit_log`). Manca una funzione per cancellare o rendere anonimo
  un collaboratore che lascia, dopo i tempi di conservazione decisi da BV:
  `DELETE FROM users` cancellerebbe a cascata anche i file inviati, ed è
  bloccato per chi compare come autore (`audit_log.actor_id`, avvisi,
  riaperture). I backup conservano i dati cancellati per altri 6 mesi.
- Log dei container ruotati per dimensione (5×10 MB), non per tempo: nginx
  registra gli IP degli accessi.

## Modello Excel di BV (verificato in Fase 0)

File: `modello/modello_bv.xlsx` (non tracciato), un solo foglio `Foglio1`.
Versione in uso: quella di **ottobre 2026** fornita da BV. Copie di sicurezza
datate, da non modificare: `modello/modello_bv.2026-09.xlsx` (settembre) e
`modello/modello_bv.2026-10.xlsx` (identica a quella in uso).
La mappa delle celle qui sotto è in `seed/bv/organizzazione.json` (chiave
`modello`); il prototipo della Fase 0 è stato rimosso e i suoi controlli sono
in `api/test/excel.test.js`. Mappa verificata anche sulla versione di ottobre:
invariata. Dopo aver cambiato il file del modello o la mappa: rieseguire
`carica-organizzazione` (crea una nuova versione nel database).

- Mese: `B2`, area unita `B2:C3`, testo. Nel file di ottobre di BV dice ancora
  "Settembre" mentre le sigle sono di ottobre: errore di BV, il generatore
  riscrive comunque mese e sigle.
- Nome `B4` (unita `B4:B33`), cognome `C4` (unita `C4:C33`), testo ruotato 90°.
- Giorni 1–31: colonne `E`..`AI`; numero in riga 2, sigla (LU MA ME GI VE SA DO) in riga 3.
  Nella riga 3 caratteri (Calibri/Arial) e bordi sinistri non sono uniformi
  tra le celle: è così nel modello di BV e va lasciato com'è.
- Attività: `D4:D33`, 30 righe. Il nome nel modello è quello usato per la
  corrispondenza. La riga 29 è "NUOTO AGONISTICO" (a settembre era "Agonismo Nuoto").
- Differenze di ottobre rispetto a settembre, accettate: righe 4–33 alte 14,1
  (erano 15), righe 35–49 alte 15,95 (erano 20,25; il regolamento si legge
  comunque per intero), colonna A più stretta, nessun file di impostazioni
  stampante (formato, orientamento, scala e margini invariati).
- Se il nome di una riga cambia nel modello, il caricamento (dall'app o con
  `--sovrascrivi`) rinomina l'attività esistente su quella riga (stesso id),
  invece di crearne una nuova.
- Totali per attività: `AJ4:AJ33` sono formule `SUM(E{r}:AI{r})` (in AJ5:AJ33
  come formula condivisa). Totale generale `AJ34` = `SUM(AJ4:AJ33)`.
  `B34:AI34` è unita e vuota.
- Regolamento: `B35`, unita `B35:AJ49`, stringa semplice con a capo; contiene le
  email dei responsabili di settore. Non va toccato.
- PT palestra: data `AL`, cliente `AM`; PT acqua: data `AN`, cliente `AO`;
  righe 6–32 (27 sedute per tipo). Intestazioni in `AL3:AM4`, `AN3:AO4`
  (unite) e riga 5 ("DATA", "NOME CLIENTE").
- Il modello contiene dati di esempio da svuotare: ore e trattini "-" nella riga 29.
- Nome file: `MM_Mese_AAAA_Cognome.xlsx` (es. `10_Ottobre_2026_Petris.xlsx`).

### Insidie di ExcelJS

- Le celle con lo stesso formato condividono lo stesso oggetto stile: impostare
  `cell.numFmt = ...` cambia tutte le celle con quello stile. Clonare prima:
  `cell.style = { ...cell.style, numFmt }`.
- ExcelJS non calcola le formule: scrivere `{ formula, result }` con il valore
  calcolato e impostare `wb.calcProperties.fullCalcOnLoad = true`.
- ExcelJS non rilegge `calcPr` dall'XML: per verificarlo bisogna leggere `xl/workbook.xml`.
- Se `pageSetup.firstPageNumber` è valorizzato, ExcelJS aggiunge `useFirstPageNumber`:
  azzerarlo se il modello non lo usa.
- Impostare `lastModifiedBy` e `modified`, altrimenti restano quelli del modello.
- Lavorare in UTC (`Date.UTC`, `getUTCDay`) per date e giorni della settimana.

## Dati di BV (`seed/bv/`)

- 8 settori, dal regolamento in `B35` del modello di ottobre 2026, con i nomi
  esatti: Segreteria, Corsi acqua e palestra, Sala pesi, Danza e centro estivo,
  Nuoto, Manutenzione, Bagnini, Pulizie (un responsabile ciascuno). Rispetto a
  settembre sono stati eliminati Corsi palestra, Corsi acqua, Danza, Nuoto e
  Centro estivo. L'indirizzo a cui inviare il file (segreteria) è `emailInvio`
  in `contatti.json`.
- `modello.sedutePt` in `organizzazione.json` (righe 6–32) dà il limite
  di 27 sedute PT per tipo al mese.
- Dalla Fase 4 i file di `seed/bv/` sono la configurazione di partenza:
  settori, email, abbinamenti e indirizzo di invio si cambiano dall'app.
  `carica-organizzazione -- bv --sovrascrivi` riporterebbe tutto ai file
  (eliminando i settori non elencati, con abbinamenti e responsabili).
- Se il regolamento cambia: aggiornare settori ed email dei responsabili
  dall'app (Gestione → Settori) e caricare il nuovo modello dall'app.
- 30 attività dalle righe 4–33 del modello; le righe di personal training
  13–26 ("PT …") hanno unità "sedute", le altre "ore". Da verificare con BV
  come vanno conteggiate davvero le righe PT.
- Abbinamento attività → settori in `abbinamenti.json`, confermato il 6/10/2026
  e caricato (31 abbinamenti; "Pulizie/Manutenzione" sta in due settori).
  Era una proposta mia accettata senza verifiche: possono essere da rivedere le
  righe PT, i Corsi nuoto, Compleanni e Corsi formazione. Si cambiano dall'app
  (Gestione → Attività → settori); da ora determinano cosa vede ciascun
  responsabile.
