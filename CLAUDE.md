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

## Tabelle previste

- `organizations`
- `sectors`
- `activities`
- `users`
- `time_entries`: una sola riga per utente + data + attività
- `pt_sessions`: utente, data, tipo (acqua | palestra), nome cliente
- `schedule_templates`: utente, giorno della settimana, attività, ore
- `month_submissions`: utente, anno, mese, stato, data di invio

## Fasi

0. Prova di fattibilità Excel — **completata** (vedi sotto)
1. Fondamenta (struttura, schema, login)
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
  corrispondenza (es. "Agonismo Nuoto" alla riga 29, non "Nuoto agonistico").
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
