# Messa online — avanzamento

Diario della prima messa online (12/10/2026), per riprendere da una sessione
nuova. Nessun segreto in questo file. Passi = sezioni di `RUNBOOK.md`.

## Dati (non segreti)

- VPS OVHcloud, Ubuntu 24.04.4 LTS, `vps-218669e7`, 2 vCPU, 3,7 GB RAM, 38 GB.
  IPv4 `152.228.240.155`, IPv6 `2001:41d0:305:2100::1:87d2` (nessun record AAAA).
  Utente iniziale OVH: `ubuntu` (ora non può più entrare via SSH).
- Utente di lavoro sul server: `registro` (sudo con password), app in `/opt/registro-ore`.
- Dominio: `presenze.apetris.com`. Certificato Let's Encrypt (rinnovo automatico).
- SMTP: Brevo, `smtp-relay.brevo.com:587` (STARTTLS), mittente
  `notifiche@apetris.com`; IP del server autorizzato in Brevo.
- Backup remoto: Backblaze B2 (S3), endpoint `s3.eu-central-003.backblazeb2.com`,
  regione `eu-central-003`, bucket privato `registro-apetris`, cartella `registro-ore`.
- Repository: `git@github.com:rdnrtp/registro-ore.git`, ramo `master`, deploy key "server".
- Amministratore: Andrea Petris, rdnrtp@gmail.com. Utente di prova: "Prova Uno",
  `rdnrtp+prova@gmail.com` (collaboratore).

## Fase di prova: nessuna email a BV

Sul server `seed/bv/contatti.json` NON è quello reale: `emailInvio` =
rdnrtp@gmail.com e ogni responsabile di settore = `rdnrtp+<settore>@gmail.com`.
Il file reale resta solo sul PC. Verificato il 12/10 nel database: nessun
indirizzo diverso da `rdnrtp…@gmail.com` (organizzazione, settori, utenti,
email inviate, versioni inviate). Query di controllo e passaggio agli
indirizzi reali: `RUNBOOK.md` 11.1 e 11.2.

## Passi completati

- [x] Controlli iniziali: repository allineato (`af6b01f`), DNS, SSH come `ubuntu`.
- [x] 4. `prepara-server.sh registro` (come `ubuntu` con `sudo`, chiave passata
  come secondo parametro). `registro` entra con chiave, `ubuntu` rifiutato.
  Riavvio per il kernel (6.8.0-146).
- [x] 5. Deploy key in sola lettura, impronta GitHub verificata, clone.
- [x] 6.1 `genera-segreti.sh`; 6.2 valori non segreti scritti da Claude con
  `sed`, segreti SMTP/B2 da Andrea con nano; 6.3 chiave dei backup creata da
  Andrea (privata nel gestore di password e su carta); 6.4 copia di
  `.env.production` nel gestore di password.
- [x] 7. Modello copiato (sha256 `46a86441…`), `contatti.json` di prova,
  avvio (4 servizi healthy), migrazioni 001–010, BV caricata (8 settori, 30
  attività, 31 abbinamenti, modello v1), amministratore, accesso HTTPS.
- [x] 8.3 Invito di prova: primo invio respinto da Brevo (`525 5.7.1
  Unauthorized IP address`), IP autorizzato, nuovo link arrivato. SPF, DKIM,
  DMARC PASS. Il link email delle 14:02 non è stato usato (scade il 15/10).
- [x] 11.1 Invio del mese 10/2026 di Prova Uno (copie +manutenzione +nuoto
  +pulizie +prova), allegato aperto in Excel; riapertura e reinvio (v2,
  "SOSTITUISCE IL PRECEDENTE").
- [x] 9.1 Timer del backup (02:30); 9.2 backup manuale e da systemd copiati
  su B2; 9.3 prova di ripristino dalla copia B2: PROVA RIUSCITA (conteggi
  uguali), `~/ripristino` ripulito.
- [x] RUNBOOK.md e CLAUDE.md aggiornati.

## Rilascio del 14/10/2026 (`2bd0b9a`)

Primo rilascio con `rilascia.sh` (da `af6b01f`): comandi del mese, tasto
Indietro, password dimenticata, comando `link-password`, app installabile.
Migrazione 011 applicata, 4 servizi healthy, versione `2026-10-14T14:19:40Z`.
Controllati dal server: tipi e `Cache-Control: no-cache` di `/`, `sw.js`,
manifest, `versione.json`, icone; `/api/stato` ok. `link-password` provato
su Prova Uno (link usato, password cambiata). Dal telefono Android: vista
del mese, Indietro, installazione, pagina offline, Excel dall'app
installata ok.

Email: le email delle prove di oggi (password dimenticata, avviso delle
16:57 a `rdnrtp+prova@`) risultano in Brevo solo "Inviata", senza
"Consegnata", e non sono arrivate in Gmail; il reinoltro dallo stesso
pannello di Brevo è arrivato. Le email del 12/10 risultano consegnate.
L'app le ha prese in carico correttamente. Ipotesi: ritardo di Gmail verso
il server condiviso di Brevo (77.32.148.25). Da ricontrollare il 15/10
(compare "Consegnata" in ritardo?); se si ripete, ticket a Brevo con il
Message-ID.

## Da fare

- [ ] `sudo ufw status` mai visto da Claude (lo script l'ha mostrato ad Andrea).
- [ ] Monitoraggio `/api/stato` e Healthchecks del backup (RUNBOOK 10).
- [ ] Informativa sulla privacy completata e verificata.
- [ ] Email non consegnate a Gmail il 14/10 (sopra): capire prima di invitare i colleghi.
- [ ] Prova dell'aggiornamento automatico dell'app installata (secondo rilascio).
- [ ] Al via libera: indirizzi reali di BV e disattivazione di Prova Uno (RUNBOOK 11.2).
