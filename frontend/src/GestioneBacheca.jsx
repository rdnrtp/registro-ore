import { useEffect, useState } from 'react';
import { api } from './api.js';
import Foglio from './Foglio.jsx';
import { SceltaSettori, dataOra } from './GestioneUtenti.jsx';

// Nuovo avviso (avviso = null) o modifica di uno pubblicato.
function SchedaAvviso({ avviso, settori, onSalvato, onChiudi }) {
  const [dati, setDati] = useState(() => ({
    titolo: avviso?.titolo ?? '',
    testo: avviso?.testo ?? '',
    importante: avviso?.importante ?? false,
    per_tutti: avviso?.per_tutti ?? true,
    settori: avviso?.settori ?? [],
  }));
  const [errore, setErrore] = useState('');
  const [invio, setInvio] = useState(false);

  async function salva(evento) {
    evento.preventDefault();
    if (!avviso && !window.confirm('Pubblicare l’avviso? I destinatari ricevono subito un’email.')) return;
    setErrore('');
    setInvio(true);
    try {
      const corpo = { ...dati, settori: dati.per_tutti ? [] : dati.settori };
      onSalvato(avviso ? await api.modificaAvviso(avviso.id, corpo) : await api.pubblicaAvviso(corpo));
    } catch (err) {
      setErrore(err.message);
      setInvio(false);
    }
  }

  return (
    <Foglio
      titolo={avviso ? 'Modifica avviso' : 'Nuovo avviso'}
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
            <button type="submit" form="form-avviso" disabled={invio}>
              {avviso ? 'Salva la modifica' : 'Pubblica'}
            </button>
          </div>
        </>
      }
    >
      <form id="form-avviso" className="form-gestione" onSubmit={salva}>
        <label>
          Titolo
          <input value={dati.titolo} onChange={(e) => setDati({ ...dati, titolo: e.target.value })} required maxLength={150} />
        </label>
        <label>
          Testo
          <textarea rows={8} value={dati.testo} onChange={(e) => setDati({ ...dati, testo: e.target.value })} required maxLength={5000} />
        </label>
        <label className="opzione">
          <input type="checkbox" checked={dati.importante} onChange={(e) => setDati({ ...dati, importante: e.target.checked })} />
          <span>
            Importante <small>in evidenza in cima alla bacheca finché non viene letto</small>
          </span>
        </label>
        <fieldset>
          <legend>Destinatari</legend>
          <label className="opzione">
            <input type="radio" checked={dati.per_tutti} onChange={() => setDati({ ...dati, per_tutti: true })} />
            <span>Tutti</span>
          </label>
          <label className="opzione">
            <input type="radio" checked={!dati.per_tutti} onChange={() => setDati({ ...dati, per_tutti: false })} />
            <span>
              Alcuni settori <small>chi ha tra «Le mie attività» un&apos;attività del settore, più i responsabili del settore</small>
            </span>
          </label>
          {!dati.per_tutti && <SceltaSettori settori={settori} scelti={dati.settori} onCambia={(s) => setDati({ ...dati, settori: s })} />}
        </fieldset>
        {avviso && (
          <p className="dettaglio">
            Il testo attuale resta visibile tra le versioni precedenti e l&apos;avviso torna «da leggere» per chi l&apos;aveva già letto.
            Non parte una nuova email.
          </p>
        )}
      </form>
    </Foglio>
  );
}

function Letture({ avviso, onChiudi }) {
  const [letture, setLetture] = useState(null);
  const [errore, setErrore] = useState('');
  useEffect(() => {
    api
      .lettureAvviso(avviso.id)
      .then(setLetture)
      .catch((err) => setErrore(err.message));
  }, [avviso.id]);
  const persona = (u) => `${u.cognome} ${u.nome}`;
  return (
    <Foglio
      titolo={avviso.titolo}
      onChiudi={onChiudi}
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
      {letture && (
        <>
          <h3>Non l&apos;hanno ancora letto ({letture.non_letto.length})</h3>
          {letture.non_letto.length === 0 ? (
            <p className="dettaglio">Nessuno.</p>
          ) : (
            <ul className="elenco-letture">
              {letture.non_letto.map((u) => (
                <li key={u.id}>
                  {persona(u)}
                  {u.letto_il && <small> aveva letto la versione precedente ({dataOra(u.letto_il)})</small>}
                </li>
              ))}
            </ul>
          )}
          <h3>L&apos;hanno letto ({letture.letto.length})</h3>
          <ul className="elenco-letture">
            {letture.letto.map((u) => (
              <li key={u.id}>
                {persona(u)} <small>{dataOra(u.letto_il)}</small>
              </li>
            ))}
          </ul>
          <p className="dettaglio">Sono contati i destinatari attuali, attivi.</p>
        </>
      )}
    </Foglio>
  );
}

