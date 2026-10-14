import { useEffect, useState } from 'react';
import { api } from './api.js';
import Foglio from './Foglio.jsx';
import { dataOra } from './GestioneUtenti.jsx';
import { naviga } from './navigazione.js';

// Testo di un avviso con i suoi a capo.
export const TestoAvviso = ({ testo }) => <p className="testo-avviso">{testo}</p>;

// Avviso aperto (#/bacheca/<id>): aprirlo lo segna come letto.
function DettaglioAvviso({ id, onChiudi, onLetto }) {
  const [avviso, setAvviso] = useState(null);
  const [errore, setErrore] = useState('');

  useEffect(() => {
    let attivo = true;
    api
      .avviso(id)
      .then(async (a) => {
        if (!attivo) return;
        setAvviso(a);
        if (a.sono_destinatario && !a.ritirato_il && a.da_leggere) {
          await api.segnaLetto(id);
          onLetto();
        }
      })
      .catch((err) => attivo && setErrore(err.stato === 404 ? 'Avviso non trovato o ritirato.' : err.message));
    return () => {
      attivo = false;
    };
  }, [id, onLetto]);

  return (
    <Foglio
      titolo={avviso?.titolo ?? 'Avviso'}
      onChiudi={onChiudi}
      conIndietro={false}
      piede={
        <button type="button" onClick={onChiudi}>
          Chiudi
        </button>
      }
    >
      {errore && (
        <p className="errore" role="alert">
          {errore}
        </p>
      )}
      {!avviso && !errore && <p className="caricamento">Caricamento…</p>}
      {avviso && (
        <article className="avviso-aperto">
          {avviso.importante && <span className="etichetta importante">importante</span>}
          {avviso.ritirato_il && <p className="avviso">Ritirato il {dataOra(avviso.ritirato_il)}: i destinatari non lo vedono più.</p>}
          <TestoAvviso testo={avviso.testo} />
          <p className="dettaglio">
            Pubblicato il {dataOra(avviso.pubblicato_il)} da {avviso.autore}
            {avviso.modificato_il && (
              <>
                {' · '}
                <b>modificato il {dataOra(avviso.modificato_il)}</b>
              </>
            )}
          </p>
          {avviso.versioni_precedenti.length > 0 && (
            <details>
              <summary>Com&apos;era prima delle modifiche ({avviso.versioni_precedenti.length})</summary>
              <ol className="versioni-avviso">
                {avviso.versioni_precedenti.map((v) => (
                  <li key={v.sostituito_il}>
                    <small>
                      Testo del {dataOra(v.scritto_il)}, sostituito il {dataOra(v.sostituito_il)}
                      {v.importante && ' · importante'} · per {v.destinatari.join(', ')}
                    </small>
                    <b>{v.titolo}</b>
                    <TestoAvviso testo={v.testo} />
                  </li>
                ))}
              </ol>
            </details>
          )}
          <p className="dettaglio">Comunicazione dell&apos;amministrazione: non si risponde dall&apos;app.</p>
        </article>
      )}
    </Foglio>
  );
}

// Avvisi destinati all'utente, prima gli importanti da leggere.
export default function Bacheca({ aperto, utente, onLetto }) {
  const [avvisi, setAvvisi] = useState(null);
  const [errore, setErrore] = useState('');

  useEffect(() => {
    let attivo = true;
    api
      .avvisi()
      .then((d) => attivo && setAvvisi(d.avvisi))
      .catch((err) => attivo && setErrore(err.message));
    return () => {
      attivo = false;
    };
    // Si ricarica anche alla chiusura di un avviso (Indietro o Chiudi): ora è letto.
  }, [aperto]);

  const chiudi = () => naviga('#/bacheca');

  return (
    <div className="contenuto">
      <h1>Bacheca</h1>
      <p className="dettaglio">Avvisi dell&apos;amministrazione per te o per i tuoi settori.</p>
      {utente.ruolo === 'amministratore' && (
        <p>
          <a href="#/gestione/bacheca">Pubblica o modifica gli avvisi ›</a>
        </p>
      )}
      {errore && (
        <p className="errore" role="alert">
          {errore}
        </p>
      )}
      {!avvisi && !errore && <p className="caricamento">Caricamento…</p>}
      {avvisi?.length === 0 && <p className="caricamento">Nessun avviso.</p>}
      {avvisi?.length > 0 && (
        <ul className="elenco-avvisi">
          {avvisi.map((a) => (
            <li key={a.id}>
              <a href={`#/bacheca/${a.id}`} className={a.da_leggere ? 'da-leggere' : ''}>
                <span className="avviso-titolo">
                  {a.titolo}
                  {a.importante && <span className="etichetta importante">importante</span>}
                  {a.da_leggere && <span className="etichetta nuovo">{a.letto_il ? 'modificato' : 'da leggere'}</span>}
                  <small>
                    {dataOra(a.pubblicato_il)} · {a.autore}
                    {a.modificato_il && ' · modificato'}
                  </small>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {aperto && <DettaglioAvviso key={aperto} id={aperto} onChiudi={chiudi} onLetto={onLetto} />}
    </div>
  );
}
