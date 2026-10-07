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
  cui sceglie la password. Lo stesso link serve per la password dimenticata.
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
- Ogni utente ha un "orario tipo" settimanale che precompila il mese; poi corregge
  solo le eccezioni.
- Ore a passi di mezz'ora.
- Il modello contiene indirizzi email reali: repository privato, e i dati reali di
  BV (modello, file generati) non vanno in file tracciati da git. Vedi `.gitignore`.

## Struttura

- `docker-compose.yml`: servizi `db` (PostgreSQL 17), `api` (Node/Express),
  `web` (React compilato, servito da nginx che inoltra `/api` all'API),
  `api-test` (profilo `test`, avviato solo con `docker compose run`).
  Configurazione in `.env` (non tracciato), modello in `.env.example`.
- `api/`: `src/app.js` (Express; rotte pubbliche, poi `autenticato` per tutto
  il resto di `/api`), `src/auth.js` (JWT, middleware `autenticato` e
  `richiediRuolo`), `src/routes/` (`auth`; `inviti` = link di invito,
  pubblici; `organizzazione` = elenco attività e settori; `registro` = ore,
  orario tipo, mie attività, sedute PT; `esportazione` = proprio file Excel e
  `fileExcelMese`; `collaboratori` = viste in sola lettura sui mesi degli
  altri; `utenti`, `configurazione` (attività, settori, organizzazione,
  registro delle modifiche) e `modello` = gestione, solo amministratore),
  `src/excel/` (`layout.js` = mappa delle celle e sua validazione,
  `foglio-mensile.js` = generatore, `modello.js` = caricamento di un modello:
  righe, confronto con le attività, prova di generazione, nuova versione;
  usato dal comando e dall'app), `src/inviti.js` (creazione dei link),
  `src/traccia.js` (`audit_log`), `src/errori.js` (`ErroreHttp`),
  `src/validazione.js` (uuid, date, mesi, testi, email), `src/db.js`
  (`transazione`), `src/cli/` (comandi da terminale),
  `migrations/NNN_nome.sql`, `test/` (node:test + supertest).
- `frontend/`: Vite + React, nessuna libreria oltre a React. `src/App.jsx`
  sceglie tra `Invito` (`#/invito/<codice>`, anche con un accesso già fatto),
  `Login` e `Home`; `Home.jsx` = barra delle sezioni in basso (secondo il
  ruolo) e pagine scelte con l'ancora dell'indirizzo, letta da
  `navigazione.js` (`usaRotta`; `usaGuardiaModifiche` chiede conferma prima
  di lasciare una pagina con modifiche non salvate, usata da `OrarioTipo`):
  `#/` = `Mese.jsx`, `#/attivita` = `MieAttivita.jsx`, `#/orario` =
  `OrarioTipo.jsx`, `#/collaboratori/AAAA/M` = `Collaboratori.jsx`,
  `#/collaboratori/<id>/AAAA/M` = `MeseCollaboratore.jsx` (sola lettura),
  `#/gestione[/utenti|attivita|settori|impianto|registro]` = `Gestione.jsx` e
  `Gestione*.jsx`, `RegistroModifiche.jsx`. `VistaMese.jsx` = parti comuni
  alle viste del mese (elenco dei giorni, totali, `salvaFile`).
  `SchedaGiorno.jsx`, la precompilazione e le schede di gestione usano
  `Foglio.jsx` (pannello dal basso); `EditorQuantita.jsx` (contatori − valore
  + ) serve sia alla scheda del giorno sia all'orario tipo; `SedutePt.jsx`
  (aggiunta, modifica, eliminazione); `date.js` (date come stringhe
  'AAAA-MM-GG', oggi = fuso Europe/Rome); `api.js` (un 401 riporta al login;
  `excelMese`/`excelDi` scaricano il file come blob; `caricaModello` manda il
  file come corpo della richiesta).
- `seed/<org>/`: configurazione di un'organizzazione per `carica-organizzazione`:
  `organizzazione.json` (tracciato), `contatti.json` (email reali, NON
  tracciato; formato in `contatti.example.json`), `abbinamenti.json`
  (attività → settori; se manca gli abbinamenti non vengono caricati).
  Montata nel container `api` in `/dati/seed`; `modello/` in `/dati/modello`
  (anche in `api-test`, per i test dell'esportazione).

## Comandi (da PowerShell, nella radice del progetto)

- Avvio: `docker compose up -d --build` → http://localhost:8088 (`HTTP_PORT`).
- Migrazioni: `docker compose exec api npm run migra`
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
- Test: `docker compose run --rm --build api-test` (usa il database
  `registro_ore_test`, creato e azzerato dai test; rifiutano nomi senza `_test`).
  I test dell'esportazione richiedono `modello/modello_bv.xlsx` sul PC.
- Sviluppo frontend senza Docker: `cd frontend && npm run dev` (inoltra `/api` a
  `API_URL`, predefinito http://localhost:3000).

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

Chiavi primarie UUID. Ogni tabella con dati di un impianto ha `organization_id`;
le chiavi esterne tra tabelle dell'organizzazione sono composte
`(id, organization_id)`, così il database rifiuta collegamenti tra
organizzazioni diverse. Nuove modifiche allo schema: nuovo file di migrazione,
mai modificare uno già applicato.

## Regole per l'API

- `req.utente` = `{ id, organizzazioneId, ruolo }`: id e organizzazione dal JWT
  (cookie httpOnly `registro_ore_sessione`, SameSite=Lax; contiene `sub`,
  `org`, `ver`), ruolo dal database. `autenticato` (in `app.js`, per tutto
  `/api` tranne `/api/auth` e `/api/inviti`) legge a ogni richiesta la riga
  dell'utente: disattivato, organizzazione diversa o `token_version` diversa
  = 401 subito. Mai leggere utente, ruolo od organizzazione da corpo, query o
  parametri.
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

## Esportazione Excel (Fase 3, `src/routes/esportazione.js`, `src/excel/`)

- `GET /api/mese/:anno/:mese/excel` → file `.xlsx` del mese dell'utente
  autenticato (`Content-Disposition: attachment`, `Cache-Control: no-store`),
  per mesi aperti e inviati. Per l'amministratore anche quello di un altro
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
- Test: `test/excel.test.js` genera e rilegge i file sul modello reale di BV
  e li confronta con il modello (celle unite, larghezze, altezze, stampa,
  stili cella per cella, regolamento, `fullCalcOnLoad`).

## Fasi

0. Prova di fattibilità Excel — **completata** (vedi sotto)
1. Fondamenta (struttura, schema, login) — **completata**
2. Inserimento ore — **completata**
3. Esportazione Excel — **completata**
4. Multiutente e ruoli — **completata**
5. Chiusura mese, invio email, promemoria
6. Stabilità e deploy sul VPS
7. Riepilogo per la direzione

Lavora una fase alla volta e fermati alla fine di ciascuna per il resoconto.

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
