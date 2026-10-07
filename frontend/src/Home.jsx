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

const UUID = /^[0-9a-f-]{36}$/i;

// Sezioni della barra in basso. I ruoli si sommano: tutti registrano le
// proprie ore; responsabile e amministratore vedono anche i collaboratori;
// l'amministratore gestisce la configurazione.
function sezioni(ruolo) {
  const elenco = [
    { chiave: '', hash: '#/', nome: 'Mese', breve: 'Mese' },
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

  const caricaAttivita = useCallback(() => api.attivita().then(setAttivita), []);

  useEffect(() => {
    Promise.all([api.attivita(), api.mieAttivita()])
      .then(([tutte, scelte]) => {
        setAttivita(tutte);
        setMie(scelte.attivita);
      })
      .catch((err) => setErrore(err.message));
  }, []);

  const elenco = sezioni(utente.ruolo);
  const sezione = elenco.some((s) => s.chiave === (rotta[0] ?? '')) ? (rotta[0] ?? '') : '';
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
        <button type="button" className="secondario" onClick={() => confermaUscita() && onEsci()}>
          Esci
        </button>
      </header>
      <main>{contenuto}</main>
      <nav className="schede" aria-label="Sezioni">
        {elenco.map((s) => (
          <a key={s.hash} href={s.hash} aria-current={sezione === s.chiave ? 'page' : undefined}>
            {etichetta(s)}
          </a>
        ))}
      </nav>
    </div>
  );
}
