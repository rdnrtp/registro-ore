import { useEffect, useState } from 'react';
import { api } from './api.js';
import Foglio from './Foglio.jsx';

// Creazione (settore = null) o modifica di un settore.
function SchedaSettore({ settore, utenti, onSalvato, onChiudi }) {
  const [nome, setNome] = useState(settore?.nome ?? '');
  const [email, setEmail] = useState((settore?.email_responsabili ?? []).join('\n'));
  const [scelti, setScelti] = useState(settore?.responsabili ?? []);
  const [errore, setErrore] = useState('');
  const [invio, setInvio] = useState(false);

  async function esegui(azione) {
    setErrore('');
    setInvio(true);
    try {
      await azione();
      onSalvato();
    } catch (err) {
      setErrore(err.message);
      setInvio(false);
    }
  }

  function salva(evento) {
    evento.preventDefault();
    const corpo = {
      nome,
      email_responsabili: email.split(/[\s,;]+/).filter(Boolean),
      responsabili: scelti,
    };
    esegui(() => (settore ? api.modificaSettore(settore.id, corpo) : api.creaSettore(corpo)));
  }

  function elimina() {
    const domanda =
      `Eliminare il settore "${settore.nome}"? Le attività non saranno più collegate a questo settore e i suoi ` +
      'responsabili non vedranno più quelle ore. Le ore registrate restano.';
    if (window.confirm(domanda)) esegui(() => api.eliminaSettore(settore.id));
  }

  // I responsabili attivi, più chi è già indicato anche se ora è disattivato.
  const persone = utenti.filter((u) => u.ruolo === 'responsabile' && (u.attivo || settore?.responsabili.includes(u.id)));

  return (
    <Foglio
      titolo={settore ? settore.nome : 'Nuovo settore'}
      onChiudi={onChiudi}
      piede={
        <>
          {errore && (
            <p className="errore" role="alert">
              {errore}
            </p>
          )}
          <div className="pulsanti">
            <button type="button" className="neutro" onClick={onChiudi}>
              Annulla
            </button>
            <button type="submit" form="form-settore" disabled={invio}>
              Salva
            </button>
          </div>
        </>
      }
    >
      <form id="form-settore" className="form-gestione" onSubmit={salva}>
        <label>
          Nome
          <input value={nome} onChange={(e) => setNome(e.target.value)} required maxLength={100} />
        </label>
        <label>
          Email dei responsabili (una per riga)
          <textarea rows={3} value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" />
        </label>
        <p className="dettaglio">Gli indirizzi da mettere in copia quando si invia il file del mese.</p>
        <fieldset>
          <legend>Responsabili nell&apos;app</legend>
          <p className="dettaglio">Vedono le ore registrate sulle attività di questo settore.</p>
          {persone.length === 0 ? (
            <p className="dettaglio">Nessun utente ha il ruolo di responsabile: assegnalo nella pagina Utenti.</p>
          ) : (
            <ul className="scelte-attivita">
              {persone.map((u) => (
                <li key={u.id}>
                  <label className={scelti.includes(u.id) ? 'scelta-attiva' : ''}>
                    <input
                      type="checkbox"
                      checked={scelti.includes(u.id)}
                      onChange={() => setScelti(scelti.includes(u.id) ? scelti.filter((x) => x !== u.id) : [...scelti, u.id])}
                    />
                    <span>
                      {u.cognome} {u.nome}
                      {!u.attivo && <small> (disattivato)</small>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
      </form>
      {settore && (
        <div className="azioni-utente">
          <button type="button" className="pericolo" onClick={elimina} disabled={invio}>
            Elimina il settore
          </button>
        </div>
      )}
    </Foglio>
  );
}

export default function GestioneSettori() {
  const [settori, setSettori] = useState(null);
  const [utenti, setUtenti] = useState([]);
  const [errore, setErrore] = useState('');
  const [aperto, setAperto] = useState(undefined); // undefined = chiuso, null = nuovo

  const carica = () =>
    Promise.all([api.settori(), api.utenti()])
      .then(([s, u]) => {
        setSettori(s);
        setUtenti(u);
      })
      .catch((err) => setErrore(err.message));
  useEffect(() => {
    carica();
  }, []);

  const nome = new Map(utenti.map((u) => [u.id, `${u.nome} ${u.cognome}`]));

  return (
    <>
      <button type="button" className="nuovo" onClick={() => setAperto(null)}>
        + Nuovo settore
      </button>
      {errore && (
        <p className="errore" role="alert">
          {errore}
        </p>
      )}
      {!settori && !errore && <p className="caricamento">Caricamento…</p>}
      <ul className="elenco-persone">
        {(settori ?? []).map((s) => (
          <li key={s.id}>
            <button type="button" onClick={() => setAperto(s)}>
              <span className="persona-nome">
                {s.nome}
                <small>
                  Responsabili: {s.responsabili.length ? s.responsabili.map((id) => nome.get(id) ?? '?').join(', ') : 'nessuno'}
                </small>
                <small>Email: {s.email_responsabili.length ? s.email_responsabili.join(', ') : 'nessuna'}</small>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {aperto !== undefined && (
        <SchedaSettore
          key={aperto?.id ?? 'nuovo'}
          settore={aperto}
          utenti={utenti}
          onChiudi={() => setAperto(undefined)}
          onSalvato={() => {
            setAperto(undefined);
            carica();
          }}
        />
      )}
    </>
  );
}
