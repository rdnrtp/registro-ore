import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { oggiIso } from './date.js';
import { confermaUscita, usaRotta } from './navigazione.js';
import Mese from './Mese.jsx';
import MieAttivita from './MieAttivita.jsx';
import OrarioTipo from './OrarioTipo.jsx';
import Collaboratori from './Collaboratori.jsx';
import MeseCollaboratore from './MeseCollaboratore.jsx';
import Gestione from './Gestione.jsx';
import Bacheca from './Bacheca.jsx';
import Foglio from './Foglio.jsx';
import Notifiche from './Notifiche.jsx';
import { rinnova } from './push.js';

const UUID = /^[0-9a-f-]{36}$/i;

// Sezioni della barra in basso. I ruoli si sommano: tutti registrano le
// proprie ore; responsabile e amministratore vedono anche i collaboratori;
// l'amministratore gestisce la configurazione.
function sezioni(ruolo) {
  const elenco = [
    { chiave: '', hash: '#/', nome: 'Mese', breve: 'Mese' },
    { chiave: 'bacheca', hash: '#/bacheca', nome: 'Bacheca', breve: 'Bacheca' },
    { chiave: 'attivita', hash: '#/attivita', nome: 'Le mie attività', breve: 'Attività' },
    { chiave: 'orario', hash: '#/orario', nome: 'Orario tipo', breve: 'Orario' },
  ];
  if (ruolo !== 'collaboratore') elenco.push({ chiave: 'collaboratori', hash: '#/collaboratori', nome: 'Collaboratori', breve: 'Colleghi' });
  if (ruolo === 'amministratore') elenco.push({ chiave: 'gestione', hash: '#/gestione', nome: 'Gestione', breve: 'Gestione' });
  return elenco;
}

// Anno e mese dall'indirizzo, oppure il mese corrente.
function annoMese(anno, mese) {
  const a = Number(anno);
  const m = Number(mese);
  if (Number.isInteger(a) && a >= 2000 && a <= 2100 && Number.isInteger(m) && m >= 1 && m <= 12) return { anno: a, mese: m };
  const oggi = oggiIso();
  return { anno: Number(oggi.slice(0, 4)), mese: Number(oggi.slice(5, 7)) };
}

