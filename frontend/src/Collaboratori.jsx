import { useEffect, useState } from 'react';
import { api } from './api.js';
import { NOMI_MESI, maiuscola, meseVicino, numero } from './date.js';
import { NavigazioneMese } from './VistaMese.jsx';

const dataBreve = (iso) =>
  new Date(iso).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });

function Stato({ c }) {
  if (c.stato === 'inviato') return <span className="etichetta inviato">inviato {dataBreve(c.inviato_il)}</span>;
  if (c.riaperto) return <span className="etichetta riaperto">riaperto</span>;
  if (c.esonerato) return <span className="etichetta">esonerato</span>;
  if (c.manca) return <span className="etichetta manca">manca</span>;
  return <span className="etichetta">{c.stato}</span>;
}

// Elenco dei collaboratori visibili nel mese, con totale e stato dell'invio.
// Amministratore: il quadro degli invii (chi ha inviato e quando, chi manca,
// solleciti). Responsabile: chi ha registrazioni nei suoi settori, con i
// totali di quei settori soltanto.
export default function Collaboratori({ anno, mese, utente }) {
  const [dati, setDati] = useState(null);
  const [errore, setErrore] = useState('');
  const [avviso, setAvviso] = useState('');
  const [soloMancanti, setSoloMancanti] = useState(false);
  const [versione, setVersione] = useState(0);
  const [inCorso, setInCorso] = useState(null);
  const admin = utente.ruolo === 'amministratore';

  useEffect(() => {
    let attivo = true;
    setErrore('');
    api
      .collaboratori(anno, mese)
      .then((d) => attivo && setDati(d))
      .catch((err) => attivo && setErrore(err.message));
    return () => {
      attivo = false;
    };
  }, [anno, mese, versione]);

  const vai = (delta) => {
    const m = meseVicino(anno, mese, delta);
    setDati(null);
    setAvviso('');
    window.location.hash = `#/collaboratori/${m.anno}/${m.mese}`;
  };
  const nomeMese = `${NOMI_MESI[mese - 1]} ${anno}`;
  const elenco = dati?.anno === anno && dati?.mese === mese ? dati.collaboratori : [];
  const inviati = elenco.filter((c) => c.stato === 'inviato').length;
  const mancano = elenco.filter((c) => c.manca).length;
  const mostrati = admin && soloMancanti ? elenco.filter((c) => c.manca) : elenco;

  async function sollecita(c) {
    if (!window.confirm(`Mandare a ${c.nome} ${c.cognome} un'email per ricordargli di inviare ${nomeMese}?`)) return;
    setErrore('');
    setAvviso('');
    setInCorso(c.id);
    try {
      await api.sollecita(c.id, anno, mese);
      setAvviso(`Sollecito mandato a ${c.nome} ${c.cognome}.`);
      setVersione((v) => v + 1);
    } catch (err) {
      setErrore(err.message);
    }
    setInCorso(null);
  }

  return (
    <div className="mese">
      <div className="testata-mese">
        <NavigazioneMese titolo={maiuscola(nomeMese)} onPrecedente={() => vai(-1)} onSuccessivo={() => vai(1)} />
        {dati && admin && (
          <div className="azioni-mese">
            <p className="riassunto">
              {inviati} {inviati === 1 ? 'inviato' : 'inviati'} · <b>{mancano}</b> {mancano === 1 ? 'manca' : 'mancano'}
            </p>
            <label className="opzione filtro">
              <input type="checkbox" checked={soloMancanti} onChange={(e) => setSoloMancanti(e.target.checked)} />
              Solo chi manca
            </label>
          </div>
        )}
        {dati && !admin && (
          <p className="riassunto">
            {elenco.length} {elenco.length === 1 ? 'collaboratore' : 'collaboratori'} · {inviati}{' '}
            {inviati === 1 ? 'mese inviato' : 'mesi inviati'}
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
      {avviso && (
        <p className="conferma riquadro" role="status">
          {avviso}
        </p>
      )}
      {!dati && !errore && <p className="caricamento">Caricamento…</p>}
      {dati && mostrati.length === 0 && (
        <p className="caricamento">{soloMancanti && admin ? `In ${nomeMese} hanno inviato tutti.` : `Nessuno da mostrare in ${nomeMese}.`}</p>
      )}
      {mostrati.length > 0 && (
        <ul className="elenco-persone quadro">
          {mostrati.map((c) => (
            <li key={c.id}>
              <a href={`#/collaboratori/${c.id}/${anno}/${mese}`}>
                <span className="persona-nome">
                  {c.cognome} {c.nome}
                  {!c.attivo && <small className="etichetta spenta">disattivato</small>}
                  {admin && c.manca && c.password_impostata === false && <small className="nota">non ha ancora scelto la password</small>}
                  {admin && c.ultimo_sollecito && <small>sollecitato {dataBreve(c.ultimo_sollecito)}</small>}
                </span>
                <span className="persona-totale">
                  <b>{numero(c.ore)} h</b>
                  {c.sedute > 0 && <small>{numero(c.sedute)} sedute</small>}
                </span>
                <Stato c={c} />
              </a>
              {admin && c.manca && c.password_impostata && (
                <button type="button" className="sollecita neutro" onClick={() => sollecita(c)} disabled={inCorso === c.id}>
                  Sollecita
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
