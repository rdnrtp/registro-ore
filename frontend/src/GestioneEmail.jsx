import { useEffect, useState } from 'react';
import { api } from './api.js';
import { dataOra } from './GestioneUtenti.jsx';

const TIPI = {
  invio_mese: 'Invio del mese',
  invito: 'Link di invito',
  promemoria: 'Promemoria',
  sollecito: 'Sollecito',
  avviso: 'Avviso in bacheca',
  riapertura: 'Mese riaperto',
};
const STATI = { in_attesa: 'in attesa', inviata: 'inviata', errore: 'errore' };
const FILTRI = [
  ['', 'Tutte'],
  ['in_attesa', 'In attesa'],
  ['errore', 'Errori'],
  ['inviata', 'Inviate'],
];

// Email in uscita e il loro stato. "Inviata" = consegnata al server di posta.
export default function GestioneEmail() {
  const [email, setEmail] = useState([]);
  const [filtro, setFiltro] = useState('');
  const [finito, setFinito] = useState(false);
  const [caricamento, setCaricamento] = useState(true);
  const [errore, setErrore] = useState('');

  async function carica(salta, stato) {
    setCaricamento(true);
    setErrore('');
    try {
      const { email: nuove } = await api.email(salta, stato);
      setEmail((prima) => (salta ? [...prima, ...nuove] : nuove));
      setFinito(nuove.length < 100);
    } catch (err) {
      setErrore(err.message);
    }
    setCaricamento(false);
  }
  useEffect(() => {
    carica(0, filtro);
  }, [filtro]);

  async function riprova(e) {
    if (!window.confirm(`Riprovare l'invio di «${e.oggetto}»? Se l'errore dice che l'invio è stato interrotto, l'email potrebbe essere già arrivata.`)) return;
    try {
      await api.riprovaEmail(e.id);
      carica(0, filtro);
    } catch (err) {
      setErrore(err.message);
    }
  }

  return (
    <>
      <p className="dettaglio">
        Le email partono in sottofondo: se il server di posta non risponde vengono ritentate più volte, a intervalli crescenti, e
        poi segnate in errore.
      </p>
      <div className="scelta filtri">
        {FILTRI.map(([valore, nome]) => (
          <button key={valore} type="button" aria-pressed={filtro === valore} onClick={() => setFiltro(valore)}>
            {nome}
          </button>
        ))}
      </div>
      {errore && (
        <p className="errore" role="alert">
          {errore}
        </p>
      )}
      <ul className="registro">
        {email.map((e) => (
          <li key={e.id}>
            <span>
              <span className={`etichetta stato-${e.stato}`}>{STATI[e.stato] ?? e.stato}</span> <b>{e.oggetto}</b>
            </span>
            <small>
              {TIPI[e.tipo] ?? e.tipo} · a {e.a.join(', ')}
              {e.cc.length > 0 && ` · copia ${e.cc.join(', ')}`}
            </small>
            <small>
              Creata il {dataOra(e.creata_il)}
              {e.inviata_il && ` · inviata il ${dataOra(e.inviata_il)}`}
              {e.tentativi > 1 && ` · ${e.tentativi} tentativi`}
              {e.prossimo_tentativo && e.errore && ` · nuovo tentativo il ${dataOra(e.prossimo_tentativo)}`}
            </small>
            {e.errore && <small className="errore">{e.errore}</small>}
            {e.si_puo_riprovare && (
              <button type="button" className="collegamento" onClick={() => riprova(e)}>
                Riprova
              </button>
            )}
          </li>
        ))}
      </ul>
      {!caricamento && email.length === 0 && !errore && <p className="caricamento">Nessuna email.</p>}
      {caricamento && <p className="caricamento">Caricamento…</p>}
      {!caricamento && !finito && (
        <button type="button" className="neutro" onClick={() => carica(email.length, filtro)}>
          Più vecchie
        </button>
      )}
    </>
  );
}
