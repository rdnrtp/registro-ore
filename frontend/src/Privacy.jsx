// Informativa sulla privacy (artt. 13–14 GDPR), visibile anche senza accesso
// e collegata dalle email di invito. È una BOZZA: il titolare (l'impianto)
// e il suo consulente devono completare le parti evidenziate e verificare il
// testo prima della messa online.

// Parte da completare, ben visibile.
function Dc({ children }) {
  return <mark className="da-completare">[DA COMPLETARE: {children}]</mark>;
}

export default function Privacy() {
  return (
    <main className="pagina pagina-informativa">
      <article className="scheda informativa">
        <p className="avviso" role="note">
          <strong>Bozza in attesa di verifica.</strong> Le parti evidenziate vanno completate dal titolare del trattamento
          e il testo va controllato dal suo consulente privacy prima dell&apos;uso con dati reali.
        </p>

        <h1>Informativa sulla privacy</h1>
        <p>
          Questa informativa spiega come vengono trattati i dati personali di chi usa il Registro ore, l&apos;app con cui
          i collaboratori dell&apos;impianto registrano le ore di lavoro e le spese di trasferta da rimborsare e le inviano
          alla segreteria.
        </p>

        <h2>1. Titolare del trattamento</h2>
        <p>
          <Dc>ragione sociale dell&apos;impianto</Dc>, con sede in <Dc>indirizzo</Dc>, P.&nbsp;IVA <Dc>numero</Dc>.
          <br />
          Contatti per la privacy: <Dc>email o PEC</Dc>.
          <br />
          Responsabile della protezione dei dati (DPO): <Dc>nome e contatto, oppure togliere la riga se non nominato</Dc>.
        </p>

        <h2>2. Quali dati trattiamo</h2>
        <ul>
          <li>
            <strong>Dati di identificazione e contatto</strong>: nome, cognome, indirizzo email, ruolo nell&apos;app e
            settori di cui si è responsabili.
          </li>
          <li>
            <strong>Dati sull&apos;attività lavorativa</strong>: ore e sedute registrate per giorno e per attività,
            orario settimanale tipo, attività scelte, file mensili inviati alla segreteria con data e ora di invio,
            eventuali riaperture del mese con la loro motivazione.
          </li>
          <li>
            <strong>Sedute di personal training</strong>: data, tipo e nome del cliente, inseriti dal collaboratore.
            Sono dati di persone diverse dall&apos;utente: <Dc>indicare come i clienti vengono informati</Dc>.
          </li>
          <li>
            <strong>Spese di trasferta da rimborsare</strong>: data, tipo (per esempio pedaggio o carburante), importo,
            motivo della trasferta e copie delle ricevute (foto o PDF), con il PDF inviato alla segreteria. Le ricevute
            possono contenere altri dati personali, per esempio luoghi e orari, la targa del veicolo, il nome
            dell&apos;esercente o parte dei dati di pagamento. Prima di salvare una foto l&apos;app la riduce e toglie i
            dati nascosti nel file (per esempio la posizione GPS e il modello del telefono); i PDF sono conservati così come
            vengono caricati.
          </li>
          <li>
            <strong>Dati tecnici e di sicurezza</strong>: la password, conservata solo in forma cifrata non reversibile
            (nessuno, nemmeno l&apos;amministratore, può leggerla); il cookie di sessione; il registro delle azioni
            amministrative (per esempio creazione di utenti, riaperture, modifiche alla configurazione); le email
            inviate dall&apos;app; la lettura degli avvisi in bacheca; l&apos;indirizzo IP, usato per bloccare i
            tentativi di accesso ripetuti e registrato nei log tecnici del server.
          </li>
        </ul>

        <h2>3. Perché li trattiamo e su quale base giuridica</h2>
        <ul>
          <li>
            Registrare le ore e trasmetterle alla segreteria per il calcolo dei compensi: esecuzione del rapporto di
            collaborazione o di lavoro (art. 6, par. 1, lett. b GDPR) e adempimento di obblighi di legge fiscali e
            contributivi (lett. c). <Dc>confermare le basi giuridiche</Dc>
          </li>
          <li>
            Rimborsare le spese di trasferta e conservarne la documentazione: esecuzione del rapporto (lett. b) e
            adempimento di obblighi di legge fiscali (lett. c). <Dc>confermare le basi giuridiche</Dc>
          </li>
          <li>
            Mandare promemoria di scadenza, solleciti e avvisi della bacheca: organizzazione del lavoro, nell&apos;ambito
            dello stesso rapporto (lett. b).
          </li>
          <li>
            Proteggere l&apos;app e i dati (accessi, registro delle azioni, backup): legittimo interesse del titolare alla
            sicurezza dei sistemi (lett. f).
          </li>
          <li>
            Nomi dei clienti delle sedute di personal training: <Dc>base giuridica secondo il titolare</Dc>.
          </li>
        </ul>
        <p>
          I dati sono necessari per registrare e trasmettere le ore. <Dc>indicare se esiste un modo alternativo
          all&apos;app, per esempio il foglio Excel compilato a mano</Dc>. Non vengono usati per profilazione,
          pubblicità o decisioni automatizzate.
        </p>

        <h2>4. Chi vede i dati</h2>
        <ul>
          <li>Ogni utente vede e modifica solo le proprie registrazioni.</li>
          <li>
            I responsabili di settore vedono, in sola lettura, le ore registrate nelle attività dei propri settori, non i
            nomi dei clienti.
          </li>
          <li>
            Gli amministratori dell&apos;app (<Dc>chi sono: ruoli o uffici</Dc>) vedono tutto in sola lettura e gestiscono
            gli utenti. Nessuno può modificare le registrazioni di un altro.
          </li>
          <li>
            Il file mensile viene inviato per email alla segreteria, con copia ai responsabili dei settori interessati e
            all&apos;utente stesso.
          </li>
          <li>
            Spese e ricevute le vedono solo l&apos;utente e gli amministratori, non i responsabili di settore. Il PDF delle
            spese viene inviato per email solo alla segreteria, con copia all&apos;utente. Le ricevute si aprono solo
            dall&apos;app, dopo l&apos;accesso: non hanno un indirizzo pubblico.
          </li>
          <li>
            Fornitori che trattano i dati per conto del titolare, come responsabili del trattamento (art. 28 GDPR):
            server <Dc>nome del fornitore e paese del centro dati</Dc>, invio delle email <Dc>nome del fornitore</Dc>,
            copie di sicurezza <Dc>nome del fornitore e paese</Dc>. <Dc>persona che gestisce tecnicamente
            l&apos;app, se esterna al titolare</Dc>.
          </li>
        </ul>
        <p>
          I dati sono conservati su server nell&apos;Unione Europea e non vengono trasferiti fuori dall&apos;Unione.{' '}
          <Dc>verificare per ogni fornitore</Dc>
        </p>

        <h2>5. Come li proteggiamo</h2>
        <p>
          Connessione sempre cifrata (HTTPS), password conservate in forma non reversibile, accesso ai dati limitato
          secondo il ruolo, link di invito personali che valgono una sola volta e scadono, copie di sicurezza giornaliere
          cifrate conservate anche fuori dal server.
        </p>

        <h2>6. Per quanto tempo li conserviamo</h2>
        <ul>
          <li>
            Ore, sedute e file mensili inviati: <Dc>periodo, per esempio 10 anni dall&apos;invio per gli obblighi
            fiscali</Dc>.
          </li>
          <li>
            Spese, ricevute e PDF delle spese inviati: <Dc>periodo, per esempio 10 anni per la documentazione
            fiscale</Dc>. Le ricevute caricate ma mai salvate in una spesa vengono cancellate dopo un giorno.
          </li>
          <li>
            Account dell&apos;utente: disattivato alla fine della collaborazione; nome ed email cancellati o resi anonimi
            dopo <Dc>periodo</Dc>.
          </li>
          <li>
            Email inviate dall&apos;app e notifiche: <Dc>periodo, per esempio 12 mesi</Dc>. Il testo delle email con un
            link di invito viene cancellato subito dopo l&apos;invio.
          </li>
          <li>Registro delle azioni amministrative: <Dc>periodo</Dc>.</li>
          <li>Log tecnici del server: <Dc>periodo, per esempio 30 giorni</Dc>.</li>
          <li>
            Copie di sicurezza: fino a 6 mesi; i dati cancellati dall&apos;app spariscono anche dalle copie entro questo
            tempo.
          </li>
        </ul>

        <h2>7. Cookie</h2>
        <p>
          L&apos;app usa un solo cookie tecnico, necessario per restare collegati (<code>registro_ore_sessione</code>,
          durata massima 7 giorni). Non usa cookie di profilazione, di terze parti o strumenti di statistica, per cui non
          serve il consenso.
        </p>

        <h2>8. I tuoi diritti</h2>
        <p>
          Puoi chiedere al titolare di accedere ai tuoi dati, correggerli, cancellarli (nei limiti degli obblighi di
          conservazione), limitarne il trattamento, opporti al trattamento basato sul legittimo interesse e ricevere i dati
          in un formato leggibile (artt. 15–22 GDPR), scrivendo a <Dc>email o PEC</Dc>. Hai anche diritto di proporre
          reclamo al Garante per la protezione dei dati personali (garanteprivacy.it).
        </p>

        <p className="dettaglio">
          Ultimo aggiornamento: <Dc>data</Dc>
        </p>
        <p>
          <a href="#/">Torna al Registro ore</a>
        </p>
      </article>
    </main>
  );
}
