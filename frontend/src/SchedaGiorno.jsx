import { useMemo, useState } from 'react';
import { api } from './api.js';
import { etichettaData, maiuscola, numero } from './date.js';
import EditorQuantita, { MAX_ORE, oreTotali } from './EditorQuantita.jsx';
import Foglio from './Foglio.jsx';

// Scheda di un giorno: aggiunge, modifica o toglie le quantità. Al salvataggio
// invia solo le attività cambiate; una quantità portata a zero viene tolta.
export default function SchedaGiorno({ data, attivita, mie, registrazioni, solaLettura, onSalvato, onChiudi }) {
  const [iniziali] = useState(() => new Map(registrazioni.map((r) => [r.attivita_id, r.quantita])));
  const [valori, setValori] = useState(iniziali);
  const [errore, setErrore] = useState('');
  const [invio, setInvio] = useState(false);
  const [svuota, setSvuota] = useState(false); // conferma di "Svuota giorno"
  const perId = useMemo(() => new Map(attivita.map((a) => [a.id, a])), [attivita]);

  const ore = oreTotali(valori, perId);
  const modificate = [...new Set([...iniziali.keys(), ...valori.keys()])].filter(
    (id) => (valori.get(id) ?? 0) !== (iniziali.get(id) ?? 0),
  );

  function cambia(id, quantita) {
    setValori((v) => new Map(v).set(id, quantita));
    setErrore('');
  }

  async function salva() {
    if (!modificate.length) return onChiudi();
    setInvio(true);
    try {
      await api.salvaGiorno(
        data,
        modificate.map((id) => ({ attivita_id: id, quantita: valori.get(id) ?? 0 })),
      );
      onSalvato();
    } catch (err) {
      setErrore(err.message);
      setInvio(false);
    }
  }

  // Svuota il giorno: toglie tutte le quantità salvate (non le sedute PT con cliente).
  async function svuotaGiorno() {
    setInvio(true);
    try {
      await api.svuotaGiorni(Number(data.slice(0, 4)), Number(data.slice(5, 7)), [data]);
      onSalvato();
    } catch (err) {
      setErrore(err.message);
      setInvio(false);
      setSvuota(false);
    }
  }
  const salvate = registrazioni.reduce(
    (t, r) => (perId.get(r.attivita_id)?.unita === 'sedute' ? { ...t, sedute: t.sedute + r.quantita } : { ...t, ore: t.ore + r.quantita }),
    { ore: 0, sedute: 0 },
  );

  const troppe = ore > MAX_ORE;
  const piede = (
    <>
      <p className={`totale-giorno${troppe ? ' errore' : ''}`}>
        Totale: <b>{numero(ore)} ore</b>
        {troppe && ` (massimo ${MAX_ORE})`}
      </p>
      {errore && (
        <p className="errore" role="alert">
          {errore}
        </p>
      )}
      {solaLettura ? (
        <button type="button" onClick={onChiudi}>
          Chiudi
        </button>
      ) : svuota ? (
        <>
          <p>
            Svuotare il giorno? Verranno cancellate <b>{numero(salvate.ore)} ore</b>
            {salvate.sedute > 0 && ` e ${numero(salvate.sedute)} sedute`}.
          </p>
          <div className="pulsanti">
            <button type="button" className="neutro" onClick={() => setSvuota(false)}>
              No
            </button>
            <button type="button" className="conferma-pericolo" onClick={svuotaGiorno} disabled={invio}>
              Sì, svuota
            </button>
          </div>
        </>
      ) : (
        <div className="pulsanti">
          <button type="button" className="neutro" onClick={onChiudi}>
            Annulla
          </button>
          <button type="button" onClick={salva} disabled={invio || troppe}>
            {invio ? 'Salvataggio…' : 'Salva'}
          </button>
        </div>
      )}
    </>
  );

  return (
    <Foglio titolo={maiuscola(etichettaData(data))} onChiudi={onChiudi} piede={piede}>
      {solaLettura && <p className="avviso">Il mese è già stato inviato: i dati sono in sola lettura.</p>}
      {!solaLettura && mie.length === 0 && (
        <p className="suggerimento">
          Scegli le attività che fai di solito in <a href="#/attivita">Le mie attività</a>: qui vedrai solo quelle.
        </p>
      )}
      <EditorQuantita attivita={attivita} mie={mie} valori={valori} onCambia={cambia} solaLettura={solaLettura} />
      {!solaLettura && registrazioni.length > 0 && (
        <button type="button" className="piccolo pericolo svuota-giorno" onClick={() => setSvuota(true)} disabled={invio || svuota}>
          Svuota giorno
        </button>
      )}
    </Foglio>
  );
}
