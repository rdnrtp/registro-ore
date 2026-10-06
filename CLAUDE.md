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
  token, mai dai dati inviati dal client. Nessuna registrazione pubblica: gli
  utenti sono invitati da un amministratore.
- Ruoli: collaboratore (solo le proprie ore), responsabile di settore (il proprio
  settore), amministratore (vede e configura tutto).
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
- `api/`: `src/app.js` (Express), `src/auth.js` (JWT, middleware `autenticato`
  e `richiediRuolo`), `src/routes/`, `src/cli/` (comandi da terminale),
  `migrations/NNN_nome.sql`, `test/` (node:test + supertest).
- `frontend/`: Vite + React, `src/App.jsx` sceglie tra `Login` e `Home`.
- `seed/<org>/`: configurazione di un'organizzazione per `carica-organizzazione`:
  `organizzazione.json` (tracciato), `contatti.json` (email reali, NON
  tracciato; formato in `contatti.example.json`), `abbinamenti.json`
  (attività → settori; se manca gli abbinamenti non vengono caricati).
  Montata nel container `api` in `/dati/seed`; `modello/` in `/dati/modello`.
- `fase0/`: prototipo del generatore Excel, da integrare nella Fase 3.

## Comandi (da PowerShell, nella radice del progetto)

- Avvio: `docker compose up -d --build` → http://localhost:8088 (`HTTP_PORT`).
- Migrazioni: `docker compose exec api npm run migra`
- Carica/aggiorna BV: `docker compose exec api npm run carica-organizzazione -- bv`
  (rieseguibile; legge le attività dal modello Excel).
- Primo amministratore: `docker compose exec api npm run crea-admin -- --org bv
  --email ... --nome ... --cognome ...` (password chiesta a terminale; serve il
  TTY, quindi niente `-T`).
- Test: `docker compose run --rm --build api-test` (usa il database
  `registro_ore_test`, creato e azzerato dai test; rifiutano nomi senza `_test`).
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

Chiavi primarie UUID. Ogni tabella con dati di un impianto ha `organization_id`;
le chiavi esterne tra tabelle dell'organizzazione sono composte
`(id, organization_id)`, così il database rifiuta collegamenti tra
organizzazioni diverse. Nuove modifiche allo schema: nuovo file di migrazione,
mai modificare uno già applicato.

## Regole per l'API

- `req.utente` = `{ id, organizzazioneId, ruolo }` viene solo dal JWT (cookie
  httpOnly `registro_ore_sessione`, SameSite=Lax). Mai leggere utente,
  ruolo od organizzazione da corpo, query o parametri.
- Ogni query filtra per `req.utente.organizzazioneId`. Un id di un'altra
  organizzazione (o non valido) risponde 404, come se non esistesse.
- Ogni nuova rotta che legge dati per id va coperta in `test/isolamento.test.js`.
- Login: bcrypt (bcryptjs, costo 12), stesso messaggio per email inesistente e
  password errata; limite ai tentativi falliti per IP+email e per IP
  (express-rate-limit in memoria: va bene con una sola istanza dell'API).
- `TRUST_PROXY` = numero di proxy davanti all'API (1 = nginx del frontend), serve
  a ricavare l'IP reale per il limite di login.
- Messaggi di errore in JSON `{ errore: "..." }`, in italiano.

## Fasi

0. Prova di fattibilità Excel — **completata** (vedi sotto)
1. Fondamenta (struttura, schema, login) — **completata**
2. Inserimento ore
3. Esportazione Excel
4. Multiutente e ruoli
5. Chiusura mese, invio email, promemoria
6. Stabilità e deploy sul VPS
7. Riepilogo per la direzione

Lavora una fase alla volta e fermati alla fine di ciascuna per il resoconto.

## Modello Excel di BV (verificato in Fase 0)

File: `modello/modello_bv.xlsx` (non tracciato), un solo foglio `Foglio1`.
Prototipo del generatore: `fase0/genera-excel.js` (`LAYOUT_BV` è la mappa che
diventerà configurazione dell'organizzazione); prove: `cd fase0 && npm run prova`.

- Mese: `B2`, area unita `B2:C3`, testo (es. "Settembre").
- Nome `B4` (unita `B4:B33`), cognome `C4` (unita `C4:C33`), testo ruotato 90°.
- Giorni 1–31: colonne `E`..`AI`; numero in riga 2, sigla (LU MA ME GI VE SA DO) in riga 3.
- Attività: `D4:D33`, 30 righe. Il nome nel modello è quello usato per la
  corrispondenza. La riga 29 è "NUOTO AGONISTICO": rinominata su richiesta
  (in origine "Agonismo Nuoto"; copia intatta in `modello/modello_bv.originale.xlsx`).
  La rinomina ha toccato solo la stringa in `xl/sharedStrings.xml`.
- Se il nome di una riga cambia nel modello, `carica-organizzazione` rinomina
  l'attività esistente su quella riga (stesso id), invece di crearne una nuova.
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

- 9 settori, dal regolamento in `B35`: Segreteria, Corsi palestra, Corsi acqua,
  Sala pesi, Danza, Nuoto e Centro estivo (2 responsabili), Manutenzione,
  Bagnini, Pulizie. L'indirizzo a cui inviare il file (segreteria) è
  `emailInvio` in `contatti.json`.
- 30 attività dalle righe 4–33 del modello; le righe di personal training
  13–26 ("PT …") hanno unità "sedute", le altre "ore". Da verificare con BV
  come vanno conteggiate davvero le righe PT.
- Abbinamento attività → settori: `abbinamenti.proposta.json` è una proposta
  **non ancora confermata**; finché non esiste `abbinamenti.json` non viene caricato.