export default function Home({ sessione, onEsci }) {
  const { utente, organizzazione } = sessione;
  const rotta = usaRotta();
  const [attivita, setAttivita] = useState(null);
  const [mie, setMie] = useState(null);
  const [errore, setErrore] = useState('');
  const [nonLetti, setNonLetti] = useState(0);
  // Pannello "Esci": null = chiuso, altrimenti { attesa, errore }.
  const [uscita, setUscita] = useState(null);

  const caricaAttivita = useCallback(() => api.attivita().then(setAttivita), []);
  const contaNonLetti = useCallback(
    () =>
      api
        .avvisiNonLetti()
        .then((d) => setNonLetti(d.non_letti))
        .catch(() => {}),
    [],
  );

  // Contatore degli avvisi non letti: a ogni cambio di pagina e ogni minuto.
  useEffect(() => {
    contaNonLetti();
  }, [contaNonLetti, rotta[0]]);
  useEffect(() => {
    const timer = setInterval(contaNonLetti, 60_000);
    return () => clearInterval(timer);
  }, [contaNonLetti]);

  // Push attivate su questo dispositivo: si rinnova l'iscrizione (dopo un
  // nuovo accesso quella della sessione precedente non c'è più).
  useEffect(() => {
    rinnova(utente.id);
  }, [utente.id]);

  useEffect(() => {
    Promise.all([api.attivita(), api.mieAttivita()])
      .then(([tutte, scelte]) => {
        setAttivita(tutte);
        setMie(scelte.attivita);
      })
      .catch((err) => setErrore(err.message));
  }, []);

  const elenco = sezioni(utente.ruolo);
  // La pagina Notifiche (dalla barra in alto) non è una sezione della barra in basso.
  const sezione = rotta[0] === 'notifiche' ? null : elenco.some((s) => s.chiave === (rotta[0] ?? '')) ? (rotta[0] ?? '') : '';
  const etichetta = (s) => (elenco.length > 3 ? s.breve : s.nome);

  let contenuto;
  if (errore) {
    contenuto = (
      <p className="errore riquadro" role="alert">
        {errore}
      </p>
    );
  } else if (!attivita) {
    contenuto = <p className="caricamento">Caricamento…</p>;
  } else if (rotta[0] === 'notifiche') {
    contenuto = <Notifiche utente={utente} />;
  } else if (rotta[0] === 'mese' && rotta.length === 3) {
    // Mese indicato (link di notifiche ed email: il mese da inviare o da correggere).
    contenuto = <Mese key={rotta.join('/')} attivita={attivita} mie={mie} iniziale={annoMese(rotta[1], rotta[2])} />;
  } else if (sezione === 'bacheca') {
    contenuto = <Bacheca aperto={UUID.test(rotta[1] ?? '') ? rotta[1] : null} utente={utente} onLetto={contaNonLetti} />;
  } else if (sezione === 'attivita') {
    contenuto = <MieAttivita attivita={attivita} mie={mie} onSalvate={setMie} />;
  } else if (sezione === 'orario') {
    contenuto = <OrarioTipo attivita={attivita} mie={mie} />;
  } else if (sezione === 'collaboratori' && UUID.test(rotta[1] ?? '')) {
    const { anno, mese } = annoMese(rotta[2], rotta[3]);
    contenuto = <MeseCollaboratore key={rotta[1]} id={rotta[1]} anno={anno} mese={mese} attivita={attivita} utente={utente} />;
  } else if (sezione === 'collaboratori') {
    const { anno, mese } = annoMese(rotta[1], rotta[2]);
    contenuto = <Collaboratori anno={anno} mese={mese} utente={utente} />;
  } else if (sezione === 'gestione') {
    contenuto = <Gestione pagina={rotta[1] ?? ''} utente={utente} attivita={attivita} onAttivitaCambiate={caricaAttivita} />;
  } else {
    contenuto = <Mese attivita={attivita} mie={mie} />;
  }

  async function esci(ovunque) {
    setUscita({ attesa: true, errore: '' });
    try {
      await onEsci(ovunque);
    } catch (err) {
      setUscita({ attesa: false, errore: `Uscita non riuscita: ${err.message}. Riprova.` });
    }
  }

  return (
    <div className="pagina con-schede">
      <header className="barra">
        <span className="organizzazione">
          {organizzazione.nome}
          <small>
            {utente.nome} {utente.cognome}
            {utente.ruolo !== 'collaboratore' && ` · ${utente.ruolo}`}
          </small>
        </span>
        <span className="comandi-barra">
          <a className="pulsante-barra" href="#/notifiche" aria-current={rotta[0] === 'notifiche' ? 'page' : undefined}>
            Notifiche
          </a>
          <button type="button" className="secondario" onClick={() => confermaUscita() && setUscita({ attesa: false, errore: '' })}>
            Esci
          </button>
        </span>
      </header>
      <main>
        {contenuto}
        <a className="link-privacy" href="#/privacy">
          Informativa sulla privacy
        </a>
      </main>
      <nav className={`schede${elenco.length > 5 ? ' molte' : ''}`} aria-label="Sezioni">
        {elenco.map((s) => (
          <a key={s.hash} href={s.hash} aria-current={sezione === s.chiave ? 'page' : undefined}>
            {etichetta(s)}
            {s.chiave === 'bacheca' && nonLetti > 0 && (
              <span className="contatore-schede" aria-label={`${nonLetti} da leggere`}>
                {nonLetti}
              </span>
            )}
          </a>
        ))}
      </nav>
      {uscita && (
        <Foglio
          titolo="Esci"
          onChiudi={() => setUscita(null)}
          piede={
            <>
              <button type="button" onClick={() => esci(false)} disabled={uscita.attesa}>
                Esci da questo dispositivo
              </button>
              <button type="button" className="pericolo" onClick={() => esci(true)} disabled={uscita.attesa}>
                Esci da tutti i dispositivi
              </button>
              <button type="button" className="neutro" onClick={() => setUscita(null)} disabled={uscita.attesa}>
                Annulla
              </button>
            </>
          }
        >
          <p>
            Su un computer usato da più persone, per esempio quello della reception, esci sempre prima di andare via.
          </p>
          <p className="dettaglio">
            &laquo;Esci da tutti i dispositivi&raquo; chiude anche gli accessi rimasti aperti altrove (un altro computer,
            un telefono perso): per rientrare servirà di nuovo la password.
          </p>
          {uscita.errore && (
            <p className="errore" role="alert">
              {uscita.errore}
            </p>
          )}
        </Foglio>
      )}
    </div>
  );
}
