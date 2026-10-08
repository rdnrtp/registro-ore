import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { salvaFile } from './VistaMese.jsx';
import { dataOra } from './GestioneUtenti.jsx';

function Cambiamenti({ cambiamenti: c }) {
  const voci = [
    ...c.rinominate.map((r) => `Riga ${r.riga}: «${r.prima}» diventa «${r.dopo}» (stessa attività, le ore restano)`),
    ...c.spostate.map((s) => `«${s.nome}» passa dalla riga ${s.prima} alla riga ${s.dopo}`),
    ...c.nuove.map((n) => `Riga ${n.riga}: nuova attività «${n.nome}» (a ore, senza settori: sistemala in Attività)`),
  ];
  if (!voci.length) return <p>Le attività sono le stesse del modello in uso: cambia solo il resto del file.</p>;
  return (
    <ul className="elenco-cambiamenti">
      {voci.map((v) => (
        <li key={v}>{v}</li>
      ))}
    </ul>
  );
}

// Modello Excel: si carica una nuova versione con la stessa disposizione
// delle celle. Prima l'API la verifica e descrive cosa cambia, poi si conferma.
function ModelloExcel({ onAttivitaCambiate }) {
  const [versioni, setVersioni] = useState(null);
  const [file, setFile] = useState(null);
  const [anteprima, setAnteprima] = useState(null);
  const [errore, setErrore] = useState('');
  const [avviso, setAvviso] = useState('');
  const [invio, setInvio] = useState(false);
  const campo = useRef(null);

  const carica = () =>
    api
      .modelli()
      .then((d) => setVersioni(d.versioni))
      .catch((err) => setErrore(err.message));
  useEffect(() => {
    carica();
  }, []);

  function annulla() {
    setFile(null);
    setAnteprima(null);
    if (campo.current) campo.current.value = '';
  }

  async function scegli(e) {
    const scelto = e.target.files?.[0];
    setErrore('');
    setAvviso('');
    setAnteprima(null);
    if (!scelto) return;
    setFile(scelto);
    setInvio(true);
    try {
      setAnteprima(await api.caricaModello(scelto, true));
    } catch (err) {
      setErrore(err.message);
      annulla();
    }
    setInvio(false);
  }

  async function conferma() {
    setInvio(true);
    setErrore('');
    try {
      const r = await api.caricaModello(file, false);
      setAvviso(`Modello caricato: versione ${r.versione}. Da ora i file del mese usano questo modello.`);
      annulla();
      await Promise.all([carica(), onAttivitaCambiate()]);
    } catch (err) {
      setErrore(err.message);
    }
    setInvio(false);
  }

  async function scaricaInUso() {
    setErrore('');
    try {
      const { blob, nomeFile } = await api.fileModello();
      salvaFile(blob, nomeFile ?? 'modello.xlsx');
    } catch (err) {
      setErrore(err.message);
    }
  }

  const inUso = versioni?.[0];
  return (
    <section className="sezione-gestione" aria-labelledby="titolo-modello">
      <h2 id="titolo-modello">Modello Excel</h2>
      {inUso ? (
        <p>
          In uso: <b>versione {inUso.versione}</b> ({inUso.nome_file}), caricata il {dataOra(inUso.caricato_il)}.{' '}
          <button type="button" className="collegamento" onClick={scaricaInUso}>
            Scarica
          </button>
        </p>
      ) : (
        versioni && <p>Nessun modello caricato: il primo si carica con il comando carica-organizzazione.</p>
      )}
      {inUso && (
        <>
          <p className="dettaglio">
            Quando l&apos;impianto manda un modello aggiornato, caricalo qui. Deve avere la stessa disposizione di quello in
            uso (stesse celle per mese, nome, giorni, attività e sedute): se non corrisponde viene rifiutato e non cambia
            nulla. Prima di salvarlo vedrai cosa cambia.
          </p>
          <label>
            Nuovo modello (.xlsx)
            <input
              ref={campo}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={scegli}
              disabled={invio}
            />
          </label>
        </>
      )}
      {invio && !anteprima && <p className="caricamento">Verifica del file…</p>}
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
      {anteprima && (
        <div className="anteprima-modello">
          <p>
            <b>{file.name}</b> è valido. Cosa cambia:
          </p>
          <Cambiamenti cambiamenti={anteprima.cambiamenti} />
          <div className="pulsanti">
            <button type="button" className="neutro" onClick={annulla} disabled={invio}>
              Annulla
            </button>
            <button type="button" onClick={conferma} disabled={invio}>
              Usa questo modello
            </button>
          </div>
        </div>
      )}
      {versioni?.length > 1 && (
        <details>
          <summary>Versioni precedenti</summary>
          <ul>
            {versioni.slice(1).map((v) => (
              <li key={v.versione}>
                Versione {v.versione}: {v.nome_file}, {dataOra(v.caricato_il)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function IndirizzoInvio() {
  const [org, setOrg] = useState(null);
  const [email, setEmail] = useState('');
  const [errore, setErrore] = useState('');
  const [avviso, setAvviso] = useState('');
  const [invio, setInvio] = useState(false);

  useEffect(() => {
    api
      .organizzazione()
      .then((o) => {
        setOrg(o);
        setEmail(o.email_invio ?? '');
      })
      .catch((err) => setErrore(err.message));
  }, []);

  async function salva(evento) {
    evento.preventDefault();
    setErrore('');
    setAvviso('');
    setInvio(true);
    try {
      const o = await api.modificaOrganizzazione({ email_invio: email });
      setOrg(o);
      setEmail(o.email_invio);
      setAvviso('Salvato.');
    } catch (err) {
      setErrore(err.message);
    }
    setInvio(false);
  }

  return (
    <section className="sezione-gestione" aria-labelledby="titolo-impianto">
      <h2 id="titolo-impianto">{org ? org.nome : 'Impianto'}</h2>
      <form className="form-gestione" onSubmit={salva}>
        <label>
          Indirizzo a cui si inviano le ore (segreteria)
          <input type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
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
        <button type="submit" disabled={invio || !org || email === (org.email_invio ?? '')}>
          Salva indirizzo
        </button>
      </form>
      {org && (
        <p className="dettaglio">
          Sedute di personal training per tipo in un mese: al massimo {org.max_sedute_pt_per_tipo} (le righe del modello).
        </p>
      )}
    </section>
  );
}

const ORE = Array.from({ length: 24 }, (_, i) => i);

// Promemoria automatici a chi non ha ancora inviato il mese.
function Promemoria() {
  const [conf, setConf] = useState(null);
  const [giorni, setGiorni] = useState('');
  const [ultimo, setUltimo] = useState(true);
  const [ora, setOra] = useState(9);
  const [errore, setErrore] = useState('');
  const [avviso, setAvviso] = useState('');
  const [invio, setInvio] = useState(false);

  const mostra = (p) => {
    setConf(p);
    setGiorni(p.giorni.join(', '));
    setUltimo(p.ultimo_giorno);
    setOra(p.ora);
  };
  useEffect(() => {
    api
      .organizzazione()
      .then((o) => mostra(o.promemoria))
      .catch((err) => setErrore(err.message));
  }, []);

  async function salva(evento) {
    evento.preventDefault();
    setErrore('');
    setAvviso('');
    const elenco = giorni
      .split(/[\s,;]+/)
      .filter(Boolean)
      .map(Number);
    if (elenco.some((g) => !Number.isInteger(g) || g < 1 || g > 31)) {
      setErrore('Scrivi i giorni come numeri da 1 a 31, separati da virgole.');
      return;
    }
    setInvio(true);
    try {
      const o = await api.modificaOrganizzazione({ promemoria: { giorni: elenco, ultimo_giorno: ultimo, ora: Number(ora) } });
      mostra(o.promemoria);
      setAvviso('Salvato.');
    } catch (err) {
      setErrore(err.message);
    }
    setInvio(false);
  }

  return (
    <section className="sezione-gestione" aria-labelledby="titolo-promemoria">
      <h2 id="titolo-promemoria">Promemoria automatici</h2>
      <p className="dettaglio">
        Email a chi non ha ancora inviato il mese in corso (tranne chi non deve inviarlo). Se il server è spento all&apos;ora
        prevista, partono appena riparte, ma solo nello stesso giorno.
      </p>
      <form className="form-gestione" onSubmit={salva}>
        <label>
          Giorni del mese (un giorno che il mese non ha vale come ultimo giorno)
          <input value={giorni} onChange={(e) => setGiorni(e.target.value)} inputMode="numeric" placeholder="25, 28" />
        </label>
        <label className="opzione">
          <input type="checkbox" checked={ultimo} onChange={(e) => setUltimo(e.target.checked)} />
          <span>Anche l&apos;ultimo giorno del mese</span>
        </label>
        <label>
          Ora (ora italiana)
          <select value={ora} onChange={(e) => setOra(e.target.value)}>
            {ORE.map((h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, '0')}:00
              </option>
            ))}
          </select>
        </label>
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
        <button type="submit" disabled={invio || !conf}>
          Salva promemoria
        </button>
      </form>
    </section>
  );
}

export default function GestioneImpianto({ onAttivitaCambiate }) {
  return (
    <>
      <IndirizzoInvio />
      <Promemoria />
      <ModelloExcel onAttivitaCambiate={onAttivitaCambiate} />
    </>
  );
}
