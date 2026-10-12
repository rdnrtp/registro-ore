# Registro ore — messa online e gestione del server

Guida passo passo per mettere online il Registro ore su un server VPS e
gestirlo nel tempo. Ogni comando va copiato così com'è, **dopo aver
sostituito i valori tra « »**.

## 0. Come leggere questa guida

**Valori da sostituire.** Tutto ciò che è scritto tra « » va sostituito
con il tuo valore, togliendo anche le « ». Se dimentichi di sostituirne
uno, il comando fallisce senza fare danni.

| Segnaposto | Cosa è | Esempio |
|---|---|---|
| «IP_SERVER» | indirizzo IPv4 del VPS, dal pannello del fornitore | `203.0.113.10` |
| «UTENTE» | utente con cui lavorerai sul server (scegli tu) | `registro` |
| «DOMINIO» | indirizzo dell'app, senza https:// | `ore.nomeimpianto.it` |
| «UTENTE_GITHUB» | il tuo nome utente su GitHub | `mariorossi` |
| «TUA_EMAIL» | la tua email | `mario@esempio.it` |
| «FILE_BACKUP» | nome di un file di backup, come appare negli elenchi | `registro-ore_2026-11-02_023001.dump.age` |

**Questa installazione (BV, messa online il 12/10/2026).** Valori reali, non
segreti; il diario dei passi è in `deploy/PROGRESSO.md`.

| Segnaposto / voce | Valore |
|---|---|
| «IP_SERVER» | `152.228.240.155` (VPS OVHcloud `vps-218669e7`, Ubuntu 24.04; IPv6 `2001:41d0:305:2100::1:87d2`, senza record AAAA) |
| «UTENTE» | `registro` |
| «DOMINIO» | `presenze.apetris.com` |
| «UTENTE_GITHUB» | `rdnrtp` (repository `rdnrtp/registro-ore`, deploy key "server") |
| «TUA_EMAIL» | `rdnrtp@gmail.com` (anche `ACME_EMAIL` e `ALLARMI_EMAIL`) |
| SMTP | Brevo, `smtp-relay.brevo.com:587` (STARTTLS), mittente `notifiche@apetris.com` (dominio `apetris.com` autenticato su Brevo) |
| Backup fuori dal server | Backblaze B2 (S3), endpoint `https://s3.eu-central-003.backblazeb2.com`, regione `eu-central-003`, bucket privato `registro-apetris`, `BACKUP_REMOTO=remoto:registro-apetris/registro-ore` |
| Console di emergenza | Control Panel OVHcloud → Bare Metal Cloud → Virtual Private Servers → `vps-218669e7` → Home → **KVM**; si entra con `registro` e la sua password di sudo (le regole SSH non valgono lì). Ultima risorsa: Boot → modalità rescue |

**Dove si scrivono i comandi.**

- `PC>` = PowerShell sul tuo PC Windows, nella cartella del progetto
  (`C:\Users\pitbu\Projects\registro-ore`). Il `PC>` non va copiato.
- `server$` = terminale del server, dopo `ssh «UTENTE»@«IP_SERVER»`. Il
  `server$` non va copiato. Quasi tutti i comandi si lanciano dalla cartella
  dell'app: `cd /opt/registro-ore`.
- `root#` = terminale del server come root (solo al passo 4).

Da Windows usa l'`ssh` di PowerShell: quello di Git Bash non vede le chiavi
caricate nell'agente SSH di Windows (risponde `Permission denied (publickey)`).

**Regola d'oro.** I segreti (password, chiavi, `.env.production`) non si
mandano per email o chat, nemmeno a me: vanno solo nel gestore di password
e nel server.

---

## 1. Cosa serve prima di iniziare

Da acquistare o creare (dettagli e requisiti in fondo, sezione 15):

1. un **VPS** Ubuntu 24.04 LTS in Europa;
2. un **dominio** (o un sottodominio di quello dell'impianto) di cui puoi
   modificare il DNS;
3. un **servizio SMTP** per l'invio delle email;
4. uno **spazio per i backup** fuori dal server (compatibile S3 oppure SFTP);
5. un account **GitHub** (gratuito) per il repository privato;
6. un **gestore di password** (es. Bitwarden o KeePassXC).
7. (consigliati, gratuiti) un servizio di **monitoraggio** e uno di
   **controllo dei backup** (sezione 10).

Attiva l'autenticazione a due fattori su ogni account (fornitori, GitHub,
gestore di password).

