import { useEffect, useState } from 'react';
import { api } from './api.js';

const MODALITA = [
  {
    valore: 'mese',
    nome: 'Insieme al mese',
    descrizione:
      'Le spese partono quando il collaboratore invia il mese: una seconda email alla segreteria con un PDF (riepilogo e ricevute).',
  },
  {
    valore: 'subito',
    nome: 'Subito',
    descrizione: 'Ogni spesa parte per email alla segreteria appena il collaboratore la conferma, e da lì non si modifica più.',
  },
];

// Quando partono le spese verso la segreteria.
function InvioSpese() {
  const [org, setOrg] = useState(null);
  const [scelta, setScelta] = useState('mese');
  const [errore, setErrore] = useState('');
  const [avviso, setAvviso] = useState('');
  const [invio, setInvio] = useState(false);

  useEffect(() => {
    api
      .organizzazione()
      .then((o) => {
        setOrg(o);
        setScelta(o.invio_spese);
      })
      .catch((err) => setErrore(err.message));
  }, []);

  async function salva(evento) {
    evento.preventDefault();
    setErrore('');
    setAvviso('');
    setInvio(true);
    try {
      const o = await api.modificaOrganizzazione({ invio_spese: scelta });
      setOrg(o);
      setAvviso('Salvato.');
    } catch (err) {
      setErrore(err.message);
    }
    setInvio(false);
  }

  return (
    <section className="sezione-gestione" aria-labelledby="titolo-invio-spese">
      <h2 id="titolo-invio-spese">Invio delle spese</h2>
      <form className="form-gestione" onSubmit={salva}>
        {MODALITA.map((m) => (
          <label key={m.valore} className="opzione">
            <input type="radio" name="invio-spese" value={m.valore} checked={scelta === m.valore} onChange={() => setScelta(m.valore)} />
            <span>
              {m.nome}
              <small>{m.descrizione}</small>
            </span>
          </label>
        ))}
        {errore && (
          <p className="errore" role="alert">
            {errore}
          </p>
        )}
        {avviso && (
          <p className="conferma" role="status">
            {avviso}
          </p>
        )}
        <button type="submit" disabled={invio || !org || scelta === org.invio_spese}>
          Salva
        </button>
      </form>
      <p className="dettaglio">
        In entrambi i casi l&apos;email va solo all&apos;indirizzo di invio dell&apos;impianto, in copia al collaboratore: mai ai
        responsabili di settore, perché le ricevute possono contenere dati personali.
      </p>
    </section>
  );
}

// Tipi di spesa: si aggiungono, si rinominano, si disattivano (non si
// eliminano: le spese già registrate li usano).
function TipiSpesa() {
  const [tipi, setTipi] = useState(null);
  const [nuovo, setNuovo] = useState('');
  const [nomi, setNomi] = useState({});
  const [errore, setErrore] = useState('');
  const [invio, setInvio] = useState(false);

  const carica = () =>
    api
      .tipiSpesa()
      .then((t) => {
        setTipi(t);
        setNomi(Object.fromEntries(t.map((x) => [x.id, x.nome])));
      })
      .catch((err) => setErrore(err.message));
  useEffect(() => {
    carica();
  }, []);

  async function esegui(azione) {
    setErrore('');
    setInvio(true);
    try {
      await azione();
      await carica();
    } catch (err) {
      setErrore(err.message);
    }
    setInvio(false);
  }

  return (
    <section className="sezione-gestione" aria-labelledby="titolo-tipi-spesa">
      <h2 id="titolo-tipi-spesa">Tipi di spesa</h2>
      {!tipi && !errore && <p className="caricamento">Caricamento…</p>}
      {tipi && (
        <ul className="elenco-tipi-spesa">
          {tipi.map((t) => (
            <li key={t.id} className={t.attivo ? '' : 'non-attivo'}>
              <input
                aria-label={`Nome del tipo ${t.nome}`}
                value={nomi[t.id] ?? ''}
                maxLength={60}
                onChange={(e) => setNomi((n) => ({ ...n, [t.id]: e.target.value }))}
              />
              {nomi[t.id]?.trim() && nomi[t.id] !== t.nome ? (
                <button type="button" className="piccolo" disabled={invio} onClick={() => esegui(() => api.modificaTipoSpesa(t.id, { nome: nomi[t.id] }))}>
                  Rinomina
                </button>
              ) : (
                <button
                  type="button"
                  className="piccolo neutro"
                  disabled={invio}
                  onClick={() => esegui(() => api.modificaTipoSpesa(t.id, { attivo: !t.attivo }))}
                >
                  {t.attivo ? 'Disattiva' : 'Riattiva'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <form
        className="form-gestione riga-nuovo-tipo"
        onSubmit={(e) => {
          e.preventDefault();
          esegui(async () => {
            await api.creaTipoSpesa(nuovo);
            setNuovo('');
          });
        }}
      >
        <label>
          Nuovo tipo
          <input value={nuovo} maxLength={60} onChange={(e) => setNuovo(e.target.value)} placeholder="es. Treno" />
        </label>
        <button type="submit" disabled={invio || !nuovo.trim()}>
          Aggiungi
        </button>
      </form>
      {errore && (
        <p className="errore" role="alert">
          {errore}
        </p>
      )}
      <p className="dettaglio">
        Un tipo disattivato non si può più scegliere per le spese nuove; quelle già registrate restano com&apos;erano.
      </p>
    </section>
  );
}

export default function GestioneSpese() {
  return (
    <>
      <InvioSpese />
      <TipiSpesa />
    </>
  );
}
