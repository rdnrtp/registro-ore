import { useEffect, useState } from 'react';
import { api } from './api.js';
import Mese from './Mese.jsx';
import MieAttivita from './MieAttivita.jsx';
import OrarioTipo from './OrarioTipo.jsx';

const PAGINE = [
  { hash: '#/', nome: 'Mese' },
  { hash: '#/attivita', nome: 'Le mie attività' },
  { hash: '#/orario', nome: 'Orario tipo' },
];

// Pagina scelta dall'ancora dell'indirizzo (#/attivita ...): il tasto
// "indietro" del telefono torna alla pagina precedente.
function usaPagina() {
  const leggi = () => (PAGINE.some((p) => p.hash === window.location.hash) ? window.location.hash : '#/');
  const [pagina, setPagina] = useState(leggi);
  useEffect(() => {
    const cambia = () => {
      setPagina(leggi());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', cambia);
    return () => window.removeEventListener('hashchange', cambia);
  }, []);
  return pagina;
}

export default function Home({ sessione, onEsci }) {
  const { utente, organizzazione } = sessione;
  const pagina = usaPagina();
  const [attivita, setAttivita] = useState(null);
  const [mie, setMie] = useState(null);
  const [errore, setErrore] = useState('');

  useEffect(() => {
    Promise.all([api.attivita(), api.mieAttivita()])
      .then(([tutte, scelte]) => {
        setAttivita(tutte);
        setMie(scelte.attivita);
      })
      .catch((err) => setErrore(err.message));
  }, []);

  let contenuto;
  if (errore) {
    contenuto = (
      <p className="errore riquadro" role="alert">
        {errore}
      </p>
    );
  } else if (!attivita) {
    contenuto = <p className="caricamento">Caricamento…</p>;
  } else if (pagina === '#/attivita') {
    contenuto = <MieAttivita attivita={attivita} mie={mie} onSalvate={setMie} />;
  } else if (pagina === '#/orario') {
    contenuto = <OrarioTipo attivita={attivita} mie={mie} />;
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
          </small>
        </span>
        <button type="button" className="secondario" onClick={onEsci}>
          Esci
        </button>
      </header>
      <main>{contenuto}</main>
      <nav className="schede" aria-label="Sezioni">
        {PAGINE.map((p) => (
          <a key={p.hash} href={p.hash} aria-current={pagina === p.hash ? 'page' : undefined}>
            {p.nome}
          </a>
        ))}
      </nav>
    </div>
  );
}