// Avvisi della bacheca: pubblicazione, modifica, ritiro, chi ha letto.
export default function GestioneBacheca() {
  const [avvisi, setAvvisi] = useState(null);
  const [settori, setSettori] = useState([]);
  const [errore, setErrore] = useState('');
  const [scheda, setScheda] = useState(undefined); // undefined = chiusa, null = nuovo
  const [letture, setLetture] = useState(null);

  const carica = () =>
    Promise.all([api.avvisiGestione(), api.settori()])
      .then(([a, s]) => {
        setAvvisi(a.avvisi);
        setSettori(s);
      })
      .catch((err) => setErrore(err.message));
  useEffect(() => {
    carica();
  }, []);

  const nomeSettore = new Map(settori.map((s) => [s.id, s.nome]));

  async function ritira(a) {
    if (!window.confirm(`Ritirare «${a.titolo}»? Sparisce dalla bacheca dei destinatari e non si può annullare.`)) return;
    setErrore('');
    try {
      await api.ritiraAvviso(a.id);
      carica();
    } catch (err) {
      setErrore(err.message);
    }
  }

  return (
    <>
      <p className="dettaglio">
        Comunicazioni a senso unico al personale: nessuna risposta. Alla pubblicazione i destinatari ricevono un&apos;email con il
        titolo e il collegamento all&apos;avviso.
      </p>
      <button type="button" className="nuovo" onClick={() => setScheda(null)}>
        + Nuovo avviso
      </button>
      {errore && (
        <p className="errore" role="alert">
          {errore}
        </p>
      )}
      {!avvisi && !errore && <p className="caricamento">Caricamento…</p>}
      {avvisi?.length === 0 && <p className="caricamento">Nessun avviso pubblicato.</p>}
      <ul className="elenco-avvisi gestione">
        {avvisi?.map((a) => (
          <li key={a.id} className={a.ritirato_il ? 'spento' : ''}>
            <div className="avviso-titolo">
              <b>{a.titolo}</b>
              {a.importante && <span className="etichetta importante">importante</span>}
              {a.ritirato_il && <span className="etichetta">ritirato</span>}
              <small>
                {dataOra(a.pubblicato_il)} · {a.autore} · per{' '}
                {a.per_tutti ? 'tutti' : a.settori.map((id) => nomeSettore.get(id)).join(', ')}
                {a.modificato_il && ` · modificato il ${dataOra(a.modificato_il)}`}
              </small>
              <small>
                Letto da <b>{a.letti}</b> su {a.destinatari}
              </small>
            </div>
            <div className="azioni-avviso">
              <a href={`#/bacheca/${a.id}`}>Apri</a>
              <button type="button" className="collegamento" onClick={() => setLetture(a)}>
                Chi l&apos;ha letto
              </button>
              {!a.ritirato_il && (
                <>
                  <button type="button" className="collegamento" onClick={() => setScheda(a)}>
                    Modifica
                  </button>
                  <button type="button" className="collegamento pericolo-testo" onClick={() => ritira(a)}>
                    Ritira
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      {scheda !== undefined && (
        <SchedaAvviso
          key={scheda?.id ?? 'nuovo'}
          avviso={scheda}
          settori={settori}
          onChiudi={() => setScheda(undefined)}
          onSalvato={() => {
            setScheda(undefined);
            carica();
          }}
        />
      )}
      {letture && <Letture avviso={letture} onChiudi={() => setLetture(null)} />}
    </>
  );
}
