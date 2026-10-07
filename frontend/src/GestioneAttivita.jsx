import { useEffect, useState } from 'react';
import { api } from './api.js';
import Foglio from './Foglio.jsx';

function SchedaAttivita({ attivita: a, settori, onSalvata, onChiudi }) {
  const [nome, setNome] = useState(a.nome);
  const [unita, setUnita] = useState(a.unita);
  const [attiva, setAttiva] = useState(a.attiva);
  const [scelti, setScelti] = useState(a.settori);
  const [errore, setErrore] = useState('');
  const [invio, setInvio] = useState(false);

  async function salva(evento) {
    evento.preventDefault();
    if (unita !== a.unita) {
      const domanda =
        unita === 'sedute'
          ? `"${a.nome}" si conterà in sedute invece che in ore, anche per le registrazioni già fatte. Continuare?`
          : `"${a.nome}" si conterà in ore invece che in sedute, anche per le registrazioni già fatte. Continuare?`;
      if (!window.confirm(domanda)) return;
    }
    setErrore('');
    setInvio(true);
    try {
      await api.modificaAttivita(a.id, { nome, unita, attiva, settori: scelti });
      onSalvata();
    } catch (err) {
      setErrore(err.message);
      setInvio(false);
    }
  }

  return (
    <Foglio
      titolo={a.nome}
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
            <button type="submit" form="form-attivita" disabled={invio}>
              Salva
            </button>
          </div>
        </>
      }
    >
      <form id="form-attivita" className="form-gestione" onSubmit={salva}>
        <label>
          Nome nell&apos;app
          <input value={nome} onChange={(e) => setNome(e.target.value)} required maxLength={100} />
        </label>
        <p className="dettaglio">
          Nel file Excel questa attività è sempre la riga {a.riga_modello}, «{a.nome_modello}»: il nome che scegli qui
          cambia solo quello che si vede nell&apos;app. Per cambiare il nome nel file serve un nuovo modello Excel.
        </p>
        <fieldset>
          <legend>Si conta in</legend>
          <div className="scelta">
            {['ore', 'sedute'].map((u) => (
              <button key={u} type="button" aria-pressed={unita === u} className={unita === u ? 'scelto' : ''} onClick={() => setUnita(u)}>
                {u}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="opzione">
          <input type="checkbox" checked={attiva} onChange={(e) => setAttiva(e.target.checked)} />
          <span>
            In uso <small>se la togli, nessuno potrà più registrarla (le ore già inserite restano)</small>
          </span>
        </label>
        <fieldset>
          <legend>Settori</legend>
          <p className="dettaglio">I responsabili di questi settori vedranno le ore registrate su questa attività.</p>
          <ul className="scelte-attivita">
            {settori.map((s) => (
              <li key={s.id}>
                <label className={scelti.includes(s.id) ? 'scelta-attiva' : ''}>
                  <input
                    type="checkbox"
                    checked={scelti.includes(s.id)}
                    onChange={() => setScelti(scelti.includes(s.id) ? scelti.filter((x) => x !== s.id) : [...scelti, s.id])}
                  />
                  <span>{s.nome}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      </form>
    </Foglio>
  );
}

// Attività dell'impianto: vengono dalle righe del modello Excel, quindi qui
// non se ne creano né eliminano (una nuova riga arriva con un nuovo modello).
export default function GestioneAttivita({ attivita, onCambiate }) {
  const [settori, setSettori] = useState([]);
  const [aperta, setAperta] = useState(null);
  const [errore, setErrore] = useState('');
  const [spostando, setSpostando] = useState(false);

  useEffect(() => {
    api
      .settori()
      .then(setSettori)
      .catch((err) => setErrore(err.message));
  }, []);

  const nomeSettore = new Map(settori.map((s) => [s.id, s.nome]));

  async function sposta(indice, delta) {
    const ids = attivita.map((a) => a.id);
    [ids[indice], ids[indice + delta]] = [ids[indice + delta], ids[indice]];
    setErrore('');
    setSpostando(true);
    try {
      await api.ordineAttivita(ids);
      await onCambiate();
    } catch (err) {
      setErrore(err.message);
    }
    setSpostando(false);
  }

  return (
    <>
      <p className="dettaglio">
        Le attività corrispondono alle righe del modello Excel. Qui puoi cambiare come si chiamano nell&apos;app, se si
        contano in ore o sedute, se sono in uso, a quali settori appartengono e in che ordine compaiono.
      </p>
      {errore && (
        <p className="errore" role="alert">
          {errore}
        </p>
      )}
      <ul className="elenco-attivita">
        {attivita.map((a, i) => (
          <li key={a.id} className={a.attiva ? '' : 'spento'}>
            <button type="button" className="apri" onClick={() => setAperta(a)}>
              <span className="persona-nome">
                {a.nome}
                {a.nome !== a.nome_modello && <small>nel file: «{a.nome_modello}»</small>}
                <small>
                  {a.unita}
                  {!a.attiva && ' · non in uso'} · {a.settori.length ? a.settori.map((id) => nomeSettore.get(id)).join(', ') : 'nessun settore'}
                </small>
              </span>
            </button>
            <span className="ordine">
              <button type="button" aria-label={`Sposta su ${a.nome}`} disabled={spostando || i === 0} onClick={() => sposta(i, -1)}>
                ↑
              </button>
              <button
                type="button"
                aria-label={`Sposta giù ${a.nome}`}
                disabled={spostando || i === attivita.length - 1}
                onClick={() => sposta(i, 1)}
              >
                ↓
              </button>
            </span>
          </li>
        ))}
      </ul>
      {aperta && (
        <SchedaAttivita
          attivita={aperta}
          settori={settori}
          onChiudi={() => setAperta(null)}
          onSalvata={async () => {
            setAperta(null);
            await onCambiate();
          }}
        />
      )}
    </>
  );
}
