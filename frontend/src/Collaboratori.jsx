import { useEffect, useState } from 'react';
import { api } from './api.js';
import { NOMI_MESI, maiuscola, meseVicino, numero } from './date.js';
import { NavigazioneMese } from './VistaMese.jsx';

// Elenco dei collaboratori visibili nel mese, con totale e stato.
// Amministratore: tutti. Responsabile: chi ha registrazioni nei suoi settori,
// con i totali di quei settori soltanto.
export default function Collaboratori({ anno, mese, utente }) {
  const [dati, setDati] = useState(null);
  const [errore, setErrore] = useState('');
  const admin = utente.ruolo === 'amministratore';

  useEffect(() => {
    let attivo = true;
    setDati(null);
    setErrore('');
    api
      .collaboratori(anno, mese)
      .then((d) => attivo && setDati(d))
      .catch((err) => attivo && setErrore(err.message));
    return () => {
      attivo = false;
    };
  }, [anno, mese]);

  const vai = (delta) => {
    const m = meseVicino(anno, mese, delta);
    window.location.hash = `#/collaboratori/${m.anno}/${m.mese}`;
  };
  const nomeMese = `${NOMI_MESI[mese - 1]} ${anno}`;
  const elenco = dati?.collaboratori ?? [];
  const inviati = elenco.filter((c) => c.stato === 'inviato').length;

  return (
    <div className="mese">
      <div className="testata-mese">
        <NavigazioneMese titolo={maiuscola(nomeMese)} onPrecedente={() => vai(-1)} onSuccessivo={() => vai(1)} />
        {dati && (
          <p className="riassunto">
            {elenco.length} {elenco.length === 1 ? 'collaboratore' : 'collaboratori'} · {inviati} {inviati === 1 ? 'mese inviato' : 'mesi inviati'}
          </p>
        )}
      </div>
      {!admin && (
        <p className="avviso riquadro">
          Vedi solo chi ha registrato ore nei tuoi settori
          {utente.settori.length ? ` (${utente.settori.map((s) => s.nome).join(', ')})` : ''}, e solo quelle righe.
          {utente.settori.length === 0 && ' Non sei ancora responsabile di nessun settore: chiedi all’amministratore.'}
        </p>
      )}
      {errore && (
        <p className="errore riquadro" role="alert">
          {errore}
        </p>
      )}
      {!dati && !errore && <p className="caricamento">Caricamento…</p>}
      {dati && elenco.length === 0 && <p className="caricamento">Nessuno da mostrare in {nomeMese}.</p>}
      {elenco.length > 0 && (
        <ul className="elenco-persone">
          {elenco.map((c) => (
            <li key={c.id}>
              <a href={`#/collaboratori/${c.id}/${anno}/${mese}`}>
                <span className="persona-nome">
                  {c.cognome} {c.nome}
                  {!c.attivo && <small className="etichetta spenta">disattivato</small>}
                </span>
                <span className="persona-totale">
                  <b>{numero(c.ore)} h</b>
                  {c.sedute > 0 && <small>{numero(c.sedute)} sedute</small>}
                </span>
                <span className={`etichetta ${c.stato === 'inviato' ? 'inviato' : ''}`}>{c.stato}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