---

## 2. Sul tuo PC: chiave SSH e repository privato

### 2.1 Chiave SSH del PC

Serve per entrare nel server senza password. Se hai già il file
`C:\Users\pitbu\.ssh\id_ed25519.pub`, salta questo passo.

```
PC> ssh-keygen -t ed25519 -C "PC registro-ore"
```

Premi Invio per il percorso predefinito e scegli una **passphrase** (salvala
nel gestore di password). Poi mostra la chiave pubblica:

```
PC> Get-Content $HOME\.ssh\id_ed25519.pub
```

È una riga che inizia con `ssh-ed25519`: ti serve al passo 3.

### 2.2 Repository privato su GitHub

1. Su github.com: **New repository** → nome `registro-ore` → **Private** →
   nessun README, nessun .gitignore → **Create repository**.
2. Sul PC:

```
PC> git remote add origin https://github.com/«UTENTE_GITHUB»/registro-ore.git
PC> git push -u origin master
```

La prima volta si apre una finestra per entrare in GitHub. Controlla poi su
github.com che il repository sia **Private** e che **non** contenga
`.env`, `modello/` né `seed/bv/contatti.json` (sono esclusi da `.gitignore`).

---

## 3. Creare il VPS e puntare il dominio

1. Nel pannello del fornitore crea il server: **Ubuntu 24.04 LTS**, centro
   dati in **UE**, e nella sezione "SSH key" incolla la chiave del passo 2.1
   (così non serve nessuna password di root).
2. Annota l'indirizzo IPv4 («IP_SERVER») e, se c'è, l'IPv6.
3. Nel pannello DNS del dominio crea:
   - record **A**: nome «DOMINIO» → valore «IP_SERVER»;
   - record **AAAA**: nome «DOMINIO» → l'IPv6 del server (solo se il server ne ha uno).
4. Aspetta qualche minuto e controlla:

```
PC> Resolve-DnsName «DOMINIO»
```

Deve comparire «IP_SERVER». **Non andare oltre il passo 7 finché non è
così**: il certificato HTTPS si ottiene solo con il DNS già corretto.

---

## 4. Preparare il server (una volta)

Copia lo script sul server e lancialo come root:

```
PC> scp deploy\prepara-server.sh root@«IP_SERVER»:/root/
PC> ssh root@«IP_SERVER»
root# bash /root/prepara-server.sh «UTENTE»
```

Alla prima connessione SSH chiede di confermare l'impronta del server:
rispondi `yes`.

**Su OVHcloud (e altri fornitori con un utente iniziale)** non si entra come
root: si entra come `ubuntu`, che ha sudo senza password, e
`/root/.ssh/authorized_keys` è vuoto. In quel caso la chiave va passata
esplicitamente (quella con cui entri come `ubuntu`):

```
PC> scp deploy\prepara-server.sh ubuntu@«IP_SERVER»:/tmp/
PC> ssh -t ubuntu@«IP_SERVER» 'sudo bash /tmp/prepara-server.sh «UTENTE» "$(head -n1 ~/.ssh/authorized_keys)"'
```

Dopo lo script `ubuntu` non può più entrare via SSH (`AllowUsers`): si
lavora solo come «UTENTE». Lo script:

- imposta il fuso orario Europe/Rome e aggiorna il sistema;
- crea «UTENTE» e ti chiede **la sua password, che serve solo per `sudo`**
  (salvala nel gestore di password);
