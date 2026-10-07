import GestioneUtenti from './GestioneUtenti.jsx';
import GestioneAttivita from './GestioneAttivita.jsx';
import GestioneSettori from './GestioneSettori.jsx';
import GestioneImpianto from './GestioneImpianto.jsx';
import RegistroModifiche from './RegistroModifiche.jsx';

const PAGINE = [
  { chiave: 'utenti', nome: 'Utenti', descrizione: 'Nuovi colleghi, ruoli, link per la password, disattivazione' },
  { chiave: 'attivita', nome: 'Attività', descrizione: 'Nomi, ore o sedute, ordine, attive o no, settori' },
  { chiave: 'settori', nome: 'Settori', descrizione: 'Nomi, email dei responsabili, chi ne è responsabile' },
  { chiave: 'impianto', nome: 'Impianto e modello Excel', descrizione: 'Indirizzo di invio delle ore, nuovo modello Excel' },
  { chiave: 'registro', nome: 'Registro delle modifiche', descrizione: 'Chi ha cambiato cosa e quando' },
];

// Pagine di configurazione dell'amministratore: #/gestione/<pagina>.
export default function Gestione({ pagina, utente, attivita, onAttivitaCambiate }) {
  const corrente = PAGINE.find((p) => p.chiave === pagina);
  if (!corrente) {
    return (
      <div className="contenuto">
        <h1>Gestione</h1>
        <ul className="menu-gestione">
          {PAGINE.map((p) => (
            <li key={p.chiave}>
              <a href={`#/gestione/${p.chiave}`}>
                <b>{p.nome}</b>
                <small>{p.descrizione}</small>
              </a>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  let contenuto;
  if (pagina === 'utenti') contenuto = <GestioneUtenti utente={utente} />;
  else if (pagina === 'attivita') contenuto = <GestioneAttivita attivita={attivita} onCambiate={onAttivitaCambiate} />;
  else if (pagina === 'settori') contenuto = <GestioneSettori />;
  else if (pagina === 'impianto') contenuto = <GestioneImpianto onAttivitaCambiate={onAttivitaCambiate} />;
  else contenuto = <RegistroModifiche />;
  return (
    <div className="contenuto">
      <a className="indietro" href="#/gestione">
        ‹ Gestione
      </a>
      <h1>{corrente.nome}</h1>
      {contenuto}
    </div>
  );
}
