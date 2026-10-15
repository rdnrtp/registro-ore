import { useEffect, useState } from 'react';
import { api } from './api.js';
import { attiva, attiveQui, disattiva, supporto } from './push.js';

const dispositiviTesto = (n) => (n === 1 ? '1 dispositivo' : `${n} dispositivi`);

// Notifiche push sul dispositivo che si sta usando: attivazione (il permesso
// del browser si chiede solo dopo il tocco su "Attiva notifiche"),
// disattivazione, notifica di prova, istruzioni per iPhone e per il
// permesso negato.
export default function Notifiche({ utente }) {
  // null = caricamento; altrimenti { chiave, dispositivi, qui, permesso }
  const [stato, setStato] = useState(null);
  const [errore, setErrore] = useState('');
  const [avviso, setAvviso] = useState('');
  const [attesa, setAttesa] = useState(false);
  const caso = supporto();

  async function carica() {
    try {
      const { chiave_pubblica: chiave, dispositivi } = await api.statoPush();
      setStato({
        chiave,
        dispositivi,
        qui: await attiveQui(utente.id),
        permesso: caso === 'si' ? Notification.permission : null,
      });
    } catch (err) {
      setErrore(err.message);
    }
  }

  useEffect(() => {
    carica();
  }, []);

  async function esegui(azione) {
    setErrore('');
    setAvviso('');
    setAttesa(true);
    try {
      await azione();
    } catch (err) {
      setErrore(err.message || 'Operazione non riuscita');
    }
    setAttesa(false);
  }

  const suAttiva = () =>
    esegui(async () => {
      const r = await attiva(stato.chiave, utente.id);
      if (r.permesso === 'granted') {
        setStato({ ...stato, dispositivi: r.dispositivi, qui: true, permesso: 'granted' });
        setAvviso('Notifiche attivate. Prova a mandarne una qui sotto.');
      } else {
        setStato({ ...stato, permesso: r.permesso });
        if (r.permesso === 'default') setAvviso('Non hai scelto. Tocca di nuovo «Attiva notifiche» e scegli «Consenti».');
      }
    });

  const suDisattiva = () =>
    esegui(async () => {
      const { dispositivi } = await disattiva();
      setStato({ ...stato, dispositivi, qui: false });
      setAvviso('Notifiche disattivate su questo dispositivo.');
    });

  const suProva = () =>
    esegui(async () => {
      const { dispositivi } = await api.provaPush();
      setAvviso(
        dispositivi > 1
          ? `Notifica di prova inviata ai tuoi ${dispositivi} dispositivi: dovrebbe arrivare entro pochi secondi.`
          : 'Notifica di prova inviata: dovrebbe arrivare entro pochi secondi.',
      );
    });

  let corpo;
  if (!stato) {
    corpo = !errore && <p className="caricamento">Caricamento…</p>;
  } else if (!stato.chiave) {
    corpo = <p className="riquadro-pagina">Le notifiche push non sono attive su questo server: ricevi tutto per email.</p>;
  } else if (caso === 'ios-da-installare') {
    corpo = (
      <div className="riquadro-pagina">
        <p>
          <b>Su iPhone e iPad le notifiche arrivano solo all&apos;app aggiunta alla schermata Home</b> (serve iOS 16.4 o
          successivo).
        </p>
        <ol>
          <li>Apri questa pagina con <b>Safari</b>.</li>
          <li>
            Tocca il pulsante <b>Condividi</b> (il quadrato con la freccia verso l&apos;alto).
          </li>
          <li>
            Scegli <b>Aggiungi alla schermata Home</b>, poi <b>Aggiungi</b>.
          </li>
          <li>
            Apri l&apos;app dall&apos;icona <b>Presenze</b> sulla schermata Home, entra e torna in questa pagina:
            troverai il pulsante per attivare le notifiche.
          </li>
        </ol>
      </div>
    );
  } else if (caso === 'non-supportate') {
    corpo = (
      <p className="riquadro-pagina">
        Questo browser non può ricevere le notifiche dell&apos;app. Su Android usa Chrome; su iPhone aggiungi l&apos;app alla
        schermata Home con Safari. Intanto ricevi tutto per email.
      </p>
    );
  } else if (stato.permesso === 'denied') {
    corpo = (
      <div className="riquadro-pagina">
        <p>
          <b>Le notifiche sono bloccate</b> per questa app nelle impostazioni del telefono (o del browser). Per
          riattivarle:
        </p>
        <ul>
          <li>
            <b>App installata su Android</b>: tieni premuta l&apos;icona <b>Presenze</b> → <b>Informazioni app</b> (ⓘ) →{' '}
            <b>Notifiche</b> → attivale.
          </li>
          <li>
            <b>Chrome su Android</b>: tocca l&apos;icona a sinistra dell&apos;indirizzo → <b>Autorizzazioni</b> →{' '}
            <b>Notifiche</b> → <b>Consenti</b>.
          </li>
          <li>
            <b>iPhone</b>: <b>Impostazioni</b> → <b>Notifiche</b> → <b>Presenze</b> → <b>Consenti notifiche</b>.
          </li>
          <li>
            <b>Computer</b>: clic sul lucchetto a sinistra dell&apos;indirizzo → <b>Notifiche</b> → <b>Consenti</b>.
          </li>
        </ul>
        <p>Poi torna qui e tocca «Attiva notifiche».</p>
        <button type="button" onClick={suAttiva} disabled={attesa}>
          Attiva notifiche
        </button>
      </div>
    );
  } else if (stato.qui) {
    corpo = (
      <div className="riquadro-pagina">
        <p className="conferma">
          <b>Le notifiche sono attive su questo dispositivo.</b>
        </p>
        <div className="comandi-notifiche">
          <button type="button" onClick={suProva} disabled={attesa}>
            Invia una notifica di prova
          </button>
          <button type="button" className="neutro" onClick={suDisattiva} disabled={attesa}>
            Disattiva su questo dispositivo
          </button>
        </div>
      </div>
    );
  } else {
    corpo = (
      <div className="riquadro-pagina">
        <p>Le notifiche non sono attive su questo dispositivo.</p>
        <p className="dettaglio">Il telefono ti chiederà il permesso: scegli «Consenti».</p>
        <div className="comandi-notifiche">
          <button type="button" onClick={suAttiva} disabled={attesa}>
            Attiva notifiche
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="contenuto pagina-notifiche">
      <h1>Notifiche</h1>
      <p className="dettaglio">
        Con le notifiche attive ricevi sul telefono i nuovi avvisi in bacheca, i promemoria di fine mese e la riapertura
        di un tuo mese. Toccandole si apre l&apos;app sulla pagina giusta.
      </p>
      {corpo}
      {avviso && (
        <p className="conferma" role="status">
          {avviso}
        </p>
      )}
      {errore && (
        <p className="errore" role="alert">
          {errore}
        </p>
      )}
      {stato?.chiave && (
        <>
          <p className="dispositivi-notifiche">
            {stato.dispositivi
              ? `Notifiche attive su ${dispositiviTesto(stato.dispositivi)}${stato.qui && stato.dispositivi > 1 ? ', compreso questo' : ''}.`
              : 'Notifiche non attive su nessun dispositivo.'}
          </p>
          <h2>Come funzionano</h2>
          <ul className="regole-notifiche">
            <li>
              Con le notifiche attive su almeno un dispositivo, avvisi e promemoria arrivano <b>solo come notifica</b>, non
              più per email. Senza, continuano ad arrivare per email.
            </li>
            <li>La riapertura di un tuo mese arriva sempre anche per email, con la motivazione.</li>
            <li>
              Dalle 22 alle 7 non arriva nessuna notifica: quelle della notte arrivano alle 7.
            </li>
            <li>Uscendo dall&apos;app («Esci») le notifiche su questo dispositivo si spengono.</li>
          </ul>
        </>
      )}
    </div>
  );
}