- autorizza per «UTENTE» la stessa chiave SSH di root;
- chiude l'accesso SSH a root e a chiunque senza chiave;
- apre nel firewall solo le porte 22, 80 e 443;
- attiva fail2ban (blocca per un'ora chi sbaglia 5 accessi in 10 minuti);
- attiva gli aggiornamenti di sicurezza automatici (con riavvio alle 04:30
  quando servono; l'app riparte da sola);
- installa Docker.

**Prima di chiudere la sessione di root**, apri un **nuovo** PowerShell e verifica:

```
PC> ssh «UTENTE»@«IP_SERVER»
server$ sudo whoami
```

Deve rispondere `root` (dopo la password di sudo). Se non riesci a entrare,
**non chiudere** la sessione di root e chiedi aiuto. Se funziona:

```
server$ sudo reboot
```

(solo se lo script ha detto che serve un riavvio). Lo script si può
rilanciare in qualsiasi momento: non fa danni.

---

## 5. Dare al server l'accesso (in sola lettura) al repository

Il modo più semplice e sicuro è una **deploy key**: una chiave SSH che vale
solo per questo repository e solo in lettura. Se il server venisse
compromesso, non darebbe accesso a nient'altro del tuo GitHub.

```
server$ ssh-keygen -t ed25519 -N "" -C "server registro-ore (sola lettura)" -f ~/.ssh/registro_ore_deploy
server$ cat ~/.ssh/registro_ore_deploy.pub
```

Su github.com, nel repository: **Settings → Deploy keys → Add deploy key**.
Titolo `server`, incolla la riga, **lascia spento "Allow write access"** →
**Add key**. Poi sul server:

```
server$ printf 'Host github.com\n  IdentityFile ~/.ssh/registro_ore_deploy\n  IdentitiesOnly yes\n' >> ~/.ssh/config
server$ chmod 600 ~/.ssh/config
server$ ssh -T git@github.com
```

Chiede di confermare l'impronta di GitHub: deve essere
`SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU` (controllala anche
sulla pagina "GitHub's SSH key fingerprints" della documentazione di
GitHub). Rispondi `yes`; il messaggio "You've successfully authenticated"
conferma. Poi scarica il codice:

```
server$ git clone git@github.com:«UTENTE_GITHUB»/registro-ore.git /opt/registro-ore
server$ cd /opt/registro-ore
```

---

## 6. Configurazione: `.env.production` e chiave dei backup

### 6.1 Password e chiavi casuali

```
server$ cd /opt/registro-ore
server$ ./deploy/genera-segreti.sh
```

Crea `.env.production` (leggibile solo da te) con la password del database e
la chiave delle sessioni già generate, ed elenca i valori da completare.

### 6.2 Valori da completare

```
server$ nano .env.production
```

(In nano: frecce per muoversi, `Ctrl+O` e Invio per salvare, `Ctrl+X` per
uscire.) Ogni voce è spiegata nel file. Sostituisci ogni valore che contiene
`SOSTITUISCI`:

| Voce | Valore |
|---|---|
| `DOMINIO` | «DOMINIO» |
| `ACME_EMAIL` | «TUA_EMAIL» |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` | dal servizio SMTP (sezione 8) |
| `POSTA_MITTENTE` | es. `registro-ore@«DOMINIO»` |
| `ALLARMI_EMAIL` | «TUA_EMAIL» |
| `BACKUP_CHIAVE_PUBBLICA` | la scrive lo script del passo 6.3 |
| `BACKUP_REMOTO` e righe `RCLONE_…` | sezione 9.2 (si può fare dopo) |

Se una password contiene il carattere `$`, scrivila tra apici singoli:
`SMTP_PASSWORD='abc$def'`. **Eccezione: le righe `RCLONE_…` vanno scritte
senza virgolette** (le legge Docker, che le passerebbe a rclone tali e quali).
In nano salva con `Ctrl+O` **e Invio** (deve comparire "Wrote … lines").

Per controllare senza mostrare i valori:

```
server$ grep -E '^[A-Z_]+=.*SOSTITUISCI' .env.production | cut -d= -f1
```

Dopo il passo 6.3 non deve stampare nulla.

### 6.3 Chiave dei backup

I backup sono cifrati. Il server conosce solo la chiave **pubblica** (per
cifrare); la chiave **privata** (per aprirli) non deve stare sul server.

```
server$ ./deploy/crea-chiave-backup.sh
```

Lo script mostra la chiave privata (`AGE-SECRET-KEY-1…`) **una sola volta**.
Copiala:

1. nel gestore di password, voce "Registro ore – chiave backup";
2. **su carta** (stampata o scritta a mano, con cura: ogni carattere
   conta), conservata in un luogo sicuro fuori dall'ufficio, per esempio
   in busta chiusa presso la direzione dell'impianto.

Poi lo script chiede gli ultimi 6 caratteri per conferma e scrive la chiave
pubblica in `.env.production`. **Senza la chiave privata i backup non si
possono aprire, da nessuno.** Chiudi poi la finestra del terminale (la
chiave potrebbe essere rimasta nello storico dello schermo).

### 6.4 Copia di sicurezza della configurazione

```
server$ cat .env.production
```

Copia tutto il contenuto in una **nota sicura** del gestore di password
("Registro ore – .env.production"). Rifallo ogni volta che cambi il file.

---

## 7. Modello Excel e primo avvio

### 7.1 Copiare sul server i dati di BV (non stanno su git)

```
server$ mkdir -p /opt/registro-ore/modello
PC> scp modello\modello_bv.xlsx «UTENTE»@«IP_SERVER»:/opt/registro-ore/modello/
PC> scp seed\bv\contatti.json «UTENTE»@«IP_SERVER»:/opt/registro-ore/seed/bv/
```

**Per una fase di prova** non copiare il `contatti.json` reale: copia invece
un file con lo stesso formato in cui `emailInvio` e ogni responsabile sono
indirizzi tuoi (sezione 11.1). Così nessuna email delle prove può arrivare
alla segreteria o ai responsabili.

### 7.2 Avvio

```
server$ cd /opt/registro-ore
server$ ./deploy/compose.sh up -d --build --wait
```

La prima volta impiega diversi minuti (costruzione delle immagini). Se si
ferma con un errore dell'API, guarda il motivo:

```
server$ ./deploy/compose.sh logs api
```

Se c'è scritto "Configurazione di produzione non valida", l'elenco che segue
dice quali voci di `.env.production` correggere; poi rilancia il comando
`up`.

### 7.3 Database, impianto BV, primo amministratore

```
server$ ./deploy/compose.sh exec api npm run migra
server$ ./deploy/compose.sh exec api npm run carica-organizzazione -- bv
server$ ./deploy/compose.sh exec api npm run crea-admin -- --org bv --email «TUA_EMAIL» --nome «NOME» --cognome «COGNOME»
```

(«NOME» e «COGNOME» sono i tuoi.) La password dell'amministratore è chiesta a
terminale e non si vede mentre la scrivi.

### 7.4 Verifica

Apri `https://«DOMINIO»` nel browser: deve comparire la pagina di accesso con
il lucchetto. Entra con l'amministratore appena creato.

---

## 8. Posta: servizio SMTP e DNS del mittente

### 8.1 Dati SMTP

Nel pannello del servizio SMTP:

1. aggiungi e **verifica il dominio di invio**. Consiglio: usa «DOMINIO»
   stesso (es. `ore.nomeimpianto.it`), non il dominio principale
   dell'impianto, così non tocchi la posta che l'impianto già usa;
2. crea le credenziali SMTP e copia in `.env.production`: server
   (`SMTP_HOST`), porta (`587` con `SMTP_SECURE=false`, oppure `465` con
   `SMTP_SECURE=true`), utente, password;
3. `POSTA_MITTENTE=registro-ore@«DOMINIO»`.

Poi applica la configurazione:

```
server$ ./deploy/compose.sh up -d
```

**Brevo: IP autorizzati.** Brevo blocca gli invii SMTP da un indirizzo IP
che non conosce: l'email finisce in errore con `525 5.7.1 Unauthorized IP
address` (in **Gestione → Email inviate**) e Brevo manda al titolare
dell'account un'email per autorizzare l'IP. Autorizza l'IP del server (o
aggiungilo in Brevo → impostazioni di sicurezza → IP autorizzati). Se
l'email bloccata era un invito, non si può "riprovare" (contiene il link):
genera un nuovo link da **Gestione → Utenti**. Va rifatto se il server
cambia IP (sezione 14).

### 8.2 Record DNS del mittente (SPF, DKIM, DMARC)

Servono perché le email non finiscano nello spam o vengano rifiutate. Vanno
creati nel DNS del dominio, nello stesso pannello del passo 3. Il servizio
SMTP mostra i valori esatti da copiare: **usa i suoi**, questi sono gli schemi.

| Tipo | Nome | Valore | A cosa serve |
|---|---|---|---|
| TXT | «DOMINIO» | `v=spf1 include:«VALORE_DEL_FORNITORE» -all` | SPF: quali server possono spedire per il dominio |
| TXT o CNAME | `«SELETTORE»._domainkey.«DOMINIO»` | come indicato dal fornitore | DKIM: firma le email |
| TXT | `_dmarc.«DOMINIO»` | `v=DMARC1; p=none; rua=mailto:«TUA_EMAIL»` | DMARC: cosa fare delle email non autentiche |
| CNAME (se richiesto) | es. `bounce.«DOMINIO»` | come indicato dal fornitore | indirizzo di ritorno personalizzato |

Attenzione:

- per ogni nome può esistere **un solo** record SPF: se ce n'è già uno,
  aggiungi l'`include:` dentro quello esistente;
- DMARC: parti con `p=none`; dopo 2–4 settimane senza problemi nei
  rapporti che arrivano a «TUA_EMAIL», passa a `p=quarantine`;
- nel pannello del fornitore il dominio deve risultare "verificato"
  (SPF e DKIM in verde) prima di invitare i colleghi.

### 8.3 Prova

1. Dall'app: **Gestione → Utenti → crea un utente** con un tuo secondo
   indirizzo (con Gmail basta `«nome»+prova@gmail.com`: arriva nella tua
   casella ma è un utente distinto). Deve arrivare l'email con il link di
   invito. Il link si vede anche nell'app subito dopo la creazione e vale
   allo stesso modo: chi lo usa per primo imposta la password.
2. In Gmail: apri l'email → menu ⋮ → **Mostra originale**: SPF, DKIM e DMARC
   devono essere tutti **PASS**.
3. In **Gestione → Email inviate** non devono esserci email in errore.

---

## 9. Backup

### 9.1 Backup notturno

```
server$ cd /opt/registro-ore
server$ sudo ./deploy/installa-servizi.sh
server$ sudo systemctl start registro-ore-backup
server$ journalctl -u registro-ore-backup -e
```

Deve finire con "Backup completato". Da ora il backup parte ogni notte alle
02:30. Si conservano sul server 7 copie giornaliere, 4 settimanali e 6
mensili (in `/var/backups/registro-ore`), più le copie fatte prima di ogni
rilascio. Se un backup fallisce arriva un'email ad `ALLARMI_EMAIL`.

### 9.2 Copia fuori dal server

Nel pannello del fornitore dello spazio di backup crea:

- **se è compatibile S3**: un *bucket* (es. `registro-ore-backup`) in una
  regione UE e una **chiave di accesso limitata a quel bucket**. Se il
  fornitore lo permette, attiva il *versioning* o l'*object lock* sul
  bucket: anche chi entrasse nel server non potrebbe cancellare le copie.
  In `.env.production`: togli il `#` dalle righe `RCLONE_CONFIG_REMOTO_…`
  della parte S3, completa endpoint, regione e chiavi, e scrivi
  `BACKUP_REMOTO=remoto:«NOME_BUCKET»/registro-ore`.
- **se è SFTP** (es. uno "storage box"):

  ```
  server$ ssh-keygen -t ed25519 -N "" -C "backup registro-ore" -f ~/.config/registro-ore/chiavi/backup_sftp
  server$ cat ~/.config/registro-ore/chiavi/backup_sftp.pub
  ```

  aggiungi questa chiave pubblica nel pannello del fornitore (chiavi SSH
  autorizzate dello spazio), poi salva l'impronta del server remoto:

  ```
  server$ ssh-keyscan -p «PORTA_SFTP» «HOST_SFTP» > ~/.config/registro-ore/chiavi/known_hosts
  ```

  e confronta l'impronta con quella indicata dal fornitore. In
  `.env.production`: togli il `#` dalle righe della parte SFTP, completa
  host, porta e utente, e scrivi `BACKUP_REMOTO=remoto:«CARTELLA»/registro-ore`.

Poi prova:

```
server$ ./deploy/backup.sh manuale
server$ ./deploy/scarica-backup.sh
```

Il primo deve dire "Copia fuori dal server completata"; il secondo elenca le
copie remote. Per Backblaze B2 vanno bene `PROVIDER=Other` e l'endpoint S3
del bucket (con `https://`); il keyID è `ACCESS_KEY_ID`, l'applicationKey è
`SECRET_ACCESS_KEY`. Il primo backup giornaliero vale anche come primo
settimanale e mensile: su B2 compaiono tre file uguali (sul server sono
hard link, quindi lo spazio è uno solo).

### 9.3 Prova di ripristino (da fare ora, e poi ogni 3 mesi)

Un backup che non è mai stato ripristinato non è un backup. La prova usa la
copia **fuori dal server** e la chiave privata **dal gestore di password**:
verifica tutta la catena, senza toccare i dati dell'app.

```
server$ cd /opt/registro-ore
server$ ./deploy/scarica-backup.sh ultimo
server$ ./deploy/ripristina.sh ~/ripristino/«FILE_BACKUP»
```

(`scarica-backup.sh ultimo` prende l'ultima copia di `giornalieri/`: se c'è
solo un backup manuale, lancia prima `sudo systemctl start
registro-ore-backup`.) `ripristina.sh` chiede la chiave privata **subito**,
prima di fare qualsiasi cosa: incolla solo la riga `AGE-SECRET-KEY-1…` e premi
Invio (non si vede nulla, nemmeno asterischi). Chiave sbagliata = si ferma
senza toccare niente. Lo script ripristina in un database separato, mostra
una tabella con i conteggi del backup accanto a quelli attuali (devono essere
uguali o quasi) e finisce con **PROVA RIUSCITA**. **Copia prima la tabella**
(per annotare l'esito), **poi** chiudi il terminale e svuota gli appunti.
Infine:

```
server$ rm ~/ripristino/*
```

Annota la data della prova. Se fallisce, è urgente capire perché.

### 9.4 Ripristino vero (solo in caso di guasto o di dati rovinati)

Rimette il database com'era al momento del backup: **tutto ciò che è stato
registrato dopo va perso**. Avvisa i colleghi.

```
server$ cd /opt/registro-ore
server$ ls /var/backups/registro-ore/giornalieri/
server$ ./deploy/ripristina.sh /var/backups/registro-ore/giornalieri/«FILE_BACKUP» --sostituisci
```

Chiede la chiave privata e di scrivere `SOSTITUISCI`. Prima di sostituire
salva comunque una copia del database attuale (in
`/var/backups/registro-ore/manuali/`).

---

## 10. Monitoraggio

### 10.1 L'app risponde?

L'indirizzo `https://«DOMINIO»/api/stato` risponde **200** con
`{"ok":true,…}` se database, invio delle email e lavori in sottofondo
funzionano, altrimenti **503** e il nome del controllo fallito
(`"posta":"in ritardo"` = email ferme da oltre 30 minuti). Non mostra dati.

Con un servizio di monitoraggio gratuito (es. UptimeRobot o Better Stack;
verifica le condizioni d'uso del piano gratuito):

1. crea un monitor **HTTP(S)** sull'indirizzo `https://«DOMINIO»/api/stato`;
2. intervallo 5 minuti; avviso quando la risposta **non è 200**;
3. avvisi a «TUA_EMAIL» (e sull'app del servizio, se c'è);
4. se il servizio lo offre, attiva anche l'avviso di **scadenza del
   certificato** HTTPS (Caddy lo rinnova da solo; l'avviso copre i guasti).

### 10.2 Il backup è partito?

L'email di errore copre i backup falliti, non quelli che non partono
proprio (server spento, timer disattivato). Per questo, con un servizio come
Healthchecks.io (piano gratuito):

1. crea un controllo "Backup registro ore": periodo **1 giorno**, tolleranza **3 ore**;
2. copia il suo indirizzo di "ping" in `.env.production`: `BACKUP_PING_URL=https://hc-ping.com/…`;
3. al prossimo backup il controllo diventa verde; se un giorno manca, ti scrive.

---

## 11. Prima di invitare i colleghi

- [ ] `https://«DOMINIO»` si apre con il lucchetto; `http://«DOMINIO»` porta su https.
- [ ] Email di invito arrivata, SPF/DKIM/DMARC **PASS** (8.3).
- [ ] Prova di invio del mese **senza disturbare segreteria e responsabili**
  (sezione 11.1): invio, copie ai settori giusti, allegato che si apre in
  Excel, riapertura e reinvio "SOSTITUISCE IL PRECEDENTE".
- [ ] **Indirizzi reali di BV** al posto di quelli di prova (11.2).
- [ ] Backup notturno attivo, copia fuori dal server, **prova di ripristino riuscita** (9).
- [ ] Monitoraggio attivo (10).
- [ ] Gestore di password con: password di sudo, chiave privata dei backup
  (anche su carta), `.env.production`, accessi ai fornitori.
- [ ] Informativa sulla privacy completata e verificata dal consulente di BV
  (pagina `https://«DOMINIO»/#/privacy`, file `frontend/src/Privacy.jsx`).

### 11.1 Fase di prova: nessuna email a BV

L'app spedisce solo a: l'indirizzo di invio dell'organizzazione, gli
indirizzi dei responsabili dei settori (in copia all'invio del mese), gli
utenti creati nell'app e `ALLARMI_EMAIL`. Per la prova:

- sul server `seed/bv/contatti.json` è un file **di prova**: `emailInvio` =
  «TUA_EMAIL» e ogni responsabile = `«nome»+«settore»@gmail.com` (arriva
  tutto a te, e il `+…` dice quale settore sarebbe stato in copia). Il file
  reale resta sul PC;
- gli unici utenti sono il tuo amministratore e un utente di prova con un
  tuo indirizzo `+prova`;
- controllo che nel database non ci sia nessun indirizzo diverso dai tuoi
  (sostituisci `rdnrtp` con la parte prima della @ del tuo indirizzo):

```
server$ ./deploy/compose.sh exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At' <<'SQL'
WITH tutti AS (
  SELECT submission_email AS e, 'invio organizzazione' AS dove FROM organizations
  UNION ALL SELECT unnest(manager_emails), 'responsabili settore' FROM sectors
  UNION ALL SELECT email, 'utenti' FROM users
  UNION ALL SELECT unnest(to_addresses || cc_addresses), 'email in coda/inviate' FROM email_outbox
)
SELECT dove || ': ' || count(*) || ', non di prova: ' || count(*) FILTER (WHERE lower(e) NOT LIKE 'rdnrtp%@gmail.com') FROM tutti GROUP BY dove;
SQL
```

Ogni riga deve finire con `non di prova: 0`. Finché è così, nessuna email
può raggiungere BV. Durante la prova **non creare utenti** con indirizzi di
colleghi e **non modificare** le email dei settori dall'app.

Prova fatta il 12/10/2026 con l'utente "Prova Uno" (`rdnrtp+prova@gmail.com`):
mese di ottobre con ore su Nuoto e Pulizie/Manutenzione e una seduta PT;
copia a `+manutenzione`, `+pulizie`, `+nuoto`, `+prova`; riapertura e
reinvio (versione 2, "SOSTITUISCE IL PRECEDENTE").

### 11.2 Passaggio agli indirizzi reali di BV (al via libera)

1. Nessuna modifica di settori o attività fatta dall'app durante la prova
   (vedi **Gestione → Registro delle modifiche**)? Allora la via più sicura è
   ricaricare i file, con il `contatti.json` **reale**:

   ```
   PC> scp seed\bv\contatti.json «UTENTE»@«IP_SERVER»:/opt/registro-ore/seed/bv/contatti.json
   server$ cd /opt/registro-ore
   server$ ./deploy/compose.sh exec api npm run carica-organizzazione -- bv --sovrascrivi
   ```

   Riporta indirizzo di invio, settori, email dei responsabili, abbinamenti e
   attività ai file; utenti, ore e mesi inviati restano.
   Se invece hai cambiato qualcosa dall'app, non usare `--sovrascrivi`
   (cancellerebbe quelle modifiche): cambia a mano **Gestione → Impianto e
   modello Excel** (indirizzo di invio) e **Gestione → Settori** (email dei
   responsabili, uno per uno).
2. Controlla in **Gestione → Impianto** l'indirizzo di invio e in **Gestione →
   Settori** le email: devono essere quelle del regolamento del modello.
3. Utente di prova: **Gestione → Utenti → Prova Uno → disattiva**. Il suo
   mese di prova resta (visibile solo all'amministratore, tra i colleghi di
   ottobre).
4. Il primo invio vero partirà alla segreteria: avvisala che le email
   arrivano da `POSTA_MITTENTE` (per BV `notifiche@apetris.com`) con il nome
   del collega ("Nome Cognome tramite Registro ore").

---

## 12. Gestione quotidiana

Tutti i comandi dalla cartella dell'app: `cd /opt/registro-ore`.

| Per… | Comando |
|---|---|
| vedere se tutto è acceso | `./deploy/compose.sh ps` (tutti "healthy") |
| leggere i log dell'API | `./deploy/compose.sh logs --tail 100 api` |
| seguire i log dal vivo | `./deploy/compose.sh logs -f` (`Ctrl+C` per uscire) |
| riavviare l'app | `./deploy/compose.sh restart` |
| applicare modifiche a `.env.production` | `./deploy/compose.sh up -d` |
| backup a mano | `./deploy/backup.sh manuale` |
| elenco dei backup sul server | `ls -R /var/backups/registro-ore` |
| registro dei backup notturni | `journalctl -u registro-ore-backup --since "3 days ago"` |
| prossimo backup | `systemctl list-timers registro-ore-backup.timer` |
| spazio su disco | `df -h /` |
| simulare i promemoria di un giorno | `./deploy/compose.sh exec api npm run simula-promemoria -- --org bv --data 2026-10-25` |

Una volta al mese: `./deploy/compose.sh ps`, `df -h /` (sotto l'80%),
**Gestione → Email inviate** senza errori, il backup più recente in
`ls /var/backups/registro-ore/giornalieri`. Ogni 3 mesi: prova di
ripristino (9.3).

---

## 13. Aggiornare l'app (rilascio)

Sul PC: sviluppa, prova (test compresi), poi:

```
PC> git push
```

Sul server:

```
server$ cd /opt/registro-ore
server$ ./deploy/rilascia.sh
```

Lo script, in ordine: fa un backup, scarica il codice nuovo, costruisce le
immagini, applica le migrazioni del database, riavvia l'app e controlla che
risponda in HTTPS. Finisce con **RILASCIO COMPLETATO**. Meglio farlo fuori
dagli orari di lavoro e mai l'ultimo giorno del mese.

### 13.1 Se qualcosa va storto: tornare indietro

```
server$ ./deploy/torna-indietro.sh
```

Rimette il codice della versione precedente; i dati restano. Basta quasi
sempre. Solo se la nuova versione ha **rovinato i dati**:

```
server$ ./deploy/torna-indietro.sh --con-database
```

rimette anche il database com'era all'inizio del rilascio (serve la chiave
privata; quanto registrato dopo il rilascio va perso). Per andare a una
versione precisa: `./deploy/rilascia.sh «COMMIT»` (elenco delle versioni:
`git log --oneline -20 origin/HEAD`).

---

## 14. Ricostruire il server da zero

Se il server è perso (guasto, compromesso, cambio di fornitore):

1. crea un nuovo VPS (passo 3) e aggiorna il record DNS A con il nuovo IP;
   autorizza il nuovo IP anche nel servizio SMTP (Brevo, sezione 8.1);
2. passi 4 e 5;
3. invece del passo 6: `nano /opt/registro-ore/.env.production` e incolla il
   contenuto salvato nel gestore di password; poi `chmod 600 .env.production`;
4. copia le chiavi SFTP se le usavi (9.2) e
   `./deploy/compose.sh up -d --build --wait`;
5. recupera il database:
   ```
   server$ ./deploy/scarica-backup.sh ultimo
   server$ ./deploy/ripristina.sh ~/ripristino/«FILE_BACKUP» --sostituisci
   ```
   Il modello Excel e la configurazione dell'impianto sono nel database: non
   serve ricaricarli;
6. `sudo ./deploy/installa-servizi.sh` e controllo (sezione 11).

Se il server era stato **compromesso**: prima di tutto cambia nei pannelli
dei fornitori le credenziali SMTP e dello spazio di backup, e in
`.env.production` genera un nuovo `JWT_SECRET` (gli utenti dovranno rifare
l'accesso); cancella la vecchia deploy key su GitHub.

---

## 15. Cosa acquistare o creare

| Cosa | Requisiti | Note |
|---|---|---|
| **VPS** | Ubuntu 24.04 LTS; **2 vCPU, 2 GB RAM** (4 GB più comodi), **40 GB SSD**; IPv4 pubblico; centro dati nell'UE; accordo per il trattamento dei dati (GDPR, art. 28) | Un fornitore europeo semplifica l'informativa. Le istantanee (snapshot) del fornitore sono un'utile aggiunta, non sostituiscono i backup. |
| **Dominio** | Possibilità di creare record A, AAAA, TXT e CNAME | Il più semplice: un sottodominio del sito dell'impianto (es. `ore.nomeimpianto.it`) creato da chi gestisce il loro DNS. |
| **Servizio SMTP** | Invio con autenticazione su porta 587 (STARTTLS) o 465 (TLS); verifica del dominio con DKIM; dati trattati nell'UE; accordo GDPR; allegati di almeno 1 MB | Il volume è minimo (poche centinaia di email al mese): basta un piano gratuito o di base. |
| **Spazio per i backup** | Compatibile S3 (bucket nell'UE, chiavi limitate a un bucket, meglio con versioning/object lock) **oppure** SFTP con accesso a chiave | Di un **fornitore diverso** da quello del VPS. Bastano pochi GB. |
| **GitHub** | Account gratuito, repository privato | Con autenticazione a due fattori. |
| **Gestore di password** | Condivisibile con una seconda persona di fiducia dell'impianto | Per non dipendere da una sola persona. |
